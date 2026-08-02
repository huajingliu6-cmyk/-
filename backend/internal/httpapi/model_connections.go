package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"reflect"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

const modelConnectionsNamespace = "ai-model-connections"
const modelConnectionsKey = "global"
const maxModelConnectionsWriteAttempts = 6

type modelConnectionsFile struct {
	SchemaVersion int                `json:"schemaVersion"`
	Connections   []map[string]any   `json:"connections"`
	SlotBindings  map[string]*string `json:"slotBindings"`
}

type ModelConnections struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewModelConnections(store *postgres.Store, documentCache *cache.Documents) *ModelConnections {
	return &ModelConnections{store: store, cache: documentCache}
}

func (handler *ModelConnections) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet:
		_, file, found, err := handler.read(request)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "model connections read failed")
			return
		}
		if !found {
			writeError(writer, http.StatusNotFound, "model connections not found")
			return
		}
		writeJSON(writer, http.StatusOK, file)
	case http.MethodPut:
		handler.applyDelta(writer, request)
	default:
		methodNotAllowed(writer, "GET, PUT")
	}
}

func normalizeModelConnectionsFile(file modelConnectionsFile) modelConnectionsFile {
	file.SchemaVersion = 1
	if file.Connections == nil {
		file.Connections = []map[string]any{}
	}
	if file.SlotBindings == nil {
		file.SlotBindings = map[string]*string{}
	}
	return file
}

func (handler *ModelConnections) read(request *http.Request) (int64, modelConnectionsFile, bool, error) {
	if handler.cache != nil {
		if document, ok := handler.cache.Get(request.Context(), modelConnectionsNamespace, modelConnectionsKey); ok {
			var file modelConnectionsFile
			if json.Unmarshal(document.Value, &file) == nil {
				return document.Revision, normalizeModelConnectionsFile(file), true, nil
			}
		}
	}
	document, err := handler.store.GetDocument(request.Context(), modelConnectionsNamespace, modelConnectionsKey)
	if errors.Is(err, postgres.ErrNotFound) {
		return 0, normalizeModelConnectionsFile(modelConnectionsFile{}), false, nil
	}
	if err != nil {
		return 0, modelConnectionsFile{}, false, err
	}
	var file modelConnectionsFile
	if err := json.Unmarshal(document.Value, &file); err != nil {
		return 0, modelConnectionsFile{}, false, err
	}
	if handler.cache != nil {
		_ = handler.cache.Set(request.Context(), document)
	}
	return document.Revision, normalizeModelConnectionsFile(file), true, nil
}

func connectionIdentity(connection map[string]any) string {
	identity, _ := connection["id"].(string)
	return identity
}

func applyModelConnectionsDelta(current, base, desired modelConnectionsFile) modelConnectionsFile {
	baseConnections := map[string]map[string]any{}
	for _, connection := range base.Connections {
		if identity := connectionIdentity(connection); identity != "" {
			baseConnections[identity] = connection
		}
	}
	mergedConnections := map[string]map[string]any{}
	order := []string{}
	for _, connection := range current.Connections {
		identity := connectionIdentity(connection)
		if identity == "" {
			continue
		}
		if _, exists := mergedConnections[identity]; !exists {
			order = append(order, identity)
		}
		mergedConnections[identity] = connection
	}
	for _, connection := range desired.Connections {
		identity := connectionIdentity(connection)
		if identity == "" {
			continue
		}
		original, existedInBase := baseConnections[identity]
		if !existedInBase || !reflect.DeepEqual(original, connection) {
			if _, exists := mergedConnections[identity]; !exists {
				order = append(order, identity)
			}
			mergedConnections[identity] = connection
		}
	}
	connections := make([]map[string]any, 0, len(order))
	for _, identity := range order {
		connections = append(connections, mergedConnections[identity])
	}

	slotBindings := map[string]*string{}
	for slot, connectionID := range current.SlotBindings {
		slotBindings[slot] = connectionID
	}
	allSlots := map[string]bool{}
	for slot := range base.SlotBindings {
		allSlots[slot] = true
	}
	for slot := range desired.SlotBindings {
		allSlots[slot] = true
	}
	for slot := range allSlots {
		baseValue, baseExists := base.SlotBindings[slot]
		desiredValue, desiredExists := desired.SlotBindings[slot]
		if baseExists != desiredExists || !reflect.DeepEqual(baseValue, desiredValue) {
			if desiredExists {
				slotBindings[slot] = desiredValue
			} else {
				slotBindings[slot] = nil
			}
		}
	}
	return modelConnectionsFile{SchemaVersion: 1, Connections: connections, SlotBindings: slotBindings}
}

func (handler *ModelConnections) applyDelta(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Base    modelConnectionsFile `json:"base"`
		Desired modelConnectionsFile `json:"desired"`
	}
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	input.Base = normalizeModelConnectionsFile(input.Base)
	input.Desired = normalizeModelConnectionsFile(input.Desired)
	for attempt := 0; attempt < maxModelConnectionsWriteAttempts; attempt++ {
		revision, current, _, err := handler.read(request)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "model connections read failed")
			return
		}
		merged := applyModelConnectionsDelta(current, input.Base, input.Desired)
		value, err := json.Marshal(merged)
		if err != nil {
			writeError(writer, http.StatusBadRequest, "invalid model connections")
			return
		}
		document, err := handler.store.PutDocument(request.Context(), modelConnectionsNamespace, modelConnectionsKey, &revision, value)
		if errors.Is(err, postgres.ErrRevisionConflict) {
			if handler.cache != nil {
				_ = handler.cache.Delete(request.Context(), modelConnectionsNamespace, modelConnectionsKey)
			}
			continue
		}
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "model connections write failed")
			return
		}
		if handler.cache != nil {
			_ = handler.cache.Set(request.Context(), document)
		}
		writeJSON(writer, http.StatusOK, merged)
		return
	}
	writeError(writer, http.StatusConflict, "model connections write conflict")
}
