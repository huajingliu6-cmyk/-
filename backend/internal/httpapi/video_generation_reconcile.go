package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"infinite-canvas/backend/internal/postgres"
)

const videoIdempotencySubmittingStaleAfter = 5 * time.Minute

type videoIdempotencyReconcileInput struct {
	GenerationID string `json:"generationId"`
}

type videoIdempotencyReconcileResult struct {
	Record     videoIdempotencyRecord `json:"record"`
	Generation map[string]any         `json:"generation"`
	Mutated    bool                   `json:"mutated"`
	Note       string                 `json:"note"`
}

func (handler *VideoGenerationIdempotency) ServeReconcileHTTP(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		methodNotAllowed(writer, http.MethodPost)
		return
	}
	var input videoIdempotencyReconcileInput
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	input.GenerationID = strings.TrimSpace(input.GenerationID)
	if !safeVideoGenerationID.MatchString(input.GenerationID) {
		writeVideoIdempotencyError(writer, http.StatusBadRequest, "IDEMPOTENCY_RECORD_CORRUPTED")
		return
	}

	for attempt := 0; attempt < maxVideoIdempotencyWriteAttempts; attempt++ {
		result, found, retry, businessCode := handler.reconcileByGenerationID(request, input.GenerationID)
		if retry {
			continue
		}
		if businessCode != "" {
			writeVideoIdempotencyError(writer, http.StatusBadRequest, businessCode)
			return
		}
		if !found {
			writeJSON(writer, http.StatusNotFound, map[string]string{
				"code": "NOT_FOUND", "message": "\u672a\u627e\u5230\u53ef\u5bf9\u8d26\u7684\u5e42\u7b49\u8bb0\u5f55",
			})
			return
		}
		writeJSON(writer, http.StatusOK, result)
		return
	}
	writeVideoIdempotencyError(writer, http.StatusServiceUnavailable, "IDEMPOTENCY_STORE_UNAVAILABLE")
}

func (handler *VideoGenerationIdempotency) reconcileByGenerationID(request *http.Request, generationID string) (videoIdempotencyReconcileResult, bool, bool, string) {
	recordKey, recordDocument, record, found, code := handler.findIdempotencyRecordForGeneration(request, generationID)
	if code != "" || !found {
		return videoIdempotencyReconcileResult{}, found, false, code
	}

	generationDocument, generation, generationFound, err := handler.readGenerationForReconcile(request, record.GenerationID)
	if err != nil {
		return videoIdempotencyReconcileResult{}, true, false, "IDEMPOTENCY_STORE_UNAVAILABLE"
	}
	if !generationFound {
		generation = nil
	}

	nextRecord := *record
	nextGeneration := cloneGenerationRecord(generation)
	recordChanged := false
	generationChanged := false
	now := time.Now().UTC()
	note := "\u65e0\u53d8\u66f4"

	switch record.State {
	case "committed":
		note = "\u5df2\u63d0\u4ea4\u5b8c\u6210\uff0c\u8fd4\u56de\u5df2\u6709 generation"
	case "providerAccepted":
		if generation != nil && record.ProviderTaskID != nil && videoGenerationString(generation, "providerTaskId") == "" {
			nextGeneration["providerTaskId"] = *record.ProviderTaskID
			status := videoGenerationString(generation, "status")
			if status == "validating" || status == "submitting" {
				nextGeneration["status"] = "queued"
			}
			if videoGenerationString(generation, "progressLabel") == "" {
				nextGeneration["progressLabel"] = "\u5df2\u4ece\u5e42\u7b49\u8bb0\u5f55\u6062\u590d Provider \u4efb\u52a1\u53f7"
			}
			nextGeneration["errorCode"] = nil
			nextGeneration["errorMessage"] = nil
			generationChanged = true
			note = "\u5df2\u4ece\u5e42\u7b49\u8bb0\u5f55\u8865\u5199 providerTaskId"
		} else {
			note = "providerAccepted\uff0cgeneration \u5df2\u6709\u6216\u6682\u65e0\u8bb0\u5f55\u53ef\u8865\u5199"
		}
	case "submitting":
		updatedAt, parseErr := time.Parse(time.RFC3339Nano, record.UpdatedAt)
		if parseErr != nil || now.Sub(updatedAt) < videoIdempotencySubmittingStaleAfter {
			note = "submitting \u672a\u8d85\u65f6\uff0c\u4fdd\u6301 in-progress\uff0c\u4e0d\u8c03\u7528 Provider"
			break
		}
		nextRecord.UpdatedAt = now.Format(time.RFC3339Nano)
		recordChanged = true
		if record.ProviderTaskID != nil && strings.TrimSpace(*record.ProviderTaskID) != "" {
			nextRecord.State = "providerAccepted"
			nextRecord.LastErrorCode = nil
			if generation != nil && videoGenerationString(generation, "providerTaskId") == "" {
				nextGeneration["providerTaskId"] = *record.ProviderTaskID
				generationChanged = true
				note = "stale submitting \u542b taskId \u2192 providerAccepted \u5e76\u8865\u5199"
			} else {
				note = "stale submitting \u542b taskId \u2192 providerAccepted"
			}
		} else {
			nextRecord.State = "unknownOutcome"
			lastError := "SUBMITTING_STALE_UNKNOWN"
			nextRecord.LastErrorCode = &lastError
			if generation != nil {
				nextGeneration["status"] = "unknownOutcome"
				nextGeneration["errorCode"] = "GENERATION_SUBMISSION_UNKNOWN"
				nextGeneration["errorMessage"] = "\u63d0\u4ea4\u7ed3\u679c\u6682\u65f6\u65e0\u6cd5\u786e\u8ba4\uff0c\u4e3a\u907f\u514d\u91cd\u590d\u8ba1\u8d39\uff0c\u7cfb\u7edf\u5df2\u6682\u505c\u81ea\u52a8\u91cd\u8bd5\u3002"
				nextGeneration["progressLabel"] = "\u63d0\u4ea4\u7ed3\u679c\u5f85\u786e\u8ba4"
				generationChanged = true
			}
			note = "stale submitting \u65e0 taskId \u2192 unknownOutcome\uff0c\u4e0d\u91cd\u8bd5 Provider"
		}
	case "unknownOutcome":
		note = "unknownOutcome \u4fdd\u6301\u963b\u585e\uff0c\u4e0d\u81ea\u52a8\u91cd\u8bd5"
	case "safeFailure":
		note = "safeFailure\uff1a\u4ec5\u5141\u8bb8\u5728\u660e\u786e\u672a\u8c03\u7528 Provider \u7684\u89c4\u5219\u4e0b\u91cd\u8bd5"
	case "reserved":
		updatedAt, parseErr := time.Parse(time.RFC3339Nano, record.UpdatedAt)
		if parseErr == nil && now.Sub(updatedAt) >= videoIdempotencySubmittingStaleAfter {
			nextRecord.State = "safeFailure"
			nextRecord.UpdatedAt = now.Format(time.RFC3339Nano)
			lastError := "RESERVED_STALE"
			nextRecord.LastErrorCode = &lastError
			recordChanged = true
			note = "reserved \u8d85\u65f6\u4e14\u672a\u63d0\u4ea4 Provider \u2192 safeFailure"
		} else {
			note = "reserved \u8fdb\u884c\u4e2d"
		}
	default:
		return videoIdempotencyReconcileResult{}, true, false, "IDEMPOTENCY_RECORD_CORRUPTED"
	}

	if !recordChanged && !generationChanged {
		return videoIdempotencyReconcileResult{Record: *record, Generation: generation, Mutated: false, Note: note}, true, false, ""
	}
	if generationChanged {
		nextGeneration["updatedAt"] = requestTime()
	}

	writes := make([]postgres.DocumentWrite, 0, 2)
	if recordChanged {
		writes = append(writes, postgres.DocumentWrite{Namespace: videoIdempotencyRecordNamespace, Key: recordKey, ExpectedRevision: recordDocument.Revision, Value: videoIdempotencyEnvelopeValue(&nextRecord)})
	}
	if generationChanged {
		value, _ := json.Marshal(nextGeneration)
		writes = append(writes, postgres.DocumentWrite{Namespace: videoGenerationNamespace, Key: record.GenerationID, ExpectedRevision: generationDocument.Revision, Value: value})
	}
	documents, writeErr := handler.store.PutDocumentsAtomic(request.Context(), writes, nil, nil)
	if errors.Is(writeErr, postgres.ErrRevisionConflict) {
		handler.clearVideoIdempotencyCache(request, recordKey, false)
		if generationChanged && handler.cache != nil {
			_ = handler.cache.Delete(request.Context(), videoGenerationNamespace, record.GenerationID)
		}
		return videoIdempotencyReconcileResult{}, true, true, ""
	}
	if writeErr != nil {
		return videoIdempotencyReconcileResult{}, true, false, "IDEMPOTENCY_STORE_UNAVAILABLE"
	}
	handler.cacheVideoIdempotencyDocuments(request, documents)

	resultRecord := *record
	if recordChanged {
		resultRecord = nextRecord
	}
	resultGeneration := generation
	if generationChanged {
		resultGeneration = nextGeneration
	}
	return videoIdempotencyReconcileResult{Record: resultRecord, Generation: resultGeneration, Mutated: true, Note: note}, true, false, ""
}

func (handler *VideoGenerationIdempotency) findIdempotencyRecordForGeneration(request *http.Request, generationID string) (string, postgres.Document, *videoIdempotencyRecord, bool, string) {
	_, index, err := handler.readIndex(request)
	if err != nil {
		return "", postgres.Document{}, nil, false, "IDEMPOTENCY_STORE_UNAVAILABLE"
	}
	for _, documentKey := range index.RecordKeys {
		document, record, readErr := handler.readRecord(request, documentKey)
		if readErr != nil {
			continue
		}
		if record != nil && record.GenerationID == generationID {
			return documentKey, document, record, true, ""
		}
	}

	_, generation, found, readErr := handler.readGenerationForReconcile(request, generationID)
	if readErr != nil {
		return "", postgres.Document{}, nil, false, "IDEMPOTENCY_STORE_UNAVAILABLE"
	}
	if !found || generation == nil {
		return "", postgres.Document{}, nil, false, ""
	}
	idempotencyKey := videoGenerationString(generation, "idempotencyKey")
	if idempotencyKey == "" {
		return "", postgres.Document{}, nil, false, ""
	}
	documentKey := videoIdempotencyDocumentKey("video-generation", idempotencyKey)
	document, record, readErr := handler.readRecord(request, documentKey)
	if readErr != nil {
		return "", postgres.Document{}, nil, false, "IDEMPOTENCY_RECORD_CORRUPTED"
	}
	if record == nil {
		return "", postgres.Document{}, nil, false, "IDEMPOTENCY_STORE_UNAVAILABLE"
	}
	if record.GenerationID != generationID {
		return "", postgres.Document{}, nil, false, "IDEMPOTENCY_RECORD_CORRUPTED"
	}
	return documentKey, document, record, true, ""
}

func (handler *VideoGenerationIdempotency) readGenerationForReconcile(request *http.Request, generationID string) (postgres.Document, map[string]any, bool, error) {
	document, found, err := handler.readDocument(request, videoGenerationNamespace, generationID)
	if err != nil || !found {
		return document, nil, found, err
	}
	var generation map[string]any
	if json.Unmarshal(document.Value, &generation) != nil || !validVideoGenerationRecord(generation) {
		return document, nil, false, errors.New("corrupted generation")
	}
	return document, generation, true, nil
}

func cloneGenerationRecord(generation map[string]any) map[string]any {
	if generation == nil {
		return nil
	}
	clone := make(map[string]any, len(generation))
	for key, value := range generation {
		clone[key] = value
	}
	return clone
}
