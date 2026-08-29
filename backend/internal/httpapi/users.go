package httpapi

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/scrypt"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

const userNamespace = "users"
const userCatalogKey = "catalog"
const maxUserWriteAttempts = 6

type storedUser struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	Role         string `json:"role"`
	DisplayName  string `json:"displayName"`
	PasswordHash string `json:"passwordHash"`
	PasswordSalt string `json:"passwordSalt"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

type authUser struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	Role        string `json:"role"`
	DisplayName string `json:"displayName"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type userCatalog struct {
	Version int          `json:"version"`
	Users   []storedUser `json:"users"`
}

type Users struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewUsers(store *postgres.Store, documentCache *cache.Documents) *Users {
	return &Users{store: store, cache: documentCache}
}

func (handler *Users) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	path := strings.Trim(strings.TrimPrefix(request.URL.Path, "/v1/users"), "/")
	if path == "authenticate" {
		if request.Method != http.MethodPost {
			methodNotAllowed(writer, "POST")
			return
		}
		handler.authenticate(writer, request)
		return
	}
	if path == "admin/count" {
		if request.Method != http.MethodGet {
			methodNotAllowed(writer, "GET")
			return
		}
		handler.countAdmins(writer, request)
		return
	}
	if path == "admin/grant" || path == "admin/revoke" {
		if request.Method != http.MethodPost {
			methodNotAllowed(writer, "POST")
			return
		}
		handler.changeAdmin(writer, request, strings.HasSuffix(path, "/grant"))
		return
	}
	if strings.HasPrefix(path, "by-username/") {
		if request.Method != http.MethodGet {
			methodNotAllowed(writer, "GET")
			return
		}
		handler.getByUsername(writer, request, strings.TrimPrefix(path, "by-username/"))
		return
	}
	if path == "" {
		switch request.Method {
		case http.MethodGet:
			handler.list(writer, request)
		case http.MethodPost:
			handler.create(writer, request)
		default:
			methodNotAllowed(writer, "GET, POST")
		}
		return
	}
	if strings.Contains(path, "/") || strings.Contains(path, "..") {
		writeError(writer, http.StatusBadRequest, "invalid user path")
		return
	}
	switch request.Method {
	case http.MethodGet:
		handler.get(writer, request, path)
	case http.MethodPatch:
		handler.patch(writer, request, path)
	default:
		methodNotAllowed(writer, "GET, PATCH")
	}
}

func methodNotAllowed(writer http.ResponseWriter, allow string) {
	writer.Header().Set("Allow", allow)
	writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
}

func normalizeUserRole(role string) string {
	if role == "admin" {
		return "admin"
	}
	return "user"
}

func normalizeUserCatalog(catalog userCatalog) userCatalog {
	if catalog.Version == 0 {
		catalog.Version = 1
	}
	if catalog.Users == nil {
		catalog.Users = []storedUser{}
	}
	for index := range catalog.Users {
		catalog.Users[index].Role = normalizeUserRole(catalog.Users[index].Role)
	}
	return catalog
}

func (handler *Users) readCatalog(request *http.Request) (int64, userCatalog, error) {
	if handler.cache != nil {
		if document, ok := handler.cache.Get(request.Context(), userNamespace, userCatalogKey); ok {
			var catalog userCatalog
			if json.Unmarshal(document.Value, &catalog) == nil {
				return document.Revision, normalizeUserCatalog(catalog), nil
			}
		}
	}
	document, err := handler.store.GetDocument(request.Context(), userNamespace, userCatalogKey)
	if errors.Is(err, postgres.ErrNotFound) {
		return 0, userCatalog{Version: 1, Users: []storedUser{}}, nil
	}
	if err != nil {
		return 0, userCatalog{}, err
	}
	var catalog userCatalog
	if err := json.Unmarshal(document.Value, &catalog); err != nil {
		return 0, userCatalog{}, err
	}
	if handler.cache != nil {
		_ = handler.cache.Set(request.Context(), document)
	}
	return document.Revision, normalizeUserCatalog(catalog), nil
}

func (handler *Users) mutateCatalog(request *http.Request, mutate func(*userCatalog) (any, bool, error)) (any, error) {
	for attempt := 0; attempt < maxUserWriteAttempts; attempt++ {
		revision, catalog, err := handler.readCatalog(request)
		if err != nil {
			return nil, err
		}
		result, changed, err := mutate(&catalog)
		if err != nil || !changed {
			return result, err
		}
		value, err := json.Marshal(catalog)
		if err != nil {
			return nil, err
		}
		document, err := handler.store.PutDocument(request.Context(), userNamespace, userCatalogKey, &revision, value)
		if errors.Is(err, postgres.ErrRevisionConflict) {
			if handler.cache != nil {
				_ = handler.cache.Delete(request.Context(), userNamespace, userCatalogKey)
			}
			continue
		}
		if err != nil {
			return nil, err
		}
		if handler.cache != nil {
			_ = handler.cache.Set(request.Context(), document)
		}
		return result, nil
	}
	return nil, postgres.ErrRevisionConflict
}

func (handler *Users) list(writer http.ResponseWriter, request *http.Request) {
	_, catalog, err := handler.readCatalog(request)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "user catalog read failed")
		return
	}
	users := make([]authUser, 0, len(catalog.Users))
	for _, user := range catalog.Users {
		users = append(users, publicUser(user))
	}
	writeJSON(writer, http.StatusOK, map[string]any{"users": users})
}

func (handler *Users) get(writer http.ResponseWriter, request *http.Request, userID string) {
	_, catalog, err := handler.readCatalog(request)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "user catalog read failed")
		return
	}
	for _, user := range catalog.Users {
		if user.ID == userID {
			if request.URL.Query().Get("stored") == "true" {
				writeJSON(writer, http.StatusOK, map[string]any{"user": user})
			} else {
				writeJSON(writer, http.StatusOK, map[string]any{"user": publicUser(user)})
			}
			return
		}
	}
	writeError(writer, http.StatusNotFound, "user not found")
}

func (handler *Users) getByUsername(writer http.ResponseWriter, request *http.Request, username string) {
	username = strings.TrimSpace(username)
	_, catalog, err := handler.readCatalog(request)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "user catalog read failed")
		return
	}
	for _, user := range catalog.Users {
		if strings.EqualFold(user.Username, username) {
			if request.URL.Query().Get("stored") == "true" {
				writeJSON(writer, http.StatusOK, map[string]any{"user": user})
			} else {
				writeJSON(writer, http.StatusOK, map[string]any{"user": publicUser(user)})
			}
			return
		}
	}
	writeError(writer, http.StatusNotFound, "user not found")
}

func (handler *Users) authenticate(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	_, catalog, err := handler.readCatalog(request)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "user catalog read failed")
		return
	}
	for _, user := range catalog.Users {
		if strings.EqualFold(user.Username, strings.TrimSpace(input.Username)) && verifyStoredPassword(input.Password, user) {
			writeJSON(writer, http.StatusOK, map[string]any{"user": publicUser(user)})
			return
		}
	}
	writeError(writer, http.StatusUnauthorized, "invalid credentials")
}

func (handler *Users) create(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Username    string `json:"username"`
		Password    string `json:"password"`
		Role        string `json:"role"`
		DisplayName string `json:"displayName"`
	}
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	input.Username = strings.TrimSpace(input.Username)
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	if utf8.RuneCountInString(input.Username) < 2 {
		writeError(writer, http.StatusBadRequest, "用户名至少 2 个字符")
		return
	}
	if len(input.Password) < 6 {
		writeError(writer, http.StatusBadRequest, "密码至少 6 个字符")
		return
	}
	if input.Role == "admin" {
		writeError(writer, http.StatusBadRequest, "不能通过创建用户接口授予系统管理员")
		return
	}
	if input.DisplayName == "" {
		input.DisplayName = input.Username
	}
	hash, salt, err := hashStoredPassword(input.Password)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "password hash failed")
		return
	}
	userID, err := newUUID()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "user id generation failed")
		return
	}
	now := requestTime()
	user := storedUser{ID: userID, Username: input.Username, Role: "user", DisplayName: input.DisplayName, PasswordHash: hash, PasswordSalt: salt, CreatedAt: now, UpdatedAt: now}
	result, err := handler.mutateCatalog(request, func(catalog *userCatalog) (any, bool, error) {
		for _, existing := range catalog.Users {
			if strings.EqualFold(existing.Username, user.Username) {
				return nil, false, errors.New("用户名已存在")
			}
		}
		catalog.Users = append(catalog.Users, user)
		return map[string]any{"user": publicUser(user)}, true, nil
	})
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(writer, http.StatusCreated, result)
}

func (handler *Users) patch(writer http.ResponseWriter, request *http.Request, userID string) {
	var input struct {
		DisplayName     *string `json:"displayName"`
		CurrentPassword *string `json:"currentPassword"`
		NewPassword     *string `json:"newPassword"`
	}
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	result, err := handler.mutateCatalog(request, func(catalog *userCatalog) (any, bool, error) {
		for index, user := range catalog.Users {
			if user.ID != userID {
				continue
			}
			if input.DisplayName != nil {
				displayName := strings.TrimSpace(*input.DisplayName)
				if displayName == "" {
					return nil, false, errors.New("显示名称不能为空")
				}
				if utf8.RuneCountInString(displayName) > 32 {
					return nil, false, errors.New("显示名称过长")
				}
				user.DisplayName = displayName
			}
			if input.CurrentPassword != nil || input.NewPassword != nil {
				currentPassword := valueOrEmpty(input.CurrentPassword)
				newPassword := valueOrEmpty(input.NewPassword)
				if currentPassword == "" {
					return nil, false, errors.New("请输入当前密码")
				}
				if len(newPassword) < 6 {
					return nil, false, errors.New("新密码至少 6 个字符")
				}
				if len(newPassword) > 128 {
					return nil, false, errors.New("新密码过长")
				}
				if newPassword == currentPassword {
					return nil, false, errors.New("新密码不能与当前密码相同")
				}
				if !verifyStoredPassword(currentPassword, user) {
					return nil, false, errors.New("当前密码不正确")
				}
				hash, salt, err := hashStoredPassword(newPassword)
				if err != nil {
					return nil, false, err
				}
				user.PasswordHash = hash
				user.PasswordSalt = salt
			}
			user.UpdatedAt = requestTime()
			catalog.Users[index] = user
			return map[string]any{"user": publicUser(user)}, true, nil
		}
		return nil, false, errors.New("用户不存在")
	})
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (handler *Users) countAdmins(writer http.ResponseWriter, request *http.Request) {
	_, catalog, err := handler.readCatalog(request)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "user catalog read failed")
		return
	}
	count := 0
	for _, user := range catalog.Users {
		if normalizeUserRole(user.Role) == "admin" {
			count++
		}
	}
	writeJSON(writer, http.StatusOK, map[string]any{"count": count})
}

func (handler *Users) changeAdmin(writer http.ResponseWriter, request *http.Request, grant bool) {
	var input struct {
		Username string `json:"username"`
	}
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	username := strings.TrimSpace(input.Username)
	if username == "" {
		writeError(writer, http.StatusBadRequest, "必须指定 --username")
		return
	}
	result, err := handler.mutateCatalog(request, func(catalog *userCatalog) (any, bool, error) {
		index := -1
		adminCount := 0
		for candidateIndex, user := range catalog.Users {
			if strings.EqualFold(user.Username, username) {
				index = candidateIndex
			}
			if normalizeUserRole(user.Role) == "admin" {
				adminCount++
			}
		}
		if index < 0 {
			return nil, false, errors.New("用户不存在：" + username)
		}
		user := catalog.Users[index]
		if grant {
			if normalizeUserRole(user.Role) == "admin" {
				return map[string]any{"user": publicUser(user), "alreadyAdmin": true}, false, nil
			}
			if adminCount >= 1 {
				return nil, false, errors.New("系统管理员全局只允许存在 1 个，禁止创建第二个系统管理员")
			}
			user.Role = "admin"
			user.UpdatedAt = requestTime()
			catalog.Users[index] = user
			return map[string]any{"user": publicUser(user), "alreadyAdmin": false}, true, nil
		}
		if normalizeUserRole(user.Role) != "admin" {
			return map[string]any{"user": publicUser(user), "alreadyUser": true}, false, nil
		}
		if adminCount <= 1 {
			return nil, false, errors.New("不能撤销最后一个系统管理员")
		}
		user.Role = "user"
		user.UpdatedAt = requestTime()
		catalog.Users[index] = user
		return map[string]any{"user": publicUser(user), "alreadyUser": false}, true, nil
	})
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func decodeJSON(writer http.ResponseWriter, request *http.Request, value any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 1<<20))
	if err := decoder.Decode(value); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid user payload")
		return err
	}
	return nil
}

func publicUser(user storedUser) authUser {
	return authUser{ID: user.ID, Username: user.Username, Role: normalizeUserRole(user.Role), DisplayName: user.DisplayName, CreatedAt: user.CreatedAt, UpdatedAt: user.UpdatedAt}
}

func hashStoredPassword(password string) (string, string, error) {
	saltBytes := make([]byte, 16)
	if _, err := rand.Read(saltBytes); err != nil {
		return "", "", err
	}
	salt := hex.EncodeToString(saltBytes)
	hashBytes, err := scrypt.Key([]byte(password), []byte(salt), 16384, 8, 1, 64)
	if err != nil {
		return "", "", err
	}
	return hex.EncodeToString(hashBytes), salt, nil
}

func verifyStoredPassword(password string, user storedUser) bool {
	expected, err := hex.DecodeString(user.PasswordHash)
	if err != nil {
		return false
	}
	computed, err := scrypt.Key([]byte(password), []byte(user.PasswordSalt), 16384, 8, 1, 64)
	if err != nil || len(computed) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare(computed, expected) == 1
}

func newUUID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	hexValue := hex.EncodeToString(value)
	return hexValue[0:8] + "-" + hexValue[8:12] + "-" + hexValue[12:16] + "-" + hexValue[16:20] + "-" + hexValue[20:32], nil
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
