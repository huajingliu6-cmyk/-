package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

const textJobNamespace = "text-generation-jobs"
const maxTextJobWriteAttempts = 6

type textGenerationJobCatalog struct {
	Version   int              `json:"version"`
	Jobs      []map[string]any `json:"jobs"`
	UpdatedAt string           `json:"updatedAt"`
}

type TextGenerationJobs struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewTextGenerationJobs(store *postgres.Store, documentCache *cache.Documents) *TextGenerationJobs {
	return &TextGenerationJobs{store: store, cache: documentCache}
}

func (handler *TextGenerationJobs) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet:
		handler.get(writer, request)
	case http.MethodPost:
		handler.save(writer, request)
	default:
		methodNotAllowed(writer, "GET, POST")
	}
}

func normalizeTextJobCatalog(catalog textGenerationJobCatalog) textGenerationJobCatalog {
	catalog.Version = 1
	if catalog.Jobs == nil {
		catalog.Jobs = []map[string]any{}
	}
	if catalog.UpdatedAt == "" {
		catalog.UpdatedAt = requestTime()
	}
	return catalog
}

func (handler *TextGenerationJobs) read(request *http.Request, projectID string) (int64, textGenerationJobCatalog, error) {
	if handler.cache != nil {
		if document, ok := handler.cache.Get(request.Context(), textJobNamespace, projectID); ok {
			var catalog textGenerationJobCatalog
			if json.Unmarshal(document.Value, &catalog) == nil {
				return document.Revision, normalizeTextJobCatalog(catalog), nil
			}
		}
	}
	document, err := handler.store.GetDocument(request.Context(), textJobNamespace, projectID)
	if errors.Is(err, postgres.ErrNotFound) {
		return 0, normalizeTextJobCatalog(textGenerationJobCatalog{}), nil
	}
	if err != nil {
		return 0, textGenerationJobCatalog{}, err
	}
	var catalog textGenerationJobCatalog
	if err := json.Unmarshal(document.Value, &catalog); err != nil {
		return 0, textGenerationJobCatalog{}, err
	}
	if handler.cache != nil {
		_ = handler.cache.Set(request.Context(), document)
	}
	return document.Revision, normalizeTextJobCatalog(catalog), nil
}

func textJobString(job map[string]any, key string) string {
	value, _ := job[key].(string)
	return value
}

func validTextJob(job map[string]any) bool {
	return textJobString(job, "generationId") != "" && textJobString(job, "projectId") != "" && textJobString(job, "userId") != "" && textJobString(job, "outputKind") != "" && textJobString(job, "status") != "" && textJobString(job, "createdAt") != "" && textJobString(job, "updatedAt") != ""
}

func (handler *TextGenerationJobs) get(writer http.ResponseWriter, request *http.Request) {
	projectID := strings.TrimSpace(request.URL.Query().Get("projectId"))
	if projectID == "" {
		writeError(writer, http.StatusBadRequest, "projectId is required")
		return
	}
	_, catalog, err := handler.read(request, projectID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "text jobs read failed")
		return
	}
	generationID := strings.TrimSpace(request.URL.Query().Get("generationId"))
	userID := strings.TrimSpace(request.URL.Query().Get("userId"))
	idempotencyKey := strings.TrimSpace(request.URL.Query().Get("idempotencyKey"))
	running := request.URL.Query().Get("running") == "true"
	if generationID != "" || idempotencyKey != "" || running {
		for _, job := range catalog.Jobs {
			if generationID != "" && textJobString(job, "generationId") != generationID {
				continue
			}
			if userID != "" && textJobString(job, "userId") != userID {
				continue
			}
			if idempotencyKey != "" && textJobString(job, "idempotencyKey") != idempotencyKey {
				continue
			}
			if running {
				status := textJobString(job, "status")
				if status != "queued" && status != "running" {
					continue
				}
			}
			writeJSON(writer, http.StatusOK, map[string]any{"job": job})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]any{"job": nil})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"jobs": catalog.Jobs})
}

func (handler *TextGenerationJobs) save(writer http.ResponseWriter, request *http.Request) {
	var job map[string]any
	if err := decodeJSON(writer, request, &job); err != nil {
		return
	}
	if !validTextJob(job) {
		writeError(writer, http.StatusBadRequest, "invalid text generation job")
		return
	}
	projectID := textJobString(job, "projectId")
	generationID := textJobString(job, "generationId")
	for attempt := 0; attempt < maxTextJobWriteAttempts; attempt++ {
		revision, catalog, err := handler.read(request, projectID)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "text jobs read failed")
			return
		}
		replaced := false
		for index, existing := range catalog.Jobs {
			if textJobString(existing, "generationId") == generationID {
				catalog.Jobs[index] = job
				replaced = true
				break
			}
		}
		if !replaced {
			catalog.Jobs = append(catalog.Jobs, job)
		}
		catalog.UpdatedAt = requestTime()
		value, err := json.Marshal(catalog)
		if err != nil {
			writeError(writer, http.StatusBadRequest, "invalid text generation job")
			return
		}
		document, err := handler.store.PutDocument(request.Context(), textJobNamespace, projectID, &revision, value)
		if errors.Is(err, postgres.ErrRevisionConflict) {
			if handler.cache != nil {
				_ = handler.cache.Delete(request.Context(), textJobNamespace, projectID)
			}
			continue
		}
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "text job write failed")
			return
		}
		if handler.cache != nil {
			_ = handler.cache.Set(request.Context(), document)
		}
		writeJSON(writer, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	writeError(writer, http.StatusConflict, "text job write conflict")
}
