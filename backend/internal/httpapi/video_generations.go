package httpapi

import (
	"encoding/json"
	"errors"
	"math"
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

type browserVideoMetadataInput struct {
	GenerationID          string  `json:"generationId"`
	VideoAssetID          string  `json:"videoAssetId"`
	ActualWidth           float64 `json:"actualWidth"`
	ActualHeight          float64 `json:"actualHeight"`
	ActualDurationSeconds float64 `json:"actualDurationSeconds"`
}

type videoGenerationBusinessError struct {
	Status  int
	Code    string
	Message string
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

func (handler *VideoGenerations) ServeBrowserMetadataHTTP(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		methodNotAllowed(writer, http.MethodPost)
		return
	}
	var input browserVideoMetadataInput
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	input.GenerationID = strings.TrimSpace(input.GenerationID)
	input.VideoAssetID = strings.TrimSpace(input.VideoAssetID)
	if !safeVideoGenerationID.MatchString(input.GenerationID) || input.VideoAssetID == "" {
		writeVideoGenerationBusinessError(writer, videoGenerationBusinessError{
			Status: http.StatusBadRequest, Code: "INVALID_BODY", Message: "\u53c2\u6570\u65e0\u6548",
		})
		return
	}

	for attempt := 0; attempt < maxVideoGenerationWriteAttempts; attempt++ {
		document, current, found, err := handler.readRecord(request, input.GenerationID)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "video generation read failed")
			return
		}
		if !found {
			current = nil
		}
		next, idempotent, businessErr := applyBrowserVideoMetadata(current, input)
		if businessErr != nil {
			writeVideoGenerationBusinessError(writer, *businessErr)
			return
		}
		if idempotent {
			writeJSON(writer, http.StatusOK, map[string]any{"record": current, "idempotent": true})
			return
		}

		next["updatedAt"] = requestTime()
		value, _ := json.Marshal(next)
		written, writeErr := handler.store.PutDocument(request.Context(), videoGenerationNamespace, input.GenerationID, &document.Revision, value)
		if errors.Is(writeErr, postgres.ErrRevisionConflict) {
			handler.clearCache(request, input.GenerationID, false)
			continue
		}
		if writeErr != nil {
			writeError(writer, http.StatusInternalServerError, "video generation write failed")
			return
		}
		handler.cacheDocuments(request, []postgres.Document{written})
		writeJSON(writer, http.StatusOK, map[string]any{"record": next, "idempotent": false})
		return
	}
	writeError(writer, http.StatusConflict, "video generation write conflict")
}

func applyBrowserVideoMetadata(current map[string]any, input browserVideoMetadataInput) (map[string]any, bool, *videoGenerationBusinessError) {
	if current == nil {
		return nil, false, &videoGenerationBusinessError{Status: http.StatusNotFound, Code: "GENERATION_NOT_FOUND", Message: "\u751f\u6210\u4efb\u52a1\u4e0d\u5b58\u5728"}
	}
	if videoGenerationString(current, "localVideoAssetId") != input.VideoAssetID {
		return nil, false, &videoGenerationBusinessError{Status: http.StatusConflict, Code: "ASSET_MISMATCH", Message: "\u89c6\u9891\u8d44\u4ea7\u4e0e\u5f53\u524d\u4efb\u52a1\u4e0d\u5339\u914d"}
	}

	assetValue, assetExists := current["resultAsset"]
	asset, assetOK := assetValue.(map[string]any)
	if assetExists && assetValue != nil && assetOK && videoGenerationString(asset, "id") != input.VideoAssetID {
		return nil, false, &videoGenerationBusinessError{Status: http.StatusConflict, Code: "ASSET_MISMATCH", Message: "\u7ed3\u679c\u8d44\u4ea7\u4e0e\u8bf7\u6c42\u4e0d\u4e00\u81f4"}
	}
	if !assetExists || assetValue == nil || !assetOK {
		return nil, false, &videoGenerationBusinessError{Status: http.StatusNotFound, Code: "ASSET_NOT_FOUND", Message: "\u4efb\u52a1\u5c1a\u672a\u767b\u8bb0\u89c6\u9891\u8d44\u4ea7"}
	}
	if videoGenerationString(asset, "assetType") != "generatedVideo" {
		return nil, false, &videoGenerationBusinessError{Status: http.StatusUnsupportedMediaType, Code: "NOT_GENERATED_VIDEO", Message: "\u4ec5\u5141\u8bb8\u4e3a generatedVideo \u5199\u56de\u5143\u6570\u636e"}
	}
	if videoGenerationString(asset, "mimeType") != "video/mp4" {
		return nil, false, &videoGenerationBusinessError{Status: http.StatusUnsupportedMediaType, Code: "UNSUPPORTED_MEDIA_TYPE", Message: "\u4e0d\u652f\u6301\u7684\u89c6\u9891\u7c7b\u578b"}
	}

	if !validPositiveInteger(input.ActualWidth) {
		return nil, false, &videoGenerationBusinessError{Status: http.StatusBadRequest, Code: "INVALID_WIDTH", Message: "\u89c6\u9891\u5bbd\u5ea6\u65e0\u6548"}
	}
	if !validPositiveInteger(input.ActualHeight) {
		return nil, false, &videoGenerationBusinessError{Status: http.StatusBadRequest, Code: "INVALID_HEIGHT", Message: "\u89c6\u9891\u9ad8\u5ea6\u65e0\u6548"}
	}
	duration := math.Round(input.ActualDurationSeconds*1000) / 1000
	if !validPositiveNumber(input.ActualDurationSeconds) || !validPositiveNumber(duration) {
		return nil, false, &videoGenerationBusinessError{Status: http.StatusBadRequest, Code: "INVALID_DURATION", Message: "\u89c6\u9891\u65f6\u957f\u65e0\u6548"}
	}

	width := int64(input.ActualWidth)
	height := int64(input.ActualHeight)
	if numericValueEquals(current["actualWidth"], float64(width)) &&
		numericValueEquals(current["actualHeight"], float64(height)) &&
		numericValueEquals(current["actualDurationSeconds"], duration) &&
		videoGenerationString(current, "metadataSource") == "browser" {
		return current, true, nil
	}

	next := make(map[string]any, len(current))
	for key, value := range current {
		next[key] = value
	}
	next["actualWidth"] = width
	next["actualHeight"] = height
	next["actualDurationSeconds"] = duration
	next["metadataSource"] = "browser"
	return next, false, nil
}

func validPositiveInteger(value float64) bool {
	return validPositiveNumber(value) && math.Trunc(value) == value
}

func validPositiveNumber(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value > 0
}

func numericValueEquals(value any, expected float64) bool {
	switch typed := value.(type) {
	case float64:
		return typed == expected
	case int:
		return float64(typed) == expected
	case int64:
		return float64(typed) == expected
	default:
		return false
	}
}

func writeVideoGenerationBusinessError(writer http.ResponseWriter, businessErr videoGenerationBusinessError) {
	writeJSON(writer, businessErr.Status, map[string]string{"code": businessErr.Code, "message": businessErr.Message})
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
