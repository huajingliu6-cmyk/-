package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

const projectTextNamespace = "project-text"
const maxProjectTextWriteAttempts = 6

type projectTextCatalog struct {
	Version           int              `json:"version"`
	Draft             map[string]any   `json:"draft"`
	Documents         []map[string]any `json:"documents"`
	CurrentDocumentID *string          `json:"currentDocumentId"`
}

type projectTextCommand struct {
	Action string         `json:"action"`
	Draft  map[string]any `json:"draft,omitempty"`
	Input  map[string]any `json:"input,omitempty"`
}

type ProjectTextDocuments struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewProjectTextDocuments(store *postgres.Store, documentCache *cache.Documents) *ProjectTextDocuments {
	return &ProjectTextDocuments{store: store, cache: documentCache}
}

func (handler *ProjectTextDocuments) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet:
		handler.get(writer, request)
	case http.MethodPost:
		handler.command(writer, request)
	default:
		methodNotAllowed(writer, "GET, POST")
	}
}

func emptyProjectTextCatalog() projectTextCatalog {
	return projectTextCatalog{Version: 1, Documents: []map[string]any{}}
}

func projectTextString(value map[string]any, key string) string {
	text, _ := value[key].(string)
	return text
}

func validProjectTextDocument(document map[string]any) bool {
	_, versionOK := document["version"].(float64)
	return projectTextString(document, "documentId") != "" && projectTextString(document, "projectId") != "" && projectTextString(document, "content") != "" && versionOK
}

func normalizeProjectTextCatalog(catalog projectTextCatalog) projectTextCatalog {
	catalog.Version = 1
	if catalog.Documents == nil {
		catalog.Documents = []map[string]any{}
	}
	documents := make([]map[string]any, 0, len(catalog.Documents))
	for _, document := range catalog.Documents {
		if validProjectTextDocument(document) {
			documents = append(documents, document)
		}
	}
	catalog.Documents = documents
	if catalog.Draft != nil && projectTextString(catalog.Draft, "projectId") == "" {
		catalog.Draft = nil
	}
	return catalog
}

func (handler *ProjectTextDocuments) read(request *http.Request, projectID string) (int64, projectTextCatalog, error) {
	if handler.cache != nil {
		if document, ok := handler.cache.Get(request.Context(), projectTextNamespace, projectID); ok {
			var catalog projectTextCatalog
			if json.Unmarshal(document.Value, &catalog) == nil {
				return document.Revision, normalizeProjectTextCatalog(catalog), nil
			}
		}
	}
	document, err := handler.store.GetDocument(request.Context(), projectTextNamespace, projectID)
	if errors.Is(err, postgres.ErrNotFound) {
		return 0, emptyProjectTextCatalog(), nil
	}
	if err != nil {
		return 0, projectTextCatalog{}, err
	}
	var catalog projectTextCatalog
	if json.Unmarshal(document.Value, &catalog) != nil {
		return 0, projectTextCatalog{}, errors.New("corrupted")
	}
	if handler.cache != nil {
		_ = handler.cache.Set(request.Context(), document)
	}
	return document.Revision, normalizeProjectTextCatalog(catalog), nil
}

func (handler *ProjectTextDocuments) get(writer http.ResponseWriter, request *http.Request) {
	projectID := strings.TrimSpace(request.URL.Query().Get("projectId"))
	if projectID == "" {
		writeError(writer, http.StatusBadRequest, "projectId is required")
		return
	}
	_, catalog, err := handler.read(request, projectID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "project text read failed")
		return
	}
	switch request.URL.Query().Get("view") {
	case "draft":
		writeJSON(writer, http.StatusOK, map[string]any{"draft": catalog.Draft})
	case "current":
		var current map[string]any
		if catalog.CurrentDocumentID != nil {
			for _, document := range catalog.Documents {
				if projectTextString(document, "documentId") == *catalog.CurrentDocumentID {
					current = document
					break
				}
			}
		}
		writeJSON(writer, http.StatusOK, map[string]any{"document": current})
	default:
		documents := append([]map[string]any{}, catalog.Documents...)
		sort.SliceStable(documents, func(left, right int) bool {
			return documents[left]["version"].(float64) > documents[right]["version"].(float64)
		})
		writeJSON(writer, http.StatusOK, map[string]any{"documents": documents})
	}
}

func (handler *ProjectTextDocuments) command(writer http.ResponseWriter, request *http.Request) {
	var command projectTextCommand
	if err := decodeJSON(writer, request, &command); err != nil {
		return
	}
	switch command.Action {
	case "saveDraft":
		handler.saveDraft(writer, request, command.Draft)
	case "saveVersion":
		handler.saveVersion(writer, request, command.Input)
	default:
		writeError(writer, http.StatusBadRequest, "invalid project text action")
	}
}

func (handler *ProjectTextDocuments) saveDraft(writer http.ResponseWriter, request *http.Request, draft map[string]any) {
	projectID := strings.TrimSpace(projectTextString(draft, "projectId"))
	if projectID == "" {
		writeError(writer, http.StatusBadRequest, "invalid story draft")
		return
	}
	handler.mutate(writer, request, projectID, func(catalog *projectTextCatalog) (any, error) {
		catalog.Draft = draft
		return map[string]bool{"ok": true}, nil
	})
}

func (handler *ProjectTextDocuments) saveVersion(writer http.ResponseWriter, request *http.Request, input map[string]any) {
	projectID := strings.TrimSpace(projectTextString(input, "projectId"))
	if projectID == "" || projectTextString(input, "content") == "" {
		writeError(writer, http.StatusBadRequest, "invalid text document")
		return
	}
	handler.mutate(writer, request, projectID, func(catalog *projectTextCatalog) (any, error) {
		maximum := 0
		for _, existing := range catalog.Documents {
			if value, ok := existing["version"].(float64); ok && int(value) > maximum {
				maximum = int(value)
			}
		}
		id, err := newUUID()
		if err != nil {
			return nil, err
		}
		document := make(map[string]any, len(input)+4)
		for key, value := range input {
			document[key] = value
		}
		documentID := "doc_" + strings.ReplaceAll(id, "-", "")[:12]
		document["documentId"] = documentID
		document["version"] = maximum + 1
		document["createdAt"] = requestTime()
		catalog.Documents = append(catalog.Documents, document)
		catalog.CurrentDocumentID = &documentID
		return map[string]any{"document": document}, nil
	})
}

func (handler *ProjectTextDocuments) mutate(writer http.ResponseWriter, request *http.Request, projectID string, mutation func(*projectTextCatalog) (any, error)) {
	for attempt := 0; attempt < maxProjectTextWriteAttempts; attempt++ {
		revision, catalog, err := handler.read(request, projectID)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "project text read failed")
			return
		}
		result, err := mutation(&catalog)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "project text mutation failed")
			return
		}
		value, _ := json.Marshal(catalog)
		document, writeErr := handler.store.PutDocument(request.Context(), projectTextNamespace, projectID, &revision, value)
		if errors.Is(writeErr, postgres.ErrRevisionConflict) {
			if handler.cache != nil {
				_ = handler.cache.Delete(request.Context(), projectTextNamespace, projectID)
			}
			continue
		}
		if writeErr != nil {
			writeError(writer, http.StatusInternalServerError, "project text write failed")
			return
		}
		if handler.cache != nil {
			_ = handler.cache.Set(request.Context(), document)
		}
		writeJSON(writer, http.StatusOK, result)
		return
	}
	writeError(writer, http.StatusConflict, "project text write conflict")
}
