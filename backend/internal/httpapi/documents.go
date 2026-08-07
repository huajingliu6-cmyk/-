package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

type Documents struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewDocuments(store *postgres.Store, documentCache *cache.Documents) *Documents {
	return &Documents{store: store, cache: documentCache}
}

func (h *Documents) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	namespace, key, ok := documentIdentity(request.URL.Path)
	if !ok {
		writeError(writer, http.StatusBadRequest, `invalid document path`)
		return
	}
	switch request.Method {
	case http.MethodGet:
		h.get(writer, request, namespace, key)
	case http.MethodPut:
		h.put(writer, request, namespace, key)
	case http.MethodDelete:
		h.delete(writer, request, namespace, key)
	default:
		writer.Header().Set(`Allow`, `GET, PUT, DELETE`)
		writeError(writer, http.StatusMethodNotAllowed, `method not allowed`)
	}
}

func (h *Documents) get(writer http.ResponseWriter, request *http.Request, namespace string, key string) {
	document, _, err := h.cache.GetOrFetch(request.Context(), namespace, key, func() (postgres.Document, error) {
		return h.store.GetDocument(request.Context(), namespace, key)
	})
	if errors.Is(err, postgres.ErrNotFound) {
		writeError(writer, http.StatusNotFound, `document not found`)
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, `database read failed`)
		return
	}
	writeJSON(writer, http.StatusOK, document)
}

func (h *Documents) put(writer http.ResponseWriter, request *http.Request, namespace string, key string) {
	var input struct {
		ExpectedRevision *int64          `json:"expectedRevision"`
		Value            json.RawMessage `json:"value"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 16<<20))
	if err := decoder.Decode(&input); err != nil || !json.Valid(input.Value) {
		writeError(writer, http.StatusBadRequest, `invalid document payload`)
		return
	}
	document, err := h.store.PutDocument(request.Context(), namespace, key, input.ExpectedRevision, input.Value)
	if errors.Is(err, postgres.ErrRevisionConflict) {
		writeError(writer, http.StatusConflict, `revision conflict`)
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, `database write failed`)
		return
	}
	_ = h.cache.Set(request.Context(), document)
	writeJSON(writer, http.StatusOK, document)
}

func (h *Documents) delete(writer http.ResponseWriter, request *http.Request, namespace string, key string) {
	if err := h.store.DeleteDocument(request.Context(), namespace, key); err != nil {
		writeError(writer, http.StatusInternalServerError, `database delete failed`)
		return
	}
	_ = h.cache.Delete(request.Context(), namespace, key)
	writer.WriteHeader(http.StatusNoContent)
}

func documentIdentity(path string) (string, string, bool) {
	parts := strings.Split(strings.TrimPrefix(path, `/v1/documents/`), `/`)
	if len(parts) < 2 || parts[0] == `` {
		return ``, ``, false
	}
	key := strings.Join(parts[1:], `/`)
	if key == `` || strings.Contains(key, `..`) {
		return ``, ``, false
	}
	return parts[0], key, true
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set(`Content-Type`, `application/json; charset=utf-8`)
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func writeError(writer http.ResponseWriter, status int, message string) {
	writeJSON(writer, status, map[string]string{`error`: message})
}

func WriteHealth(writer http.ResponseWriter, status int, value map[string]string) {
	writeJSON(writer, status, value)
}
