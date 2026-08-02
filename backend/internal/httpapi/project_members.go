package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

const memberNamespace = "project-members"
const memberCatalogKey = "catalog"
const maxMemberWriteAttempts = 6

type projectMember struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	UserID    string `json:"userId"`
	Role      string `json:"role"`
	CreatedAt string `json:"createdAt"`
	CreatedBy string `json:"createdBy"`
}

type memberCatalog struct {
	Version int             `json:"version"`
	Members []projectMember `json:"members"`
}

type ProjectMembers struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewProjectMembers(store *postgres.Store, documentCache *cache.Documents) *ProjectMembers {
	return &ProjectMembers{store: store, cache: documentCache}
}

func (handler *ProjectMembers) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if request.URL.Path != "/v1/project-members" && request.URL.Path != "/v1/project-members/" {
		writeError(writer, http.StatusNotFound, "not found")
		return
	}
	switch request.Method {
	case http.MethodGet:
		handler.list(writer, request)
	case http.MethodPost:
		handler.add(writer, request)
	case http.MethodDelete:
		handler.remove(writer, request)
	default:
		methodNotAllowed(writer, "GET, POST, DELETE")
	}
}

func normalizeMemberCatalog(catalog memberCatalog) memberCatalog {
	if catalog.Version == 0 {
		catalog.Version = 1
	}
	if catalog.Members == nil {
		catalog.Members = []projectMember{}
	}
	valid := catalog.Members[:0]
	for _, member := range catalog.Members {
		if member.ID != "" && member.ProjectID != "" && member.UserID != "" && member.Role == "CARD_ENGINEER" {
			valid = append(valid, member)
		}
	}
	catalog.Members = valid
	return catalog
}

func (handler *ProjectMembers) readCatalog(request *http.Request) (int64, memberCatalog, error) {
	if handler.cache != nil {
		if document, ok := handler.cache.Get(request.Context(), memberNamespace, memberCatalogKey); ok {
			var catalog memberCatalog
			if json.Unmarshal(document.Value, &catalog) == nil {
				return document.Revision, normalizeMemberCatalog(catalog), nil
			}
		}
	}
	document, err := handler.store.GetDocument(request.Context(), memberNamespace, memberCatalogKey)
	if errors.Is(err, postgres.ErrNotFound) {
		return 0, memberCatalog{Version: 1, Members: []projectMember{}}, nil
	}
	if err != nil {
		return 0, memberCatalog{}, err
	}
	var catalog memberCatalog
	if err := json.Unmarshal(document.Value, &catalog); err != nil {
		return 0, memberCatalog{}, err
	}
	if handler.cache != nil {
		_ = handler.cache.Set(request.Context(), document)
	}
	return document.Revision, normalizeMemberCatalog(catalog), nil
}

func (handler *ProjectMembers) mutateCatalog(request *http.Request, mutate func(*memberCatalog) (any, bool, error)) (any, error) {
	for attempt := 0; attempt < maxMemberWriteAttempts; attempt++ {
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
		document, err := handler.store.PutDocument(request.Context(), memberNamespace, memberCatalogKey, &revision, value)
		if errors.Is(err, postgres.ErrRevisionConflict) {
			if handler.cache != nil {
				_ = handler.cache.Delete(request.Context(), memberNamespace, memberCatalogKey)
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

func (handler *ProjectMembers) list(writer http.ResponseWriter, request *http.Request) {
	projectID := strings.TrimSpace(request.URL.Query().Get("projectId"))
	userID := strings.TrimSpace(request.URL.Query().Get("userId"))
	_, catalog, err := handler.readCatalog(request)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "member catalog read failed")
		return
	}
	members := make([]projectMember, 0)
	for _, member := range catalog.Members {
		if projectID != "" && member.ProjectID != projectID {
			continue
		}
		if userID != "" && member.UserID != userID {
			continue
		}
		members = append(members, member)
	}
	writeJSON(writer, http.StatusOK, map[string]any{"members": members})
}

func (handler *ProjectMembers) add(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		ProjectID string `json:"projectId"`
		UserID    string `json:"userId"`
		CreatedBy string `json:"createdBy"`
	}
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	input.ProjectID = strings.TrimSpace(input.ProjectID)
	input.UserID = strings.TrimSpace(input.UserID)
	input.CreatedBy = strings.TrimSpace(input.CreatedBy)
	if input.ProjectID == "" || input.UserID == "" || input.CreatedBy == "" {
		writeError(writer, http.StatusBadRequest, "projectId, userId and createdBy are required")
		return
	}
	memberID, err := newMemberID()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "member id generation failed")
		return
	}
	member := projectMember{ID: memberID, ProjectID: input.ProjectID, UserID: input.UserID, Role: "CARD_ENGINEER", CreatedAt: requestTime(), CreatedBy: input.CreatedBy}
	result, err := handler.mutateCatalog(request, func(catalog *memberCatalog) (any, bool, error) {
		for _, existing := range catalog.Members {
			if existing.ProjectID == input.ProjectID && existing.UserID == input.UserID {
				return nil, false, errors.New("该用户已是本项目的抽卡工程师")
			}
		}
		catalog.Members = append(catalog.Members, member)
		return map[string]any{"member": member}, true, nil
	})
	if err != nil {
		writeError(writer, http.StatusConflict, err.Error())
		return
	}
	writeJSON(writer, http.StatusCreated, result)
}

func (handler *ProjectMembers) remove(writer http.ResponseWriter, request *http.Request) {
	projectID := strings.TrimSpace(request.URL.Query().Get("projectId"))
	userID := strings.TrimSpace(request.URL.Query().Get("userId"))
	if projectID == "" || userID == "" {
		writeError(writer, http.StatusBadRequest, "projectId and userId are required")
		return
	}
	result, err := handler.mutateCatalog(request, func(catalog *memberCatalog) (any, bool, error) {
		next := make([]projectMember, 0, len(catalog.Members))
		removed := false
		for _, member := range catalog.Members {
			if member.ProjectID == projectID && member.UserID == userID {
				removed = true
				continue
			}
			next = append(next, member)
		}
		if !removed {
			return map[string]any{"removed": false}, false, nil
		}
		catalog.Members = next
		return map[string]any{"removed": true}, true, nil
	})
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "member remove failed")
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func newMemberID() (string, error) {
	value := make([]byte, 6)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return "pm_" + hex.EncodeToString(value), nil
}
