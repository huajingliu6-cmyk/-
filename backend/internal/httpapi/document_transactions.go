package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"infinite-canvas/backend/internal/blobstore"
	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

const maxAtomicDocumentWrites = 8
const maxAtomicBlobCopies = 16

type DocumentTransactions struct {
	store       *postgres.Store
	cache       *cache.Documents
	blobStorage blobstore.Store
}

func NewDocumentTransactions(store *postgres.Store, documentCache *cache.Documents, blobStorage blobstore.Store) *DocumentTransactions {
	return &DocumentTransactions{store: store, cache: documentCache, blobStorage: blobStorage}
}

func (handler *DocumentTransactions) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writer.Header().Set("Allow", "POST")
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var input struct {
		Writes []struct {
			Namespace        string          `json:"namespace"`
			Key              string          `json:"key"`
			ExpectedRevision int64           `json:"expectedRevision"`
			Value            json.RawMessage `json:"value"`
		} `json:"writes"`
		BlobCopies []struct {
			SourceStorageKey string `json:"sourceStorageKey"`
			TargetStorageKey string `json:"targetStorageKey"`
		} `json:"blobCopies"`
		BlobChecks []string `json:"blobChecks"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 32<<20))
	if err := decoder.Decode(&input); err != nil || len(input.Writes) < 2 || len(input.Writes) > maxAtomicDocumentWrites {
		writeError(writer, http.StatusBadRequest, "invalid atomic document payload")
		return
	}

	seen := make(map[string]struct{}, len(input.Writes))
	writes := make([]postgres.DocumentWrite, 0, len(input.Writes))
	for _, inputWrite := range input.Writes {
		namespace := strings.TrimSpace(inputWrite.Namespace)
		key := strings.TrimSpace(inputWrite.Key)
		identity := namespace + "\x00" + key
		if namespace == "" || key == "" || strings.Contains(key, "..") || inputWrite.ExpectedRevision < 0 || !json.Valid(inputWrite.Value) {
			writeError(writer, http.StatusBadRequest, "invalid atomic document write")
			return
		}
		if _, exists := seen[identity]; exists {
			writeError(writer, http.StatusBadRequest, "duplicate atomic document write")
			return
		}
		seen[identity] = struct{}{}
		writes = append(writes, postgres.DocumentWrite{
			Namespace:        namespace,
			Key:              key,
			ExpectedRevision: inputWrite.ExpectedRevision,
			Value:            inputWrite.Value,
		})
	}
	if len(input.BlobCopies) > maxAtomicBlobCopies {
		writeError(writer, http.StatusBadRequest, "too many atomic blob copies")
		return
	}
	blobCopies := make([]postgres.BlobCopy, 0, len(input.BlobCopies))
	seenBlobTargets := make(map[string]struct{}, len(input.BlobCopies))
	for _, inputCopy := range input.BlobCopies {
		source := strings.TrimSpace(inputCopy.SourceStorageKey)
		target := strings.TrimSpace(inputCopy.TargetStorageKey)
		if source == "" || target == "" || strings.Contains(source, "..") || strings.Contains(target, "..") {
			writeError(writer, http.StatusBadRequest, "invalid atomic blob copy")
			return
		}
		if _, exists := seenBlobTargets[target]; exists {
			writeError(writer, http.StatusBadRequest, "duplicate atomic blob target")
			return
		}
		seenBlobTargets[target] = struct{}{}
		blobCopies = append(blobCopies, postgres.BlobCopy{
			SourceStorageKey: source,
			TargetStorageKey: target,
		})
	}
	if len(input.BlobChecks) > maxAtomicBlobCopies {
		writeError(writer, http.StatusBadRequest, "too many atomic blob checks")
		return
	}
	blobChecks := make([]string, 0, len(input.BlobChecks))
	seenBlobChecks := make(map[string]struct{}, len(input.BlobChecks))
	for _, inputCheck := range input.BlobChecks {
		storageKey := strings.TrimSpace(inputCheck)
		if storageKey == "" || strings.Contains(storageKey, "..") {
			writeError(writer, http.StatusBadRequest, "invalid atomic blob check")
			return
		}
		if _, exists := seenBlobChecks[storageKey]; exists {
			continue
		}
		seenBlobChecks[storageKey] = struct{}{}
		blobChecks = append(blobChecks, storageKey)
	}
	preflightChecks := append([]string{}, blobChecks...)
	for _, blobCopy := range blobCopies {
		preflightChecks = append(preflightChecks, blobCopy.SourceStorageKey)
	}
	for _, storageKey := range preflightChecks {
		exists, err := handler.blobStorage.BlobExists(request.Context(), storageKey)
		if err != nil {
			writeError(writer, http.StatusServiceUnavailable, "blob storage check failed")
			return
		}
		if !exists {
			writeError(writer, http.StatusUnprocessableEntity, "source blob not found")
			return
		}
	}

	documents, err := handler.store.PutDocumentsAtomic(request.Context(), writes, blobCopies, blobChecks)
	if errors.Is(err, postgres.ErrRevisionConflict) {
		writeError(writer, http.StatusConflict, "revision conflict")
		return
	}
	if errors.Is(err, postgres.ErrNotFound) {
		writeError(writer, http.StatusUnprocessableEntity, "source blob not found")
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "database transaction failed")
		return
	}
	for _, document := range documents {
		_ = handler.cache.Delete(request.Context(), document.Namespace, document.Key)
		_ = handler.cache.Set(request.Context(), document)
	}
	writeJSON(writer, http.StatusOK, map[string]any{"documents": documents})
}
