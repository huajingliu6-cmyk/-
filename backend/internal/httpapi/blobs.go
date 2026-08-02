package httpapi

import (
	"errors"
	"io"
	"net/http"
	"strings"

	"infinite-canvas/backend/internal/blobstore"
)

type Blobs struct{ store blobstore.Store }

func NewBlobs(store blobstore.Store) *Blobs { return &Blobs{store: store} }

func (handler *Blobs) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	key := strings.TrimPrefix(request.URL.Path, `/v1/blobs/`)
	if key == `` || strings.Contains(key, `..`) || strings.HasPrefix(key, `/`) {
		writeError(writer, http.StatusBadRequest, `invalid storage key`)
		return
	}
	switch request.Method {
	case http.MethodGet:
		handler.get(writer, request, key)
	case http.MethodPut:
		handler.put(writer, request, key)
	case http.MethodDelete:
		handler.delete(writer, request, key)
	default:
		writer.Header().Set(`Allow`, `GET, PUT, DELETE`)
		writeError(writer, http.StatusMethodNotAllowed, `method not allowed`)
	}
}

func (handler *Blobs) get(writer http.ResponseWriter, request *http.Request, key string) {
	blob, err := handler.store.GetBlob(request.Context(), key)
	if errors.Is(err, blobstore.ErrNotFound) {
		writeError(writer, http.StatusNotFound, `blob not found`)
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, `database read failed`)
		return
	}
	writer.Header().Set(`Content-Type`, blob.ContentType)
	writer.Header().Set(`ETag`, blob.SHA256)
	writer.Header().Set(`Cache-Control`, `private, no-store`)
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(blob.Body)
}

func (handler *Blobs) put(writer http.ResponseWriter, request *http.Request, key string) {
	body, err := io.ReadAll(http.MaxBytesReader(writer, request.Body, 256<<20))
	if err != nil {
		writeError(writer, http.StatusRequestEntityTooLarge, `blob too large`)
		return
	}
	contentType := strings.TrimSpace(request.Header.Get(`Content-Type`))
	if contentType == `` {
		contentType = `application/octet-stream`
	}
	blob, err := handler.store.PutBlob(request.Context(), key, contentType, body)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, `database write failed`)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		`storageKey`:    blob.StorageKey,
		`contentType`:   blob.ContentType,
		`contentLength`: blob.ContentLength,
		`sha256`:        blob.SHA256,
		`updatedAt`:     blob.UpdatedAt,
	})
}

func (handler *Blobs) delete(writer http.ResponseWriter, request *http.Request, key string) {
	if err := handler.store.DeleteBlob(request.Context(), key); err != nil {
		writeError(writer, http.StatusInternalServerError, `database delete failed`)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}
