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

const imageGenerationJobNamespace = "image-generation-jobs"
const imageGenerationJobIndexNamespace = "image-generation-job-index"
const maxImageGenerationJobWriteAttempts = 6

var safeImageGenerationJobID = regexp.MustCompile(`^img_[a-zA-Z0-9_-]+$`)

type imageGenerationJobIndex struct {
	Version   int      `json:"version"`
	JobIDs    []string `json:"jobIds"`
	UpdatedAt string   `json:"updatedAt"`
}

type ImageGenerationJobs struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewImageGenerationJobs(store *postgres.Store, documentCache *cache.Documents) *ImageGenerationJobs {
	return &ImageGenerationJobs{store: store, cache: documentCache}
}

func (handler *ImageGenerationJobs) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet:
		handler.get(writer, request)
	case http.MethodPost:
		handler.save(writer, request)
	default:
		methodNotAllowed(writer, "GET, POST")
	}
}

func imageJobString(job map[string]any, key string) string {
	value, _ := job[key].(string)
	return value
}

func validImageGenerationJob(job map[string]any) bool {
	id := imageJobString(job, "id")
	return safeImageGenerationJobID.MatchString(id) &&
		imageJobString(job, "projectId") != "" &&
		imageJobString(job, "scope") != "" &&
		imageJobString(job, "subjectKind") != "" &&
		imageJobString(job, "subjectId") != "" &&
		imageJobString(job, "status") != "" &&
		imageJobString(job, "createdAt") != "" &&
		imageJobString(job, "updatedAt") != "" &&
		job["recordType"] == "image"
}

func normalizeImageGenerationJobIndex(index imageGenerationJobIndex) imageGenerationJobIndex {
	seen := make(map[string]struct{}, len(index.JobIDs))
	jobIDs := make([]string, 0, len(index.JobIDs))
	for _, id := range index.JobIDs {
		if !safeImageGenerationJobID.MatchString(id) {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		jobIDs = append(jobIDs, id)
	}
	index.Version = 1
	index.JobIDs = jobIDs
	if index.UpdatedAt == "" {
		index.UpdatedAt = requestTime()
	}
	return index
}

func (handler *ImageGenerationJobs) readDocument(request *http.Request, namespace, key string) (postgres.Document, bool, error) {
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

func (handler *ImageGenerationJobs) readJob(request *http.Request, id string) (postgres.Document, map[string]any, bool, error) {
	document, found, err := handler.readDocument(request, imageGenerationJobNamespace, id)
	if err != nil || !found {
		return document, nil, found, err
	}
	var job map[string]any
	if json.Unmarshal(document.Value, &job) != nil || !validImageGenerationJob(job) {
		return document, nil, false, nil
	}
	return document, job, true, nil
}

func (handler *ImageGenerationJobs) readProjectIndex(request *http.Request, projectID string) (int64, imageGenerationJobIndex, error) {
	document, found, err := handler.readDocument(request, imageGenerationJobIndexNamespace, projectID)
	if err != nil {
		return 0, imageGenerationJobIndex{}, err
	}
	if !found {
		return 0, normalizeImageGenerationJobIndex(imageGenerationJobIndex{}), nil
	}
	var index imageGenerationJobIndex
	if json.Unmarshal(document.Value, &index) != nil {
		return document.Revision, normalizeImageGenerationJobIndex(imageGenerationJobIndex{}), nil
	}
	return document.Revision, normalizeImageGenerationJobIndex(index), nil
}

func imageJobMatchesFilters(job map[string]any, scope, subjectID, subjectKind, idempotencyKey string, activeOnly bool) bool {
	if scope != "" && imageJobString(job, "scope") != scope {
		return false
	}
	if subjectID != "" && imageJobString(job, "subjectId") != subjectID {
		return false
	}
	if subjectKind != "" && imageJobString(job, "subjectKind") != subjectKind {
		return false
	}
	if idempotencyKey != "" && imageJobString(job, "idempotencyKey") != idempotencyKey {
		return false
	}
	if activeOnly {
		status := imageJobString(job, "status")
		if status != "queued" && status != "running" && status != "saving" && status != "timed_out_waiting" {
			return false
		}
	}
	return true
}

func (handler *ImageGenerationJobs) loadProjectJobs(request *http.Request, projectID string) ([]map[string]any, error) {
	_, index, err := handler.readProjectIndex(request, projectID)
	if err != nil {
		return nil, err
	}
	jobs := make([]map[string]any, 0, len(index.JobIDs))
	documents, err := loadDocumentsBatch(request.Context(), handler.store, handler.cache, imageGenerationJobNamespace, index.JobIDs)
	if err != nil {
		return nil, err
	}
	for _, jobID := range index.JobIDs {
		document, found := documents[jobID]
		if !found {
			continue
		}
		var job map[string]any
		if json.Unmarshal(document.Value, &job) != nil || !validImageGenerationJob(job) {
			continue
		}
		if imageJobString(job, "projectId") != projectID {
			continue
		}
		jobs = append(jobs, job)
	}
	return jobs, nil
}

func (handler *ImageGenerationJobs) get(writer http.ResponseWriter, request *http.Request) {
	id := strings.TrimSpace(request.URL.Query().Get("id"))
	if id != "" {
		if !safeImageGenerationJobID.MatchString(id) {
			writeError(writer, http.StatusBadRequest, "invalid image job id")
			return
		}
		_, job, found, err := handler.readJob(request, id)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "image job read failed")
			return
		}
		if !found {
			writeJSON(writer, http.StatusOK, map[string]any{"job": nil})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]any{"job": job})
		return
	}

	projectID := strings.TrimSpace(request.URL.Query().Get("projectId"))
	if projectID == "" {
		writeError(writer, http.StatusBadRequest, "projectId is required")
		return
	}
	jobs, err := handler.loadProjectJobs(request, projectID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "image job read failed")
		return
	}

	scope := strings.TrimSpace(request.URL.Query().Get("scope"))
	subjectID := strings.TrimSpace(request.URL.Query().Get("subjectId"))
	subjectKind := strings.TrimSpace(request.URL.Query().Get("subjectKind"))
	idempotencyKey := strings.TrimSpace(request.URL.Query().Get("idempotencyKey"))
	activeOnly := request.URL.Query().Get("active") == "true"
	singleMatch := idempotencyKey != "" || (activeOnly && subjectKind != "" && subjectID != "")

	filtered := make([]map[string]any, 0, len(jobs))
	for _, job := range jobs {
		if !imageJobMatchesFilters(job, scope, subjectID, subjectKind, idempotencyKey, activeOnly) {
			continue
		}
		filtered = append(filtered, job)
	}

	if singleMatch {
		if len(filtered) == 0 {
			writeJSON(writer, http.StatusOK, map[string]any{"job": nil})
			return
		}
		sortJobsByUpdatedAtDesc(filtered)
		writeJSON(writer, http.StatusOK, map[string]any{"job": filtered[0]})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{"jobs": filtered})
}

func sortJobsByUpdatedAtDesc(jobs []map[string]any) {
	for i := 0; i < len(jobs); i++ {
		for j := i + 1; j < len(jobs); j++ {
			left := imageJobString(jobs[i], "updatedAt")
			right := imageJobString(jobs[j], "updatedAt")
			if right > left {
				jobs[i], jobs[j] = jobs[j], jobs[i]
			}
		}
	}
}

func (handler *ImageGenerationJobs) save(writer http.ResponseWriter, request *http.Request) {
	var job map[string]any
	if err := decodeJSON(writer, request, &job); err != nil {
		return
	}
	if !validImageGenerationJob(job) {
		writeError(writer, http.StatusBadRequest, "invalid image generation job")
		return
	}
	id := imageJobString(job, "id")
	projectID := imageJobString(job, "projectId")
	for attempt := 0; attempt < maxImageGenerationJobWriteAttempts; attempt++ {
		jobDocument, jobFound, err := handler.readDocument(request, imageGenerationJobNamespace, id)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "image job read failed")
			return
		}
		indexRevision, index, err := handler.readProjectIndex(request, projectID)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "image job index read failed")
			return
		}
		value, err := json.Marshal(job)
		if err != nil {
			writeError(writer, http.StatusBadRequest, "invalid image generation job")
			return
		}
		indexContainsJob := false
		for _, jobID := range index.JobIDs {
			if jobID == id {
				indexContainsJob = true
				break
			}
		}
		expectedJobRevision := int64(0)
		if jobFound {
			expectedJobRevision = jobDocument.Revision
		}
		if indexContainsJob {
			document, writeErr := handler.store.PutDocument(request.Context(), imageGenerationJobNamespace, id, &expectedJobRevision, value)
			if errors.Is(writeErr, postgres.ErrRevisionConflict) {
				handler.clearCache(request, id, projectID, false)
				continue
			}
			if writeErr != nil {
				writeError(writer, http.StatusInternalServerError, "image job write failed")
				return
			}
			handler.cacheDocuments(request, []postgres.Document{document})
			writeJSON(writer, http.StatusOK, map[string]bool{"ok": true})
			return
		}

		index.JobIDs = append(index.JobIDs, id)
		index.UpdatedAt = requestTime()
		indexValue, err := json.Marshal(index)
		if err != nil {
			writeError(writer, http.StatusBadRequest, "invalid image generation job")
			return
		}
		documents, writeErr := handler.store.PutDocumentsAtomic(request.Context(), []postgres.DocumentWrite{
			{Namespace: imageGenerationJobNamespace, Key: id, ExpectedRevision: expectedJobRevision, Value: value},
			{Namespace: imageGenerationJobIndexNamespace, Key: projectID, ExpectedRevision: indexRevision, Value: indexValue},
		}, nil, nil)
		if errors.Is(writeErr, postgres.ErrRevisionConflict) {
			handler.clearCache(request, id, projectID, true)
			continue
		}
		if writeErr != nil {
			writeError(writer, http.StatusInternalServerError, "image job write failed")
			return
		}
		handler.cacheDocuments(request, documents)
		writeJSON(writer, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	writeError(writer, http.StatusConflict, "image job write conflict")
}

func (handler *ImageGenerationJobs) clearCache(request *http.Request, id, projectID string, includeIndex bool) {
	if handler.cache == nil {
		return
	}
	_ = handler.cache.Delete(request.Context(), imageGenerationJobNamespace, id)
	if includeIndex {
		_ = handler.cache.Delete(request.Context(), imageGenerationJobIndexNamespace, projectID)
	}
}

func (handler *ImageGenerationJobs) cacheDocuments(request *http.Request, documents []postgres.Document) {
	if handler.cache == nil {
		return
	}
	for _, document := range documents {
		_ = handler.cache.Set(request.Context(), document)
	}
}
