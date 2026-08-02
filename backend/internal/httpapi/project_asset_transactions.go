package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"infinite-canvas/backend/internal/blobstore"
	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

type projectAssetTransactionWrite struct {
	Namespace        string          `json:"namespace"`
	Key              string          `json:"key"`
	ExpectedRevision int64           `json:"expectedRevision"`
	Value            json.RawMessage `json:"value"`
}
type projectAssetTransactionInput struct {
	Writes     []projectAssetTransactionWrite `json:"writes"`
	BlobCopies []postgres.BlobCopy            `json:"blobCopies,omitempty"`
	BlobChecks []string                       `json:"blobChecks,omitempty"`
}
type ProjectAssetTransactions struct {
	store *postgres.Store
	cache *cache.Documents
	blobs blobstore.Store
}

func NewProjectAssetTransactions(store *postgres.Store, documentCache *cache.Documents, blobs blobstore.Store) *ProjectAssetTransactions {
	return &ProjectAssetTransactions{store: store, cache: documentCache, blobs: blobs}
}

var projectAssetTransactionNamespaces = map[string]bool{
	"asset-bundles": true, "episode-asset-designs": true, "asset-approvals": true,
	"workspace-snapshots": true, "workspace-assets": true, "workspace-episode-asset-designs": true,
	"notifications": true,
}

func (handler *ProjectAssetTransactions) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		methodNotAllowed(writer, "POST")
		return
	}
	var input projectAssetTransactionInput
	if decodeJSON(writer, request, &input) != nil {
		return
	}
	if len(input.Writes) == 0 {
		writeError(writer, http.StatusBadRequest, "writes are required")
		return
	}
	writes := make([]postgres.DocumentWrite, 0, len(input.Writes))
	for _, write := range input.Writes {
		if !projectAssetTransactionNamespaces[write.Namespace] || write.Key == "" || write.ExpectedRevision < 0 || len(write.Value) == 0 {
			writeError(writer, http.StatusBadRequest, "invalid project asset transaction")
			return
		}
		writes = append(writes, postgres.DocumentWrite{Namespace: write.Namespace, Key: write.Key, ExpectedRevision: write.ExpectedRevision, Value: write.Value})
	}
	documents, err := handler.store.PutDocumentsAtomic(request.Context(), writes, input.BlobCopies, input.BlobChecks)
	if errors.Is(err, postgres.ErrRevisionConflict) {
		writeError(writer, http.StatusConflict, "project asset transaction conflict")
		return
	}
	if errors.Is(err, blobstore.ErrNotFound) {
		writeError(writer, http.StatusUnprocessableEntity, "project asset blob missing")
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "project asset transaction failed")
		return
	}
	if handler.cache != nil {
		for _, document := range documents {
			_ = handler.cache.Set(request.Context(), document)
		}
	}
	writeJSON(writer, http.StatusOK, map[string]any{"documents": documents})
}
