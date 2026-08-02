package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

const videoIdempotencyRecordNamespace = "video-generation-idempotency"
const videoIdempotencyIndexNamespace = "video-generation-idempotency-index"
const videoIdempotencyIndexKey = "all"
const maxVideoIdempotencyWriteAttempts = 6
const defaultVideoIdempotencyTTL = 7 * 24 * time.Hour

var safeVideoIdempotencyHash = regexp.MustCompile(`^[a-f0-9]{64}$`)

var videoIdempotencyStates = map[string]bool{
	"reserved": true, "submitting": true, "providerAccepted": true,
	"committed": true, "safeFailure": true, "unknownOutcome": true,
}

type videoIdempotencyRecord struct {
	ID                 string  `json:"id"`
	Scope              string  `json:"scope"`
	IdempotencyKey     string  `json:"idempotencyKey"`
	RequestFingerprint string  `json:"requestFingerprint"`
	GenerationID       string  `json:"generationId"`
	ProjectID          string  `json:"projectId"`
	ShotNodeID         string  `json:"shotNodeId"`
	ProviderID         string  `json:"providerId"`
	State              string  `json:"state"`
	ProviderTaskID     *string `json:"providerTaskId"`
	CreatedAt          string  `json:"createdAt"`
	UpdatedAt          string  `json:"updatedAt"`
	ExpiresAt          string  `json:"expiresAt"`
	LastErrorCode      *string `json:"lastErrorCode"`
}

type videoIdempotencyEnvelope struct {
	Version   int                     `json:"version"`
	Active    bool                    `json:"active"`
	Record    *videoIdempotencyRecord `json:"record"`
	UpdatedAt string                  `json:"updatedAt"`
}

type videoIdempotencyIndex struct {
	Version    int      `json:"version"`
	RecordKeys []string `json:"recordKeys"`
	UpdatedAt  string   `json:"updatedAt"`
}

type videoIdempotencyReserveInput struct {
	Scope              string `json:"scope"`
	IdempotencyKey     string `json:"idempotencyKey"`
	RequestFingerprint string `json:"requestFingerprint"`
	GenerationID       string `json:"generationId"`
	ProjectID          string `json:"projectId"`
	ShotNodeID         string `json:"shotNodeId"`
	ProviderID         string `json:"providerId"`
	TTLMillis          *int64 `json:"ttlMs"`
}

type videoIdempotencyCommand struct {
	Action         string                        `json:"action"`
	Input          *videoIdempotencyReserveInput `json:"input,omitempty"`
	Scope          string                        `json:"scope,omitempty"`
	Key            string                        `json:"key,omitempty"`
	GenerationID   string                        `json:"generationId,omitempty"`
	ProviderTaskID string                        `json:"providerTaskId,omitempty"`
	ErrorCode      string                        `json:"errorCode,omitempty"`
}

type VideoGenerationIdempotency struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewVideoGenerationIdempotency(store *postgres.Store, documentCache *cache.Documents) *VideoGenerationIdempotency {
	return &VideoGenerationIdempotency{store: store, cache: documentCache}
}

func (handler *VideoGenerationIdempotency) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet:
		handler.get(writer, request)
	case http.MethodPost:
		handler.command(writer, request)
	default:
		methodNotAllowed(writer, "GET, POST")
	}
}

func writeVideoIdempotencyError(writer http.ResponseWriter, status int, code string) {
	writeJSON(writer, status, map[string]string{"error": code, "code": code})
}

func videoIdempotencyDocumentKey(scope, key string) string {
	digest := sha256.Sum256([]byte(scope + "\x00" + key))
	return hex.EncodeToString(digest[:])
}

func validVideoIdempotencyInput(input videoIdempotencyReserveInput) bool {
	return input.Scope == "video-generation" && input.IdempotencyKey != "" &&
		input.RequestFingerprint != "" && input.GenerationID != "" &&
		input.ProjectID != "" && input.ShotNodeID != "" && input.ProviderID != "" &&
		(input.TTLMillis == nil || *input.TTLMillis >= 0)
}

func validVideoIdempotencyRecord(record videoIdempotencyRecord) bool {
	return record.ID != "" && record.Scope == "video-generation" &&
		record.IdempotencyKey != "" && record.RequestFingerprint != "" &&
		record.GenerationID != "" && record.ProjectID != "" &&
		record.ShotNodeID != "" && record.ProviderID != "" &&
		videoIdempotencyStates[record.State] && record.CreatedAt != "" &&
		record.UpdatedAt != "" && record.ExpiresAt != ""
}

func parseVideoIdempotencyEnvelope(value json.RawMessage) (*videoIdempotencyRecord, error) {
	if len(value) == 0 || string(value) == "null" {
		return nil, nil
	}
	var raw map[string]json.RawMessage
	if json.Unmarshal(value, &raw) != nil {
		return nil, errors.New("corrupted")
	}
	var envelope videoIdempotencyEnvelope
	if json.Unmarshal(value, &envelope) != nil || envelope.Version != 1 {
		return nil, errors.New("corrupted")
	}
	if !envelope.Active && envelope.Record == nil {
		return nil, nil
	}
	if !envelope.Active || envelope.Record == nil || !validVideoIdempotencyRecord(*envelope.Record) {
		return nil, errors.New("corrupted")
	}
	var recordRaw map[string]json.RawMessage
	if json.Unmarshal(raw["record"], &recordRaw) != nil {
		return nil, errors.New("corrupted")
	}
	for _, banned := range []string{"prompt", "apiKey", "api_key", "base64", "remoteVideoUrl", "authorization", "DASHSCOPE_API_KEY"} {
		if _, exists := recordRaw[banned]; exists {
			return nil, errors.New("corrupted")
		}
	}
	return envelope.Record, nil
}

func videoIdempotencyEnvelopeValue(record *videoIdempotencyRecord) json.RawMessage {
	value, _ := json.Marshal(videoIdempotencyEnvelope{Version: 1, Active: record != nil, Record: record, UpdatedAt: requestTime()})
	return value
}

func normalizeVideoIdempotencyIndex(value json.RawMessage) (videoIdempotencyIndex, error) {
	if len(value) == 0 || string(value) == "null" {
		return videoIdempotencyIndex{Version: 1, RecordKeys: []string{}, UpdatedAt: requestTime()}, nil
	}
	var index videoIdempotencyIndex
	if json.Unmarshal(value, &index) != nil || index.Version != 1 || index.RecordKeys == nil {
		return videoIdempotencyIndex{}, errors.New("corrupted")
	}
	seen := map[string]bool{}
	keys := make([]string, 0, len(index.RecordKeys))
	for _, key := range index.RecordKeys {
		if safeVideoIdempotencyHash.MatchString(key) && !seen[key] {
			seen[key] = true
			keys = append(keys, key)
		}
	}
	index.RecordKeys = keys
	if index.UpdatedAt == "" {
		index.UpdatedAt = requestTime()
	}
	return index, nil
}

func (handler *VideoGenerationIdempotency) readDocument(request *http.Request, namespace, key string) (postgres.Document, bool, error) {
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

func (handler *VideoGenerationIdempotency) readRecord(request *http.Request, documentKey string) (postgres.Document, *videoIdempotencyRecord, error) {
	document, found, err := handler.readDocument(request, videoIdempotencyRecordNamespace, documentKey)
	if err != nil || !found {
		return document, nil, err
	}
	record, err := parseVideoIdempotencyEnvelope(document.Value)
	return document, record, err
}

func (handler *VideoGenerationIdempotency) readIndex(request *http.Request) (int64, videoIdempotencyIndex, error) {
	document, found, err := handler.readDocument(request, videoIdempotencyIndexNamespace, videoIdempotencyIndexKey)
	if err != nil {
		return 0, videoIdempotencyIndex{}, err
	}
	if !found {
		index, _ := normalizeVideoIdempotencyIndex(nil)
		return 0, index, nil
	}
	index, err := normalizeVideoIdempotencyIndex(document.Value)
	return document.Revision, index, err
}

func (handler *VideoGenerationIdempotency) get(writer http.ResponseWriter, request *http.Request) {
	if request.URL.Query().Get("list") == "true" {
		handler.list(writer, request)
		return
	}
	scope := strings.TrimSpace(request.URL.Query().Get("scope"))
	key := request.URL.Query().Get("key")
	if scope != "video-generation" || key == "" {
		writeVideoIdempotencyError(writer, http.StatusBadRequest, "IDEMPOTENCY_RECORD_CORRUPTED")
		return
	}
	_, record, err := handler.readRecord(request, videoIdempotencyDocumentKey(scope, key))
	if err != nil {
		writeVideoIdempotencyError(writer, http.StatusConflict, "IDEMPOTENCY_RECORD_CORRUPTED")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"record": record})
}

func (handler *VideoGenerationIdempotency) list(writer http.ResponseWriter, request *http.Request) {
	_, index, err := handler.readIndex(request)
	if err != nil {
		writeVideoIdempotencyError(writer, http.StatusServiceUnavailable, "IDEMPOTENCY_STORE_UNAVAILABLE")
		return
	}
	records := make([]videoIdempotencyRecord, 0, len(index.RecordKeys))
	for _, key := range index.RecordKeys {
		_, record, readErr := handler.readRecord(request, key)
		if readErr == nil && record != nil {
			records = append(records, *record)
		}
	}
	writeJSON(writer, http.StatusOK, map[string]any{"records": records})
}

func (handler *VideoGenerationIdempotency) command(writer http.ResponseWriter, request *http.Request) {
	var command videoIdempotencyCommand
	if err := decodeJSON(writer, request, &command); err != nil {
		return
	}
	switch command.Action {
	case "reserve":
		if command.Input == nil || !validVideoIdempotencyInput(*command.Input) {
			writeVideoIdempotencyError(writer, http.StatusBadRequest, "IDEMPOTENCY_RECORD_CORRUPTED")
			return
		}
		handler.reserve(writer, request, *command.Input)
	case "reReserveAfterSafeFailure":
		if command.Input == nil || !validVideoIdempotencyInput(*command.Input) {
			writeVideoIdempotencyError(writer, http.StatusBadRequest, "IDEMPOTENCY_RECORD_CORRUPTED")
			return
		}
		handler.reReserve(writer, request, *command.Input)
	case "markSubmitting", "markProviderAccepted", "markCommitted", "markSafeFailure", "markUnknownOutcome":
		handler.transition(writer, request, command)
	case "releaseIfSafe":
		handler.release(writer, request, command)
	default:
		writeVideoIdempotencyError(writer, http.StatusBadRequest, "IDEMPOTENCY_RECORD_CORRUPTED")
	}
}

func createVideoIdempotencyRecord(input videoIdempotencyReserveInput) (videoIdempotencyRecord, error) {
	id, err := newUUID()
	if err != nil {
		return videoIdempotencyRecord{}, err
	}
	now := time.Now().UTC()
	ttl := defaultVideoIdempotencyTTL
	if input.TTLMillis != nil {
		ttl = time.Duration(*input.TTLMillis) * time.Millisecond
	}
	return videoIdempotencyRecord{
		ID: id, Scope: input.Scope, IdempotencyKey: input.IdempotencyKey,
		RequestFingerprint: input.RequestFingerprint, GenerationID: input.GenerationID,
		ProjectID: input.ProjectID, ShotNodeID: input.ShotNodeID, ProviderID: input.ProviderID,
		State: "reserved", ProviderTaskID: nil, CreatedAt: now.Format(time.RFC3339Nano),
		UpdatedAt: now.Format(time.RFC3339Nano), ExpiresAt: now.Add(ttl).Format(time.RFC3339Nano), LastErrorCode: nil,
	}, nil
}

func classifyVideoIdempotencyRecord(record *videoIdempotencyRecord, input videoIdempotencyReserveInput) (string, string) {
	if record.RequestFingerprint != input.RequestFingerprint {
		return "", "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST"
	}
	switch record.State {
	case "committed", "providerAccepted":
		return "existing", ""
	case "reserved", "submitting":
		return "in_progress", ""
	case "safeFailure":
		return "safe_retry", ""
	case "unknownOutcome":
		return "blocked_unknown", ""
	default:
		return "", "IDEMPOTENCY_RECORD_CORRUPTED"
	}
}

func (handler *VideoGenerationIdempotency) reserve(writer http.ResponseWriter, request *http.Request, input videoIdempotencyReserveInput) {
	documentKey := videoIdempotencyDocumentKey(input.Scope, input.IdempotencyKey)
	for attempt := 0; attempt < maxVideoIdempotencyWriteAttempts; attempt++ {
		document, existing, err := handler.readRecord(request, documentKey)
		if err != nil {
			writeVideoIdempotencyError(writer, http.StatusConflict, "IDEMPOTENCY_RECORD_CORRUPTED")
			return
		}
		if existing != nil {
			kind, code := classifyVideoIdempotencyRecord(existing, input)
			if code != "" {
				writeVideoIdempotencyError(writer, http.StatusConflict, code)
				return
			}
			writeJSON(writer, http.StatusOK, map[string]any{"kind": kind, "record": existing})
			return
		}
		indexRevision, index, err := handler.readIndex(request)
		if err != nil {
			writeVideoIdempotencyError(writer, http.StatusServiceUnavailable, "IDEMPOTENCY_STORE_UNAVAILABLE")
			return
		}
		record, err := createVideoIdempotencyRecord(input)
		if err != nil {
			writeVideoIdempotencyError(writer, http.StatusServiceUnavailable, "IDEMPOTENCY_STORE_UNAVAILABLE")
			return
		}
		expectedRevision := document.Revision
		indexed := false
		for _, key := range index.RecordKeys {
			if key == documentKey {
				indexed = true
				break
			}
		}
		if indexed {
			written, writeErr := handler.store.PutDocument(request.Context(), videoIdempotencyRecordNamespace, documentKey, &expectedRevision, videoIdempotencyEnvelopeValue(&record))
			if errors.Is(writeErr, postgres.ErrRevisionConflict) {
				handler.clearVideoIdempotencyCache(request, documentKey, false)
				continue
			}
			if writeErr != nil {
				writeVideoIdempotencyError(writer, http.StatusServiceUnavailable, "IDEMPOTENCY_STORE_UNAVAILABLE")
				return
			}
			handler.cacheVideoIdempotencyDocuments(request, []postgres.Document{written})
			writeJSON(writer, http.StatusOK, map[string]any{"kind": "reserved", "record": record})
			return
		}
		index.RecordKeys = append(index.RecordKeys, documentKey)
		index.UpdatedAt = requestTime()
		indexValue, _ := json.Marshal(index)
		documents, writeErr := handler.store.PutDocumentsAtomic(request.Context(), []postgres.DocumentWrite{
			{Namespace: videoIdempotencyRecordNamespace, Key: documentKey, ExpectedRevision: expectedRevision, Value: videoIdempotencyEnvelopeValue(&record)},
			{Namespace: videoIdempotencyIndexNamespace, Key: videoIdempotencyIndexKey, ExpectedRevision: indexRevision, Value: indexValue},
		}, nil, nil)
		if errors.Is(writeErr, postgres.ErrRevisionConflict) {
			handler.clearVideoIdempotencyCache(request, documentKey, true)
			continue
		}
		if writeErr != nil {
			writeVideoIdempotencyError(writer, http.StatusServiceUnavailable, "IDEMPOTENCY_STORE_UNAVAILABLE")
			return
		}
		handler.cacheVideoIdempotencyDocuments(request, documents)
		writeJSON(writer, http.StatusOK, map[string]any{"kind": "reserved", "record": record})
		return
	}
	writeVideoIdempotencyError(writer, http.StatusServiceUnavailable, "IDEMPOTENCY_STORE_UNAVAILABLE")
}

func (handler *VideoGenerationIdempotency) reReserve(writer http.ResponseWriter, request *http.Request, input videoIdempotencyReserveInput) {
	handler.update(writer, request, input.Scope, input.IdempotencyKey, func(record videoIdempotencyRecord) (videoIdempotencyRecord, string) {
		if record.State != "safeFailure" {
			return record, "IDEMPOTENCY_RECORD_CORRUPTED"
		}
		if record.RequestFingerprint != input.RequestFingerprint {
			return record, "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST"
		}
		now := time.Now().UTC()
		ttl := defaultVideoIdempotencyTTL
		if input.TTLMillis != nil {
			ttl = time.Duration(*input.TTLMillis) * time.Millisecond
		}
		record.GenerationID = input.GenerationID
		record.State = "reserved"
		record.ProviderTaskID = nil
		record.UpdatedAt = now.Format(time.RFC3339Nano)
		record.ExpiresAt = now.Add(ttl).Format(time.RFC3339Nano)
		record.LastErrorCode = nil
		return record, ""
	})
}

func validVideoIdempotencyIdentity(command videoIdempotencyCommand) bool {
	return command.Scope == "video-generation" && command.Key != "" && command.GenerationID != ""
}

func (handler *VideoGenerationIdempotency) transition(writer http.ResponseWriter, request *http.Request, command videoIdempotencyCommand) {
	if !validVideoIdempotencyIdentity(command) {
		writeVideoIdempotencyError(writer, http.StatusBadRequest, "IDEMPOTENCY_RECORD_CORRUPTED")
		return
	}
	if command.Action == "markProviderAccepted" && strings.TrimSpace(command.ProviderTaskID) == "" {
		writeVideoIdempotencyError(writer, http.StatusConflict, "IDEMPOTENCY_RECORD_CORRUPTED")
		return
	}
	handler.update(writer, request, command.Scope, command.Key, func(record videoIdempotencyRecord) (videoIdempotencyRecord, string) {
		if record.GenerationID != command.GenerationID {
			return record, "IDEMPOTENCY_RECORD_CORRUPTED"
		}
		now := requestTime()
		switch command.Action {
		case "markSubmitting":
			record.State = "submitting"
			record.LastErrorCode = nil
		case "markProviderAccepted":
			record.State = "providerAccepted"
			record.ProviderTaskID = &command.ProviderTaskID
			record.LastErrorCode = nil
		case "markCommitted":
			record.State = "committed"
		case "markSafeFailure":
			if record.State == "providerAccepted" || record.State == "committed" || record.State == "unknownOutcome" {
				return record, "IDEMPOTENCY_RECORD_CORRUPTED"
			}
			record.State = "safeFailure"
			record.LastErrorCode = &command.ErrorCode
		case "markUnknownOutcome":
			if record.State == "committed" {
				return record, "IDEMPOTENCY_RECORD_CORRUPTED"
			}
			record.State = "unknownOutcome"
			record.LastErrorCode = &command.ErrorCode
		}
		record.UpdatedAt = now
		return record, ""
	})
}

func (handler *VideoGenerationIdempotency) update(writer http.ResponseWriter, request *http.Request, scope, key string, transform func(videoIdempotencyRecord) (videoIdempotencyRecord, string)) {
	documentKey := videoIdempotencyDocumentKey(scope, key)
	for attempt := 0; attempt < maxVideoIdempotencyWriteAttempts; attempt++ {
		document, current, err := handler.readRecord(request, documentKey)
		if err != nil {
			writeVideoIdempotencyError(writer, http.StatusConflict, "IDEMPOTENCY_RECORD_CORRUPTED")
			return
		}
		if current == nil {
			writeVideoIdempotencyError(writer, http.StatusServiceUnavailable, "IDEMPOTENCY_STORE_UNAVAILABLE")
			return
		}
		next, code := transform(*current)
		if code != "" {
			writeVideoIdempotencyError(writer, http.StatusConflict, code)
			return
		}
		written, writeErr := handler.store.PutDocument(request.Context(), videoIdempotencyRecordNamespace, documentKey, &document.Revision, videoIdempotencyEnvelopeValue(&next))
		if errors.Is(writeErr, postgres.ErrRevisionConflict) {
			handler.clearVideoIdempotencyCache(request, documentKey, false)
			continue
		}
		if writeErr != nil {
			writeVideoIdempotencyError(writer, http.StatusServiceUnavailable, "IDEMPOTENCY_STORE_UNAVAILABLE")
			return
		}
		handler.cacheVideoIdempotencyDocuments(request, []postgres.Document{written})
		writeJSON(writer, http.StatusOK, map[string]any{"record": next})
		return
	}
	writeVideoIdempotencyError(writer, http.StatusServiceUnavailable, "IDEMPOTENCY_STORE_UNAVAILABLE")
}

func (handler *VideoGenerationIdempotency) release(writer http.ResponseWriter, request *http.Request, command videoIdempotencyCommand) {
	if !validVideoIdempotencyIdentity(command) {
		writeVideoIdempotencyError(writer, http.StatusBadRequest, "IDEMPOTENCY_RECORD_CORRUPTED")
		return
	}
	documentKey := videoIdempotencyDocumentKey(command.Scope, command.Key)
	for attempt := 0; attempt < maxVideoIdempotencyWriteAttempts; attempt++ {
		document, current, err := handler.readRecord(request, documentKey)
		if err != nil {
			writeVideoIdempotencyError(writer, http.StatusConflict, "IDEMPOTENCY_RECORD_CORRUPTED")
			return
		}
		if current == nil {
			writeJSON(writer, http.StatusOK, map[string]bool{"released": true})
			return
		}
		if current.GenerationID != command.GenerationID || (current.State != "safeFailure" && current.State != "reserved") {
			writeJSON(writer, http.StatusOK, map[string]bool{"released": false})
			return
		}
		written, writeErr := handler.store.PutDocument(request.Context(), videoIdempotencyRecordNamespace, documentKey, &document.Revision, videoIdempotencyEnvelopeValue(nil))
		if errors.Is(writeErr, postgres.ErrRevisionConflict) {
			handler.clearVideoIdempotencyCache(request, documentKey, false)
			continue
		}
		if writeErr != nil {
			writeVideoIdempotencyError(writer, http.StatusServiceUnavailable, "IDEMPOTENCY_STORE_UNAVAILABLE")
			return
		}
		handler.cacheVideoIdempotencyDocuments(request, []postgres.Document{written})
		writeJSON(writer, http.StatusOK, map[string]bool{"released": true})
		return
	}
	writeVideoIdempotencyError(writer, http.StatusServiceUnavailable, "IDEMPOTENCY_STORE_UNAVAILABLE")
}

func (handler *VideoGenerationIdempotency) clearVideoIdempotencyCache(request *http.Request, documentKey string, includeIndex bool) {
	if handler.cache == nil {
		return
	}
	_ = handler.cache.Delete(request.Context(), videoIdempotencyRecordNamespace, documentKey)
	if includeIndex {
		_ = handler.cache.Delete(request.Context(), videoIdempotencyIndexNamespace, videoIdempotencyIndexKey)
	}
}

func (handler *VideoGenerationIdempotency) cacheVideoIdempotencyDocuments(request *http.Request, documents []postgres.Document) {
	if handler.cache == nil {
		return
	}
	for _, document := range documents {
		_ = handler.cache.Set(request.Context(), document)
	}
}
