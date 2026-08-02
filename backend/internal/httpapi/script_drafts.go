package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

const scriptDraftNamespace = "script-drafts"
const maxScriptDraftWriteAttempts = 6

type ScriptDrafts struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewScriptDrafts(store *postgres.Store, documentCache *cache.Documents) *ScriptDrafts {
	return &ScriptDrafts{store: store, cache: documentCache}
}

func (handler *ScriptDrafts) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet:
		handler.get(writer, request)
	case http.MethodPost:
		handler.save(writer, request)
	default:
		methodNotAllowed(writer, "GET, POST")
	}
}

func validScriptDraft(draft map[string]any) bool {
	projectID, _ := draft["projectId"].(string)
	return strings.TrimSpace(projectID) != ""
}

func (handler *ScriptDrafts) read(request *http.Request, projectID string) (postgres.Document, bool, error) {
	if handler.cache != nil {
		if document, ok := handler.cache.Get(request.Context(), scriptDraftNamespace, projectID); ok {
			return document, true, nil
		}
	}
	document, err := handler.store.GetDocument(request.Context(), scriptDraftNamespace, projectID)
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

func (handler *ScriptDrafts) get(writer http.ResponseWriter, request *http.Request) {
	projectID := strings.TrimSpace(request.URL.Query().Get("projectId"))
	if projectID == "" {
		writeError(writer, http.StatusBadRequest, "projectId is required")
		return
	}
	document, found, err := handler.read(request, projectID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "script draft read failed")
		return
	}
	if !found {
		writeJSON(writer, http.StatusOK, map[string]any{"draft": nil})
		return
	}
	var draft map[string]any
	if json.Unmarshal(document.Value, &draft) != nil || !validScriptDraft(draft) || draft["projectId"] != projectID {
		writeError(writer, http.StatusConflict, "script draft corrupted")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"draft": draft})
}

func (handler *ScriptDrafts) save(writer http.ResponseWriter, request *http.Request) {
	var draft map[string]any
	if err := decodeJSON(writer, request, &draft); err != nil {
		return
	}
	if !validScriptDraft(draft) {
		writeError(writer, http.StatusBadRequest, "invalid script draft")
		return
	}
	projectID := strings.TrimSpace(draft["projectId"].(string))
	for attempt := 0; attempt < maxScriptDraftWriteAttempts; attempt++ {
		document, found, err := handler.read(request, projectID)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "script draft read failed")
			return
		}
		draft["updatedAt"] = requestTime()
		value, _ := json.Marshal(draft)
		revision := int64(0)
		if found {
			revision = document.Revision
		}
		written, writeErr := handler.store.PutDocument(request.Context(), scriptDraftNamespace, projectID, &revision, value)
		if errors.Is(writeErr, postgres.ErrRevisionConflict) {
			if handler.cache != nil {
				_ = handler.cache.Delete(request.Context(), scriptDraftNamespace, projectID)
			}
			continue
		}
		if writeErr != nil {
			writeError(writer, http.StatusInternalServerError, "script draft write failed")
			return
		}
		if handler.cache != nil {
			_ = handler.cache.Set(request.Context(), written)
		}
		writeJSON(writer, http.StatusOK, map[string]any{"draft": draft})
		return
	}
	writeError(writer, http.StatusConflict, "script draft write conflict")
}
