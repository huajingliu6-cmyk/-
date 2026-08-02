package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

const generationAPIConfigNamespace = "generation-api-configs"
const generationAPIConfigKey = "global"
const maxGenerationAPIConfigWriteAttempts = 6

type generationAPIConfigFile struct {
	Version  int              `json:"version"`
	Configs  []map[string]any `json:"configs"`
	Bindings []map[string]any `json:"bindings"`
	Audit    []map[string]any `json:"audit"`
}

type GenerationAPIConfigs struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewGenerationAPIConfigs(store *postgres.Store, documentCache *cache.Documents) *GenerationAPIConfigs {
	return &GenerationAPIConfigs{store: store, cache: documentCache}
}

func (handler *GenerationAPIConfigs) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet:
		_, file, err := handler.read(request)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "generation API config read failed")
			return
		}
		writeJSON(writer, http.StatusOK, file)
	case http.MethodPut:
		handler.merge(writer, request)
	default:
		methodNotAllowed(writer, "GET, PUT")
	}
}

func normalizeGenerationAPIConfigFile(file generationAPIConfigFile) generationAPIConfigFile {
	file.Version = 2
	if file.Configs == nil {
		file.Configs = []map[string]any{}
	}
	if file.Bindings == nil {
		file.Bindings = []map[string]any{}
	}
	if file.Audit == nil {
		file.Audit = []map[string]any{}
	}
	return file
}

func (handler *GenerationAPIConfigs) read(request *http.Request) (int64, generationAPIConfigFile, error) {
	if handler.cache != nil {
		if document, ok := handler.cache.Get(request.Context(), generationAPIConfigNamespace, generationAPIConfigKey); ok {
			var file generationAPIConfigFile
			if json.Unmarshal(document.Value, &file) == nil {
				return document.Revision, normalizeGenerationAPIConfigFile(file), nil
			}
		}
	}
	document, err := handler.store.GetDocument(request.Context(), generationAPIConfigNamespace, generationAPIConfigKey)
	if errors.Is(err, postgres.ErrNotFound) {
		return 0, normalizeGenerationAPIConfigFile(generationAPIConfigFile{}), nil
	}
	if err != nil {
		return 0, generationAPIConfigFile{}, err
	}
	var file generationAPIConfigFile
	if err := json.Unmarshal(document.Value, &file); err != nil {
		return 0, generationAPIConfigFile{}, err
	}
	if handler.cache != nil {
		_ = handler.cache.Set(request.Context(), document)
	}
	return document.Revision, normalizeGenerationAPIConfigFile(file), nil
}

func configRecordString(record map[string]any, key string) string {
	value, _ := record[key].(string)
	return value
}

func mergeConfigRecords(current, desired []map[string]any, identityKey string) []map[string]any {
	merged := map[string]map[string]any{}
	order := []string{}
	for _, record := range current {
		identity := configRecordString(record, identityKey)
		if identity == "" {
			continue
		}
		if _, exists := merged[identity]; !exists {
			order = append(order, identity)
		}
		merged[identity] = record
	}
	for _, record := range desired {
		identity := configRecordString(record, identityKey)
		if identity == "" {
			continue
		}
		existing, exists := merged[identity]
		if !exists {
			order = append(order, identity)
			merged[identity] = record
			continue
		}
		if configRecordString(record, "updatedAt") >= configRecordString(existing, "updatedAt") {
			merged[identity] = record
		}
	}
	result := make([]map[string]any, 0, len(order))
	for _, identity := range order {
		result = append(result, merged[identity])
	}
	return result
}

func mergeGenerationAPIConfigFiles(current, desired generationAPIConfigFile) generationAPIConfigFile {
	audit := mergeConfigRecords(current.Audit, desired.Audit, "id")
	sort.SliceStable(audit, func(left, right int) bool {
		return configRecordString(audit[left], "updatedAt") < configRecordString(audit[right], "updatedAt")
	})
	if len(audit) > 200 {
		audit = audit[len(audit)-200:]
	}
	return generationAPIConfigFile{Version: 2, Configs: mergeConfigRecords(current.Configs, desired.Configs, "id"), Bindings: mergeConfigRecords(current.Bindings, desired.Bindings, "capabilityId"), Audit: audit}
}

func (handler *GenerationAPIConfigs) merge(writer http.ResponseWriter, request *http.Request) {
	var desired generationAPIConfigFile
	if err := decodeJSON(writer, request, &desired); err != nil {
		return
	}
	desired = normalizeGenerationAPIConfigFile(desired)
	for attempt := 0; attempt < maxGenerationAPIConfigWriteAttempts; attempt++ {
		revision, current, err := handler.read(request)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "generation API config read failed")
			return
		}
		merged := mergeGenerationAPIConfigFiles(current, desired)
		value, err := json.Marshal(merged)
		if err != nil {
			writeError(writer, http.StatusBadRequest, "invalid generation API config")
			return
		}
		document, err := handler.store.PutDocument(request.Context(), generationAPIConfigNamespace, generationAPIConfigKey, &revision, value)
		if errors.Is(err, postgres.ErrRevisionConflict) {
			if handler.cache != nil {
				_ = handler.cache.Delete(request.Context(), generationAPIConfigNamespace, generationAPIConfigKey)
			}
			continue
		}
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "generation API config write failed")
			return
		}
		if handler.cache != nil {
			_ = handler.cache.Set(request.Context(), document)
		}
		writeJSON(writer, http.StatusOK, merged)
		return
	}
	writeError(writer, http.StatusConflict, "generation API config write conflict")
}
