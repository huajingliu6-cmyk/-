package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

const enterpriseNamespace = "enterprises"
const enterpriseCatalogKey = "catalog"

type Enterprises struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewEnterprises(store *postgres.Store, documentCache *cache.Documents) *Enterprises {
	return &Enterprises{store: store, cache: documentCache}
}

func (handler *Enterprises) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if request.URL.Path != "/v1/enterprises/catalog" {
		writeError(writer, http.StatusNotFound, "enterprise resource not found")
		return
	}
	switch request.Method {
	case http.MethodGet:
		handler.getCatalog(writer, request)
	case http.MethodPut:
		handler.putCatalog(writer, request)
	default:
		methodNotAllowed(writer, "GET, PUT")
	}
}

func (handler *Enterprises) getCatalog(writer http.ResponseWriter, request *http.Request) {
	document, _, err := handler.cache.GetOrFetch(request.Context(), enterpriseNamespace, enterpriseCatalogKey, func() (postgres.Document, error) {
		return handler.store.GetDocument(request.Context(), enterpriseNamespace, enterpriseCatalogKey)
	})
	if errors.Is(err, postgres.ErrNotFound) {
		writeError(writer, http.StatusNotFound, "enterprise catalog not found")
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "enterprise catalog read failed")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"revision": document.Revision,
		"value":    json.RawMessage(document.Value),
	})
}

func (handler *Enterprises) putCatalog(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		ExpectedRevision int64           `json:"expectedRevision"`
		Value            json.RawMessage `json:"value"`
	}
	if decodeJSON(writer, request, &input) != nil {
		return
	}
	if input.ExpectedRevision < 0 || !json.Valid(input.Value) {
		writeError(writer, http.StatusBadRequest, "invalid enterprise catalog")
		return
	}
	document, err := handler.store.PutDocument(request.Context(), enterpriseNamespace, enterpriseCatalogKey, &input.ExpectedRevision, input.Value)
	if errors.Is(err, postgres.ErrRevisionConflict) {
		writeError(writer, http.StatusConflict, "enterprise catalog revision conflict")
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "enterprise catalog write failed")
		return
	}
	if handler.cache != nil {
		_ = handler.cache.Set(request.Context(), document)
	}
	writeJSON(writer, http.StatusOK, map[string]any{"revision": document.Revision})
}
