package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/scrypt"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

const projectNamespace = "projects"
const projectCatalogKey = "catalog"
const maxProjectWriteAttempts = 6
const projectNameMaxLength = 80
const projectHighlightsMaxLength = 4000

type ProjectRecord struct {
	ProjectID       string  `json:"projectId"`
	RootFolderID    string  `json:"rootFolderId"`
	Name            string  `json:"name"`
	OwnerID         string  `json:"ownerId"`
	CreationSource  string  `json:"creationSource"`
	ProjectMode     string  `json:"projectMode"`
	Status          string  `json:"status"`
	Highlights      string  `json:"highlights"`
	VisualStyle     *string `json:"visualStyle"`
	ApprovalEnabled bool    `json:"approvalEnabled"`
	PasswordEnabled bool    `json:"passwordEnabled"`
	PasswordHash    *string `json:"passwordHash"`
	PasswordSalt    *string `json:"passwordSalt"`
	CreatedAt       string  `json:"createdAt"`
	UpdatedAt       string  `json:"updatedAt"`
}

type projectPublic struct {
	ProjectID       string  `json:"projectId"`
	RootFolderID    string  `json:"rootFolderId"`
	Name            string  `json:"name"`
	OwnerID         string  `json:"ownerId"`
	CreationSource  string  `json:"creationSource"`
	ProjectMode     string  `json:"projectMode"`
	Status          string  `json:"status"`
	Highlights      string  `json:"highlights"`
	VisualStyle     *string `json:"visualStyle"`
	ApprovalEnabled bool    `json:"approvalEnabled"`
	PasswordEnabled bool    `json:"passwordEnabled"`
	CreatedAt       string  `json:"createdAt"`
	UpdatedAt       string  `json:"updatedAt"`
}

type projectCatalog struct {
	Version     int               `json:"version"`
	Projects    []ProjectRecord   `json:"projects"`
	Idempotency map[string]string `json:"idempotency"`
}

type Projects struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewProjects(store *postgres.Store, documentCache *cache.Documents) *Projects {
	return &Projects{store: store, cache: documentCache}
}

func (handler *Projects) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	path := strings.TrimPrefix(request.URL.Path, "/v1/projects")
	if path == "" || path == "/" {
		switch request.Method {
		case http.MethodGet:
			handler.list(writer, request)
		case http.MethodPost:
			handler.create(writer, request)
		default:
			writer.Header().Set("Allow", "GET, POST")
			writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		}
		return
	}

	path = strings.TrimPrefix(path, "/")
	if strings.HasPrefix(path, "by-idempotency/") {
		if request.Method != http.MethodGet {
			writer.Header().Set("Allow", "GET")
			writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		handler.getByIdempotency(writer, request, strings.TrimPrefix(path, "by-idempotency/"))
		return
	}
	if path == "" || strings.Contains(path, "/") || strings.Contains(path, "..") {
		writeError(writer, http.StatusBadRequest, "invalid project path")
		return
	}
	switch request.Method {
	case http.MethodGet:
		handler.get(writer, request, path)
	case http.MethodPatch:
		handler.patch(writer, request, path)
	case http.MethodDelete:
		handler.delete(writer, request, path)
	default:
		writer.Header().Set("Allow", "GET, PATCH, DELETE")
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func emptyProjectCatalog() projectCatalog {
	return projectCatalog{Version: 1, Projects: []ProjectRecord{}, Idempotency: map[string]string{}}
}

func normalizeProjectCatalog(catalog projectCatalog) projectCatalog {
	if catalog.Version == 0 {
		catalog.Version = 1
	}
	if catalog.Projects == nil {
		catalog.Projects = []ProjectRecord{}
	}
	if catalog.Idempotency == nil {
		catalog.Idempotency = map[string]string{}
	}
	return catalog
}

func (handler *Projects) readCatalog(request *http.Request) (int64, projectCatalog, error) {
	if handler.cache != nil {
		if document, ok := handler.cache.Get(request.Context(), projectNamespace, projectCatalogKey); ok {
			var catalog projectCatalog
			if json.Unmarshal(document.Value, &catalog) == nil {
				return document.Revision, normalizeProjectCatalog(catalog), nil
			}
		}
	}
	document, err := handler.store.GetDocument(request.Context(), projectNamespace, projectCatalogKey)
	if errors.Is(err, postgres.ErrNotFound) {
		return 0, emptyProjectCatalog(), nil
	}
	if err != nil {
		return 0, projectCatalog{}, err
	}
	var catalog projectCatalog
	if err := json.Unmarshal(document.Value, &catalog); err != nil {
		return 0, projectCatalog{}, err
	}
	if handler.cache != nil {
		_ = handler.cache.Set(request.Context(), document)
	}
	return document.Revision, normalizeProjectCatalog(catalog), nil
}

func (handler *Projects) mutateCatalog(request *http.Request, mutate func(*projectCatalog) (any, bool, error)) (any, error) {
	for attempt := 0; attempt < maxProjectWriteAttempts; attempt++ {
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
		document, err := handler.store.PutDocument(request.Context(), projectNamespace, projectCatalogKey, &revision, value)
		if errors.Is(err, postgres.ErrRevisionConflict) {
			if handler.cache != nil {
				_ = handler.cache.Delete(request.Context(), projectNamespace, projectCatalogKey)
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

func (handler *Projects) list(writer http.ResponseWriter, request *http.Request) {
	revision, catalog, err := handler.readCatalog(request)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "project catalog read failed")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"projects": catalog.Projects, "revision": revision})
}

func (handler *Projects) get(writer http.ResponseWriter, request *http.Request, projectID string) {
	_, catalog, err := handler.readCatalog(request)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "project catalog read failed")
		return
	}
	for _, project := range catalog.Projects {
		if project.ProjectID == projectID {
			writeJSON(writer, http.StatusOK, map[string]any{"project": project})
			return
		}
	}
	writeError(writer, http.StatusNotFound, "project not found")
}

func (handler *Projects) getByIdempotency(writer http.ResponseWriter, request *http.Request, idempotencyKey string) {
	ownerID := strings.TrimSpace(request.Header.Get("X-Actor-Id"))
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if ownerID == "" || idempotencyKey == "" {
		writeError(writer, http.StatusBadRequest, "owner and idempotency key are required")
		return
	}
	_, catalog, err := handler.readCatalog(request)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "project catalog read failed")
		return
	}
	projectID := catalog.Idempotency[ownerID+":"+idempotencyKey]
	for _, project := range catalog.Projects {
		if project.ProjectID == projectID {
			writeJSON(writer, http.StatusOK, map[string]any{"project": publicProject(project)})
			return
		}
	}
	writeError(writer, http.StatusNotFound, "project not found")
}

func (handler *Projects) create(writer http.ResponseWriter, request *http.Request) {
	ownerID := strings.TrimSpace(request.Header.Get("X-Actor-Id"))
	if ownerID == "" {
		writeError(writer, http.StatusBadRequest, "X-Actor-Id is required")
		return
	}
	var input struct {
		Name            string  `json:"name"`
		CreationSource  string  `json:"creationSource"`
		ProjectMode     string  `json:"projectMode"`
		Highlights      string  `json:"highlights"`
		VisualStyle     string  `json:"visualStyle"`
		ApprovalEnabled bool    `json:"approvalEnabled"`
		PasswordEnabled bool    `json:"passwordEnabled"`
		ProjectPassword *string `json:"projectPassword"`
		IdempotencyKey  string  `json:"idempotencyKey"`
		StylePrompt     *string `json:"stylePrompt"`
		PromptDirective *string `json:"promptDirective"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 1<<20))
	if err := decoder.Decode(&input); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid project payload")
		return
	}
	if input.StylePrompt != nil || input.PromptDirective != nil {
		writeError(writer, http.StatusBadRequest, "client style overrides are not allowed")
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Highlights = strings.TrimSpace(input.Highlights)
	input.VisualStyle = strings.TrimSpace(input.VisualStyle)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.Name == "" || utf8.RuneCountInString(input.Name) > projectNameMaxLength {
		writeError(writer, http.StatusBadRequest, "invalid project name")
		return
	}
	if input.CreationSource != "story" && input.CreationSource != "script-upload" {
		writeError(writer, http.StatusBadRequest, "invalid creation source")
		return
	}
	if input.ProjectMode != "canvas" && input.ProjectMode != "full-stack" {
		writeError(writer, http.StatusBadRequest, "invalid project mode")
		return
	}
	if !isValidProjectVisualStyle(input.VisualStyle) {
		writeError(writer, http.StatusBadRequest, "invalid project visual style")
		return
	}
	if utf8.RuneCountInString(input.Highlights) > projectHighlightsMaxLength {
		writeError(writer, http.StatusBadRequest, "project highlights too long")
		return
	}
	passwordHash, passwordSalt, err := projectPassword(input.PasswordEnabled, input.ProjectPassword)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	projectID, err := newProjectID()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "project id generation failed")
		return
	}
	now := requestTime()
	visualStyle := input.VisualStyle
	project := ProjectRecord{
		ProjectID: projectID, RootFolderID: projectID, Name: input.Name, OwnerID: ownerID,
		CreationSource: input.CreationSource, ProjectMode: input.ProjectMode, Status: "draft",
		Highlights: input.Highlights, VisualStyle: &visualStyle, ApprovalEnabled: input.ApprovalEnabled, PasswordEnabled: input.PasswordEnabled,
		PasswordHash: passwordHash, PasswordSalt: passwordSalt, CreatedAt: now, UpdatedAt: now,
	}
	result, err := handler.mutateCatalog(request, func(catalog *projectCatalog) (any, bool, error) {
		indexKey := ownerID + ":" + input.IdempotencyKey
		if input.IdempotencyKey != "" {
			if existingID := catalog.Idempotency[indexKey]; existingID != "" {
				for _, existing := range catalog.Projects {
					if existing.ProjectID == existingID {
						return struct {
							Project projectPublic `json:"project"`
							Reused  bool          `json:"reused"`
						}{publicProject(existing), true}, false, nil
					}
				}
			}
		}
		for _, existing := range catalog.Projects {
			if existing.OwnerID == project.OwnerID && existing.Name == project.Name {
				return nil, false, errProjectNameConflict
			}
		}
		catalog.Projects = append(catalog.Projects, project)
		if input.IdempotencyKey != "" {
			catalog.Idempotency[indexKey] = project.ProjectID
		}
		return struct {
			Project projectPublic `json:"project"`
			Reused  bool          `json:"reused"`
		}{publicProject(project), false}, true, nil
	})
	if errors.Is(err, errProjectNameConflict) {
		writeJSON(writer, http.StatusConflict, map[string]any{"error": "project name already exists", "code": "PROJECT_NAME_CONFLICT"})
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "project create failed")
		return
	}
	writeJSON(writer, http.StatusCreated, result)
}

func (handler *Projects) patch(writer http.ResponseWriter, request *http.Request, projectID string) {
	var input struct {
		Highlights      *string `json:"highlights"`
		VisualStyle     *string `json:"visualStyle"`
		Name            *string `json:"name"`
		OwnerID         *string `json:"ownerId"`
		StylePrompt     *string `json:"stylePrompt"`
		PromptDirective *string `json:"promptDirective"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 1<<20))
	if err := decoder.Decode(&input); err != nil || (input.Highlights == nil && input.Name == nil && input.OwnerID == nil && input.VisualStyle == nil) {
		writeError(writer, http.StatusBadRequest, "invalid project payload")
		return
	}
	if input.StylePrompt != nil || input.PromptDirective != nil {
		writeError(writer, http.StatusBadRequest, "client style overrides are not allowed")
		return
	}
	var highlights *string
	if input.Highlights != nil {
		value := strings.TrimSpace(*input.Highlights)
		if utf8.RuneCountInString(value) > projectHighlightsMaxLength {
			writeError(writer, http.StatusBadRequest, "project highlights too long")
			return
		}
		highlights = &value
	}
	var visualStyle *string
	if input.VisualStyle != nil {
		value := strings.TrimSpace(*input.VisualStyle)
		if !isValidProjectVisualStyle(value) {
			writeError(writer, http.StatusBadRequest, "invalid project visual style")
			return
		}
		visualStyle = &value
	}
	var name *string
	if input.Name != nil {
		value := strings.TrimSpace(*input.Name)
		if value == "" || utf8.RuneCountInString(value) > projectNameMaxLength {
			writeError(writer, http.StatusBadRequest, "invalid project name")
			return
		}
		name = &value
	}
	var ownerID *string
	if input.OwnerID != nil {
		value := strings.TrimSpace(*input.OwnerID)
		if value == "" {
			writeError(writer, http.StatusBadRequest, "invalid project owner")
			return
		}
		ownerID = &value
	}
	result, err := handler.mutateCatalog(request, func(catalog *projectCatalog) (any, bool, error) {
		index := -1
		for i, project := range catalog.Projects {
			if project.ProjectID == projectID {
				index = i
				break
			}
		}
		if index < 0 {
			return nil, false, postgres.ErrNotFound
		}
		project := catalog.Projects[index]
		nextOwnerID := project.OwnerID
		if ownerID != nil {
			nextOwnerID = *ownerID
		}
		if name != nil && project.Name != *name {
			for _, existing := range catalog.Projects {
				if existing.ProjectID != projectID && existing.OwnerID == nextOwnerID && existing.Name == *name {
					return nil, false, errProjectNameConflict
				}
			}
			project.Name = *name
		}
		if ownerID != nil && project.OwnerID != *ownerID {
			for _, existing := range catalog.Projects {
				if existing.ProjectID != projectID && existing.OwnerID == *ownerID && existing.Name == project.Name {
					return nil, false, errProjectNameConflict
				}
			}
			project.OwnerID = *ownerID
		}
		if highlights != nil {
			project.Highlights = *highlights
		}
		if visualStyle != nil {
			project.VisualStyle = visualStyle
		}
		project.UpdatedAt = requestTime()
		catalog.Projects[index] = project
		return map[string]any{"project": publicProject(project)}, true, nil
	})
	if errors.Is(err, postgres.ErrNotFound) {
		writeError(writer, http.StatusNotFound, "project not found")
		return
	}
	if errors.Is(err, errProjectNameConflict) {
		writeJSON(writer, http.StatusConflict, map[string]any{"error": "project name already exists", "code": "PROJECT_NAME_CONFLICT"})
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "project update failed")
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (handler *Projects) delete(writer http.ResponseWriter, request *http.Request, projectID string) {
	_, err := handler.mutateCatalog(request, func(catalog *projectCatalog) (any, bool, error) {
		next := make([]ProjectRecord, 0, len(catalog.Projects))
		found := false
		for _, project := range catalog.Projects {
			if project.ProjectID == projectID {
				found = true
				continue
			}
			next = append(next, project)
		}
		if !found {
			return nil, false, postgres.ErrNotFound
		}
		catalog.Projects = next
		for key, value := range catalog.Idempotency {
			if value == projectID {
				delete(catalog.Idempotency, key)
			}
		}
		return map[string]any{"ok": true, "projectId": projectID}, true, nil
	})
	if errors.Is(err, postgres.ErrNotFound) {
		writeError(writer, http.StatusNotFound, "project not found")
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "project delete failed")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"ok": true, "projectId": projectID})
}

var errProjectNameConflict = errors.New("project name conflict")

func publicProject(project ProjectRecord) projectPublic {
	return projectPublic{
		ProjectID: project.ProjectID, RootFolderID: project.RootFolderID, Name: project.Name,
		OwnerID: project.OwnerID, CreationSource: project.CreationSource, ProjectMode: project.ProjectMode,
		Status: project.Status, Highlights: project.Highlights, VisualStyle: project.VisualStyle,
		ApprovalEnabled: project.ApprovalEnabled,
		PasswordEnabled: project.PasswordEnabled,
		CreatedAt:       project.CreatedAt, UpdatedAt: project.UpdatedAt,
	}
}

func isValidProjectVisualStyle(value string) bool {
	switch value {
	case "live_action_cinematic",
		"three_d_animation",
		"hand_drawn_illustration",
		"two_d_animation",
		"comic",
		"traditional_chinese":
		return true
	default:
		return false
	}
}

func projectPassword(enabled bool, password *string) (*string, *string, error) {
	if !enabled {
		return nil, nil, nil
	}
	if password == nil || strings.TrimSpace(*password) == "" {
		return nil, nil, errors.New("project password is required")
	}
	saltBytes := make([]byte, 16)
	if _, err := rand.Read(saltBytes); err != nil {
		return nil, nil, err
	}
	salt := hex.EncodeToString(saltBytes)
	hashBytes, err := scrypt.Key([]byte(*password), []byte(salt), 16384, 8, 1, 64)
	if err != nil {
		return nil, nil, err
	}
	hash := hex.EncodeToString(hashBytes)
	return &hash, &salt, nil
}

func newProjectID() (string, error) {
	value := make([]byte, 6)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return "p_" + hex.EncodeToString(value), nil
}

func requestTime() string {
	return timeNow().UTC().Format("2006-01-02T15:04:05.000Z")
}

var timeNow = func() time.Time { return time.Now() }
