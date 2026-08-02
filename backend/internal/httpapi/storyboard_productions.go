package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

const storyboardProductionNamespace = "storyboard-productions"

type storyboardProductionSaveInput struct {
	ExpectedRevision int64          `json:"expectedRevision"`
	Workspace        map[string]any `json:"workspace"`
}

type StoryboardProductions struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewStoryboardProductions(store *postgres.Store, documentCache *cache.Documents) *StoryboardProductions {
	return &StoryboardProductions{store: store, cache: documentCache}
}

func (handler *StoryboardProductions) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet:
		handler.get(writer, request)
	case http.MethodPost:
		handler.save(writer, request)
	default:
		methodNotAllowed(writer, "GET, POST")
	}
}

func validStoryboardWorkspace(workspace map[string]any, projectID string) bool {
	storedProjectID, _ := workspace["projectId"].(string)
	_, productionsOK := workspace["productions"].([]any)
	return storedProjectID == projectID && productionsOK
}

func (handler *StoryboardProductions) read(request *http.Request, projectID string) (postgres.Document, bool, error) {
	if handler.cache != nil {
		if document, ok := handler.cache.Get(request.Context(), storyboardProductionNamespace, projectID); ok {
			return document, true, nil
		}
	}
	document, err := handler.store.GetDocument(request.Context(), storyboardProductionNamespace, projectID)
	if errors.Is(err, postgres.ErrNotFound) {
		return postgres.Document{}, false, nil
	}
	if err != nil {
		return postgres.Document{}, false, err
	}
	if handler.cache != nil {
		_ = handler.cache.Set(request.Context(), document)
	}
	return document, true, nil
}

func (handler *StoryboardProductions) get(writer http.ResponseWriter, request *http.Request) {
	projectID := strings.TrimSpace(request.URL.Query().Get("projectId"))
	if projectID == "" {
		writeError(writer, http.StatusBadRequest, "projectId is required")
		return
	}
	document, found, err := handler.read(request, projectID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "storyboard production read failed")
		return
	}
	if !found {
		writeJSON(writer, http.StatusOK, map[string]any{"workspace": nil, "revision": 0})
		return
	}
	var workspace map[string]any
	if json.Unmarshal(document.Value, &workspace) != nil || !validStoryboardWorkspace(workspace, projectID) {
		writeError(writer, http.StatusConflict, "storyboard production corrupted")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"workspace": workspace, "revision": document.Revision})
}

func (handler *StoryboardProductions) save(writer http.ResponseWriter, request *http.Request) {
	var input storyboardProductionSaveInput
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	projectID := strings.TrimSpace(request.URL.Query().Get("projectId"))
	if projectID == "" || input.ExpectedRevision < 0 || !validStoryboardWorkspace(input.Workspace, projectID) {
		writeError(writer, http.StatusBadRequest, "invalid storyboard production")
		return
	}
	input.Workspace["updatedAt"] = requestTime()
	value, _ := json.Marshal(input.Workspace)
	document, err := handler.store.PutDocument(request.Context(), storyboardProductionNamespace, projectID, &input.ExpectedRevision, value)
	if errors.Is(err, postgres.ErrRevisionConflict) {
		if handler.cache != nil {
			_ = handler.cache.Delete(request.Context(), storyboardProductionNamespace, projectID)
		}
		writeError(writer, http.StatusConflict, "storyboard production revision conflict")
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "storyboard production write failed")
		return
	}
	if handler.cache != nil {
		_ = handler.cache.Set(request.Context(), document)
	}
	writeJSON(writer, http.StatusOK, map[string]any{"workspace": input.Workspace, "revision": document.Revision})
}
