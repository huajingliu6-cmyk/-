package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

const localPaidTestGuardNamespace = "local-paid-test-guard"

type localPaidTestGuardRecord struct {
	Version            int     `json:"version"`
	State              string  `json:"state"`
	GenerationID       *string `json:"generationId"`
	ProviderTaskID     *string `json:"providerTaskId"`
	RequestFingerprint *string `json:"requestFingerprint"`
	ArmNonceHash       *string `json:"armNonceHash"`
	ArmedAt            *string `json:"armedAt"`
	UpdatedAt          string  `json:"updatedAt"`
	LastErrorCode      *string `json:"lastErrorCode"`
	Simulation         bool    `json:"simulation"`
	Namespace          string  `json:"namespace"`
}

type localPaidTestGuardCommand struct {
	Action             string  `json:"action"`
	Namespace          string  `json:"namespace"`
	GenerationID       *string `json:"generationId,omitempty"`
	ProviderTaskID     *string `json:"providerTaskId,omitempty"`
	RequestFingerprint *string `json:"requestFingerprint,omitempty"`
	ArmNonceHash       *string `json:"armNonceHash,omitempty"`
	ErrorCode          *string `json:"errorCode,omitempty"`
}

type LocalPaidTestGuard struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewLocalPaidTestGuard(store *postgres.Store, documentCache *cache.Documents) *LocalPaidTestGuard {
	return &LocalPaidTestGuard{store: store, cache: documentCache}
}

func (handler *LocalPaidTestGuard) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet:
		handler.get(writer, request)
	case http.MethodPost:
		handler.command(writer, request)
	default:
		methodNotAllowed(writer, "GET, POST")
	}
}

func writeLocalPaidTestGuardError(writer http.ResponseWriter, status int, code string) {
	writeJSON(writer, status, map[string]string{"error": code, "code": code})
}

func validLocalPaidTestGuardNamespace(namespace string) bool {
	return namespace == "live" || namespace == "simulation"
}

func defaultLocalPaidTestGuardRecord(namespace string) localPaidTestGuardRecord {
	return localPaidTestGuardRecord{
		Version: 1, State: "unarmed", UpdatedAt: requestTime(),
		Simulation: namespace == "simulation", Namespace: namespace,
	}
}

func validLocalPaidTestGuardRecord(record localPaidTestGuardRecord, namespace string) bool {
	states := map[string]bool{
		"unarmed": true, "armed": true, "submitting": true,
		"providerAccepted": true, "transferPending": true,
		"completed": true, "failedBeforeSubmit": true,
		"unknownOutcome": true, "consumed": true,
	}
	return record.Version == 1 && states[record.State] && record.UpdatedAt != "" &&
		record.Namespace == namespace && record.Simulation == (namespace == "simulation")
}

func parseLocalPaidTestGuardRecord(value json.RawMessage, namespace string) (localPaidTestGuardRecord, error) {
	var raw map[string]json.RawMessage
	if json.Unmarshal(value, &raw) != nil {
		return localPaidTestGuardRecord{}, errors.New("corrupted")
	}
	for _, forbidden := range []string{"token", "apiKey", "dashscopeApiKey", "prompt", "authorization", "remoteVideoUrl", "base64", "armNonce", "nonce"} {
		if _, exists := raw[forbidden]; exists {
			return localPaidTestGuardRecord{}, errors.New("corrupted")
		}
	}
	var record localPaidTestGuardRecord
	if json.Unmarshal(value, &record) != nil || !validLocalPaidTestGuardRecord(record, namespace) {
		return localPaidTestGuardRecord{}, errors.New("corrupted")
	}
	return record, nil
}

func (handler *LocalPaidTestGuard) read(request *http.Request, namespace string) (int64, localPaidTestGuardRecord, error) {
	if handler.cache != nil {
		if document, ok := handler.cache.Get(request.Context(), localPaidTestGuardNamespace, namespace); ok {
			record, err := parseLocalPaidTestGuardRecord(document.Value, namespace)
			return document.Revision, record, err
		}
	}
	document, err := handler.store.GetDocument(request.Context(), localPaidTestGuardNamespace, namespace)
	if errors.Is(err, postgres.ErrNotFound) {
		return 0, defaultLocalPaidTestGuardRecord(namespace), nil
	}
	if err != nil {
		return 0, localPaidTestGuardRecord{}, err
	}
	record, err := parseLocalPaidTestGuardRecord(document.Value, namespace)
	if err != nil {
		return 0, localPaidTestGuardRecord{}, err
	}
	if handler.cache != nil {
		_ = handler.cache.Set(request.Context(), document)
	}
	return document.Revision, record, nil
}

func (handler *LocalPaidTestGuard) get(writer http.ResponseWriter, request *http.Request) {
	namespace := strings.TrimSpace(request.URL.Query().Get("namespace"))
	if !validLocalPaidTestGuardNamespace(namespace) {
		writeLocalPaidTestGuardError(writer, http.StatusBadRequest, "LOCAL_PAID_TEST_GUARD_CORRUPTED")
		return
	}
	_, record, err := handler.read(request, namespace)
	if err != nil {
		writeLocalPaidTestGuardError(writer, http.StatusConflict, "LOCAL_PAID_TEST_GUARD_CORRUPTED")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"record": record})
}

func (handler *LocalPaidTestGuard) command(writer http.ResponseWriter, request *http.Request) {
	var command localPaidTestGuardCommand
	if err := decodeJSON(writer, request, &command); err != nil {
		return
	}
	if !validLocalPaidTestGuardNamespace(command.Namespace) {
		writeLocalPaidTestGuardError(writer, http.StatusBadRequest, "LOCAL_PAID_TEST_GUARD_CORRUPTED")
		return
	}
	revision, current, err := handler.read(request, command.Namespace)
	if err != nil {
		writeLocalPaidTestGuardError(writer, http.StatusConflict, "LOCAL_PAID_TEST_GUARD_CORRUPTED")
		return
	}
	next, code := applyLocalPaidTestGuardCommand(current, command)
	if code != "" {
		writeLocalPaidTestGuardError(writer, http.StatusConflict, code)
		return
	}
	value, _ := json.Marshal(next)
	document, err := handler.store.PutDocument(request.Context(), localPaidTestGuardNamespace, command.Namespace, &revision, value)
	if errors.Is(err, postgres.ErrRevisionConflict) {
		if handler.cache != nil {
			_ = handler.cache.Delete(request.Context(), localPaidTestGuardNamespace, command.Namespace)
		}
		writeLocalPaidTestGuardError(writer, http.StatusConflict, "LOCAL_PAID_TEST_GUARD_UNAVAILABLE")
		return
	}
	if err != nil {
		writeLocalPaidTestGuardError(writer, http.StatusServiceUnavailable, "LOCAL_PAID_TEST_GUARD_UNAVAILABLE")
		return
	}
	if handler.cache != nil {
		_ = handler.cache.Set(request.Context(), document)
	}
	writeJSON(writer, http.StatusOK, map[string]any{"record": next})
}

func applyLocalPaidTestGuardCommand(current localPaidTestGuardRecord, command localPaidTestGuardCommand) (localPaidTestGuardRecord, string) {
	now := requestTime()
	next := current
	switch command.Action {
	case "arm":
		if command.ArmNonceHash == nil || strings.TrimSpace(*command.ArmNonceHash) == "" {
			return current, "LOCAL_PAID_TEST_GUARD_CORRUPTED"
		}
		if current.State != "unarmed" && current.State != "failedBeforeSubmit" && current.State != "armed" {
			switch current.State {
			case "submitting", "providerAccepted", "transferPending":
				return current, "LOCAL_PAID_TEST_ALREADY_IN_PROGRESS"
			case "unknownOutcome":
				return current, "LOCAL_PAID_TEST_UNKNOWN_OUTCOME"
			default:
				return current, "LOCAL_PAID_TEST_ALREADY_CONSUMED"
			}
		}
		next.State = "armed"
		next.GenerationID = nil
		next.ProviderTaskID = nil
		next.RequestFingerprint = command.RequestFingerprint
		next.ArmNonceHash = command.ArmNonceHash
		next.ArmedAt = &now
		next.LastErrorCode = nil
	case "markSubmitting":
		if current.State != "armed" {
			switch current.State {
			case "submitting", "providerAccepted", "transferPending":
				return current, "LOCAL_PAID_TEST_ALREADY_IN_PROGRESS"
			case "unknownOutcome":
				return current, "LOCAL_PAID_TEST_UNKNOWN_OUTCOME"
			case "completed", "consumed":
				return current, "LOCAL_PAID_TEST_ALREADY_CONSUMED"
			default:
				return current, "LOCAL_PAID_TEST_NOT_ARMED"
			}
		}
		if command.GenerationID == nil || *command.GenerationID == "" {
			return current, "LOCAL_PAID_TEST_GUARD_CORRUPTED"
		}
		next.State = "submitting"
		next.GenerationID = command.GenerationID
		if command.RequestFingerprint != nil {
			next.RequestFingerprint = command.RequestFingerprint
		}
		next.LastErrorCode = nil
	case "markProviderAccepted":
		if current.State != "submitting" && current.State != "providerAccepted" {
			return current, "LOCAL_PAID_TEST_GUARD_CORRUPTED"
		}
		if command.GenerationID == nil || command.ProviderTaskID == nil || strings.TrimSpace(*command.ProviderTaskID) == "" {
			return current, "LOCAL_PAID_TEST_GUARD_CORRUPTED"
		}
		next.State = "providerAccepted"
		next.GenerationID = command.GenerationID
		next.ProviderTaskID = command.ProviderTaskID
		next.LastErrorCode = nil
	case "markTransferPending":
		if current.State != "providerAccepted" && current.State != "transferPending" {
			return current, "LOCAL_PAID_TEST_GUARD_CORRUPTED"
		}
		if command.GenerationID == nil || command.ProviderTaskID == nil {
			return current, "LOCAL_PAID_TEST_GUARD_CORRUPTED"
		}
		next.State = "transferPending"
		next.GenerationID = command.GenerationID
		next.ProviderTaskID = command.ProviderTaskID
	case "markCompleted":
		if command.GenerationID == nil || *command.GenerationID == "" {
			return current, "LOCAL_PAID_TEST_GUARD_CORRUPTED"
		}
		next.State = "completed"
		next.GenerationID = command.GenerationID
		if command.ProviderTaskID != nil {
			next.ProviderTaskID = command.ProviderTaskID
		}
		next.LastErrorCode = nil
	case "markFailedBeforeSubmit":
		if current.State == "providerAccepted" || current.State == "transferPending" || current.State == "completed" || current.State == "unknownOutcome" || current.State == "consumed" {
			return current, "LOCAL_PAID_TEST_GUARD_CORRUPTED"
		}
		next.State = "failedBeforeSubmit"
		next.GenerationID = nil
		next.ProviderTaskID = nil
		next.ArmNonceHash = nil
		next.LastErrorCode = command.ErrorCode
	case "markUnknownOutcome":
		if current.State == "completed" || current.State == "consumed" {
			return current, "LOCAL_PAID_TEST_GUARD_CORRUPTED"
		}
		next.State = "unknownOutcome"
		if command.GenerationID != nil {
			next.GenerationID = command.GenerationID
		}
		next.LastErrorCode = command.ErrorCode
	case "markConsumed":
		next.State = "consumed"
		next.ArmNonceHash = nil
	default:
		return current, "LOCAL_PAID_TEST_GUARD_CORRUPTED"
	}
	next.UpdatedAt = now
	next.Version = 1
	next.Namespace = command.Namespace
	next.Simulation = command.Namespace == "simulation"
	return next, ""
}
