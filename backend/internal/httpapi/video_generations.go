package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

const videoGenerationNamespace = "video-generations"
const videoGenerationIndexNamespace = "video-generation-index"
const videoGenerationIndexKey = "all"
const maxVideoGenerationWriteAttempts = 6

var safeVideoGenerationID = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

type videoGenerationIndex struct {
	Version       int      `json:"version"`
	GenerationIDs []string `json:"generationIds"`
	UpdatedAt     string   `json:"updatedAt"`
}

type VideoGenerations struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewVideoGenerations(store *postgres.Store, documentCache *cache.Documents) *VideoGenerations {
	return &VideoGenerations{store: store, cache: documentCache}
}

func (handler *VideoGenerations) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet:
		handler.get(writer, request)
	case http.MethodPost:
		handler.save(writer, request)
	case http.MethodPatch:
		handler.patch(writer, request)
	default:
		methodNotAllowed(writer, "GET, POST, PATCH")
	}
}

func videoGenerationString(record map[string]any, key string) string {
	value, _ := record[key].(string)
	return value
}

func validVideoGenerationRecord(record map[string]any) bool {
	id := videoGenerationString(record, "id")
	return safeVideoGenerationID.MatchString(id) &&
		videoGenerationString(record, "projectId") != "" &&
		videoGenerationString(record, "shotNodeId") != "" &&
		videoGenerationString(record, "status") != "" &&
		videoGenerationString(record, "createdAt") != "" &&
		videoGenerationString(record, "updatedAt") != ""
}

func normalizeVideoGenerationIndex(index videoGenerationIndex) videoGenerationIndex {
	seen := make(map[string]struct{}, len(index.GenerationIDs))
	generationIDs := make([]string, 0, len(index.GenerationIDs))
	for _, id := range index.GenerationIDs {
		if !safeVideoGenerationID.MatchString(id) {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		generationIDs = append(generationIDs, id)
	}
	index.Version = 1
	index.GenerationIDs = generationIDs
	if index.UpdatedAt == "" {
		index.UpdatedAt = requestTime()
	}
	return index
}

func (handler *VideoGenerations) readDocument(request *http.Request, namespace, key string) (postgres.Document, bool, error) {
	if handler.cache != nil {
		if document, ok := handler.cache.Get(request.Context(), namespace, key); ok {
			return document, true, nil
		}
	}
	document, err := handler.store.GetDocument(request.Context(), namespace, key)
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

func (handler *VideoGenerations) readRecord(request *http.Request, id string) (postgres.Document, map[string]any, bool, error) {
	document, found, err := handler.readDocument(request, videoGenerationNamespace, id)
	if err != nil || !found {
		return document, nil, found, err
	}
	var record map[string]any
	if json.Unmarshal(document.Value, &record) != nil || !validVideoGenerationRecord(record) {
		return document, nil, false, nil
	}
	return document, record, true, nil
}

func (handler *VideoGenerations) readIndex(request *http.Request) (int64, videoGenerationIndex, error) {
	document, found, err := handler.readDocument(request, videoGenerationIndexNamespace, videoGenerationIndexKey)
	if err != nil {
		return 0, videoGenerationIndex{}, err
	}
	if !found {
		return 0, normalizeVideoGenerationIndex(videoGenerationIndex{}), nil
	}
	var index videoGenerationIndex
	if json.Unmarshal(document.Value, &index) != nil {
		return document.Revision, normalizeVideoGenerationIndex(videoGenerationIndex{}), nil
	}
	return document.Revision, normalizeVideoGenerationIndex(index), nil
}

func (handler *VideoGenerations) get(writer http.ResponseWriter, request *http.Request) {
	id := strings.TrimSpace(request.URL.Query().Get("id"))
	if id != "" {
		if !safeVideoGenerationID.MatchString(id) {
			writeError(writer, http.StatusBadRequest, "invalid generation id")
			return
		}
		_, record, found, err := handler.readRecord(request, id)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "video generation read failed")
			return
		}
		if !found {
			writeJSON(writer, http.StatusOK, map[string]any{"record": nil})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]any{"record": record})
		return
	}

	_, index, err := handler.readIndex(request)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "video generation index read failed")
		return
	}
	records := make([]map[string]any, 0, len(index.GenerationIDs))
	for _, generationID := range index.GenerationIDs {
		_, record, found, readErr := handler.readRecord(request, generationID)
		if readErr != nil {
			writeError(writer, http.StatusInternalServerError, "video generation read failed")
			return
		}
		if found {
			records = append(records, record)
		}
	}
	writeJSON(writer, http.StatusOK, map[string]any{"records": records})
}

func (handler *VideoGenerations) save(writer http.ResponseWriter, request *http.Request) {
	var record map[string]any
	if err := decodeJSON(writer, request, &record); err != nil {
		return
	}
	if !validVideoGenerationRecord(record) {
		writeError(writer, http.StatusBadRequest, "invalid video generation record")
		return
	}
	id := videoGenerationString(record, "id")
	for attempt := 0; attempt < maxVideoGenerationWriteAttempts; attempt++ {
		taskDocument, taskFound, err := handler.readDocument(request, videoGenerationNamespace, id)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "video generation read failed")
			return
		}
		indexRevision, index, err := handler.readIndex(request)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "video generation index read failed")
			return
		}
		value, _ := json.Marshal(record)
		indexContainsTask := false
		for _, generationID := range index.GenerationIDs {
			if generationID == id {
				indexContainsTask = true
				break
			}
		}
		expectedTaskRevision := int64(0)
		if taskFound {
			expectedTaskRevision = taskDocument.Revision
		}
		if indexContainsTask {
			document, writeErr := handler.store.PutDocument(request.Context(), videoGenerationNamespace, id, &expectedTaskRevision, value)
			if errors.Is(writeErr, postgres.ErrRevisionConflict) {
				handler.clearCache(request, id, false)
				continue
			}
			if writeErr != nil {
				writeError(writer, http.StatusInternalServerError, "video generation write failed")
				return
			}
			handler.cacheDocuments(request, []postgres.Document{document})
			writeJSON(writer, http.StatusOK, map[string]bool{"ok": true})
			return
		}

		index.GenerationIDs = append(index.GenerationIDs, id)
		index.UpdatedAt = requestTime()
		indexValue, _ := json.Marshal(index)
		documents, writeErr := handler.store.PutDocumentsAtomic(request.Context(), []postgres.DocumentWrite{
			{Namespace: videoGenerationNamespace, Key: id, ExpectedRevision: expectedTaskRevision, Value: value},
			{Namespace: videoGenerationIndexNamespace, Key: videoGenerationIndexKey, ExpectedRevision: indexRevision, Value: indexValue},
		}, nil, nil)
		if errors.Is(writeErr, postgres.ErrRevisionConflict) {
			handler.clearCache(request, id, true)
			continue
		}
		if writeErr != nil {
			writeError(writer, http.StatusInternalServerError, "video generation write failed")
			return
		}
		handler.cacheDocuments(request, documents)
		writeJSON(writer, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	writeError(writer, http.StatusConflict, "video generation write conflict")
}

func (handler *VideoGenerations) patch(writer http.ResponseWriter, request *http.Request) {
	id := strings.TrimSpace(request.URL.Query().Get("id"))
	if !safeVideoGenerationID.MatchString(id) {
		writeError(writer, http.StatusBadRequest, "invalid generation id")
		return
	}
	var patch map[string]any
	if err := decodeJSON(writer, request, &patch); err != nil {
		return
	}
	for attempt := 0; attempt < maxVideoGenerationWriteAttempts; attempt++ {
		document, current, found, err := handler.readRecord(request, id)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "video generation read failed")
			return
		}
		if !found {
			writeError(writer, http.StatusNotFound, "生成任务不存在")
			return
		}
		next := make(map[string]any, len(current)+len(patch))
		for key, value := range current {
			next[key] = value
		}
		for key, value := range patch {
			next[key] = value
		}
		next["id"] = current["id"]
		next["updatedAt"] = requestTime()
		if !validVideoGenerationRecord(next) {
			writeError(writer, http.StatusBadRequest, "invalid video generation patch")
			return
		}
		value, _ := json.Marshal(next)
		written, writeErr := handler.store.PutDocument(request.Context(), videoGenerationNamespace, id, &document.Revision, value)
		if errors.Is(writeErr, postgres.ErrRevisionConflict) {
			handler.clearCache(request, id, false)
			continue
		}
		if writeErr != nil {
			writeError(writer, http.StatusInternalServerError, "video generation write failed")
			return
		}
		handler.cacheDocuments(request, []postgres.Document{written})
		writeJSON(writer, http.StatusOK, map[string]any{"record": next})
		return
	}
	writeError(writer, http.StatusConflict, "video generation write conflict")
}

func (handler *VideoGenerations) clearCache(request *http.Request, id string, includeIndex bool) {
	if handler.cache == nil {
		return
	}
	_ = handler.cache.Delete(request.Context(), videoGenerationNamespace, id)
	if includeIndex {
		_ = handler.cache.Delete(request.Context(), videoGenerationIndexNamespace, videoGenerationIndexKey)
	}
}

func (handler *VideoGenerations) cacheDocuments(request *http.Request, documents []postgres.Document) {
	if handler.cache == nil {
		return
	}
	for _, document := range documents {
		_ = handler.cache.Set(request.Context(), document)
	}
}
