package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

const creditAccountNamespace = "text-credit-accounts"
const creditReservationNamespace = "text-credit-reservations"
const maxCreditWriteAttempts = 6

type creditLedgerEntry struct {
	ID           string `json:"id"`
	UserID       string `json:"userId"`
	Delta        int    `json:"delta"`
	BalanceAfter int    `json:"balanceAfter"`
	Reason       string `json:"reason"`
	GenerationID string `json:"generationId,omitempty"`
	ProjectID    string `json:"projectId,omitempty"`
	CreatedAt    string `json:"createdAt"`
}
type creditAccount struct {
	Version      int                 `json:"version"`
	UserID       string              `json:"userId"`
	Balance      int                 `json:"balance"`
	Ledger       []creditLedgerEntry `json:"ledger"`
	Reservations map[string]int      `json:"reservations"`
	UpdatedAt    string              `json:"updatedAt"`
}
type creditReservation struct {
	Version      int    `json:"version"`
	Active       bool   `json:"active"`
	GenerationID string `json:"generationId"`
	UserID       string `json:"userId"`
	Points       int    `json:"points"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}
type TextCredits struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewTextCredits(store *postgres.Store, documentCache *cache.Documents) *TextCredits {
	return &TextCredits{store: store, cache: documentCache}
}
func creditDocumentKey(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func defaultCreditBalance() int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv("TEXT_CREDITS_DEV_BALANCE")))
	if err != nil {
		return 10000
	}
	if value < 0 {
		return 0
	}
	return value
}
func emptyCreditAccount(userID string) creditAccount {
	return creditAccount{Version: 1, UserID: userID, Balance: defaultCreditBalance(), Ledger: []creditLedgerEntry{}, Reservations: map[string]int{}, UpdatedAt: requestTime()}
}

func (handler *TextCredits) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet:
		handler.get(writer, request)
	case http.MethodPost:
		handler.post(writer, request)
	default:
		methodNotAllowed(writer, "GET, POST")
	}
}
func (handler *TextCredits) readDocument(request *http.Request, namespace, key string) (postgres.Document, bool, error) {
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
func (handler *TextCredits) readAccount(request *http.Request, userID string) (int64, creditAccount, error) {
	document, found, err := handler.readDocument(request, creditAccountNamespace, creditDocumentKey(userID))
	if err != nil {
		return 0, creditAccount{}, err
	}
	if !found {
		return 0, emptyCreditAccount(userID), nil
	}
	var account creditAccount
	if json.Unmarshal(document.Value, &account) != nil || account.Version != 1 || account.UserID != userID || account.Balance < 0 {
		return 0, creditAccount{}, errors.New("REMOTE_CREDITS_CORRUPTED")
	}
	if account.Ledger == nil {
		account.Ledger = []creditLedgerEntry{}
	}
	if account.Reservations == nil {
		account.Reservations = map[string]int{}
	}
	return document.Revision, account, nil
}
func (handler *TextCredits) readReservation(request *http.Request, generationID string) (int64, *creditReservation, error) {
	document, found, err := handler.readDocument(request, creditReservationNamespace, creditDocumentKey(generationID))
	if err != nil || !found {
		return 0, nil, err
	}
	var reservation creditReservation
	if json.Unmarshal(document.Value, &reservation) != nil || reservation.Version != 1 || reservation.GenerationID == "" || reservation.UserID == "" || reservation.Points < 0 {
		return 0, nil, errors.New("REMOTE_CREDITS_CORRUPTED")
	}
	return document.Revision, &reservation, nil
}

func (handler *TextCredits) get(writer http.ResponseWriter, request *http.Request) {
	userID := strings.TrimSpace(request.URL.Query().Get("userId"))
	if userID == "" {
		writeError(writer, 400, "userId is required")
		return
	}
	for attempt := 0; attempt < maxCreditWriteAttempts; attempt++ {
		revision, account, err := handler.readAccount(request, userID)
		if err != nil {
			writeError(writer, 500, "credits read failed")
			return
		}
		if revision == 0 {
			value, _ := json.Marshal(account)
			document, err := handler.store.PutDocument(request.Context(), creditAccountNamespace, creditDocumentKey(userID), &revision, value)
			if errors.Is(err, postgres.ErrRevisionConflict) {
				handler.clearCache(request, userID, "")
				continue
			}
			if err != nil {
				writeError(writer, 500, "credits initialize failed")
				return
			}
			if handler.cache != nil {
				_ = handler.cache.Set(request.Context(), document)
			}
		}
		frozen := 0
		for _, points := range account.Reservations {
			frozen += points
		}
		writeJSON(writer, 200, map[string]int{"balance": account.Balance, "frozen": frozen})
		return
	}
	writeError(writer, 409, "credits write conflict")
}
func (handler *TextCredits) post(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Action       string `json:"action"`
		UserID       string `json:"userId"`
		Points       int    `json:"points"`
		ActualPoints int    `json:"actualPoints"`
		GenerationID string `json:"generationId"`
		ProjectID    string `json:"projectId"`
		Reason       string `json:"reason"`
	}
	if decodeJSON(writer, request, &input) != nil {
		return
	}
	if input.Action == "reserve" {
		handler.reserve(writer, request, strings.TrimSpace(input.UserID), input.Points, strings.TrimSpace(input.GenerationID), input.ProjectID, input.Reason)
		return
	}
	if input.Action == "settle" {
		handler.settle(writer, request, strings.TrimSpace(input.GenerationID), input.ActualPoints, input.ProjectID, input.Reason)
		return
	}
	writeError(writer, 400, "invalid credits action")
}
func (handler *TextCredits) reserve(writer http.ResponseWriter, request *http.Request, userID string, points int, generationID, projectID, reason string) {
	if userID == "" || generationID == "" {
		writeError(writer, 400, "userId and generationId are required")
		return
	}
	if points < 0 {
		points = 0
	}
	for attempt := 0; attempt < maxCreditWriteAttempts; attempt++ {
		ar, account, err := handler.readAccount(request, userID)
		if err != nil {
			writeError(writer, 500, "credits read failed")
			return
		}
		rr, existing, err := handler.readReservation(request, generationID)
		if err != nil {
			writeError(writer, 500, "reservation read failed")
			return
		}
		if existing != nil && existing.Active {
			if existing.UserID != userID {
				writeError(writer, 500, "REMOTE_CREDITS_CORRUPTED")
				return
			}
			writeJSON(writer, 200, map[string]any{"ok": true, "balance": account.Balance})
			return
		}
		if account.Balance < points {
			writeJSON(writer, 200, map[string]any{"ok": false, "error": "剩余积分不足"})
			return
		}
		now := requestTime()
		account.Balance -= points
		account.UpdatedAt = now
		account.Reservations[generationID] = points
		id, err := newUUID()
		if err != nil {
			writeError(writer, 500, "ledger id failed")
			return
		}
		account.Ledger = append(account.Ledger, creditLedgerEntry{ID: id, UserID: userID, Delta: -points, BalanceAfter: account.Balance, Reason: reason, GenerationID: generationID, ProjectID: projectID, CreatedAt: now})
		createdAt := now
		if existing != nil {
			createdAt = existing.CreatedAt
		}
		reservation := creditReservation{Version: 1, Active: true, GenerationID: generationID, UserID: userID, Points: points, CreatedAt: createdAt, UpdatedAt: now}
		av, _ := json.Marshal(account)
		rv, _ := json.Marshal(reservation)
		documents, err := handler.store.PutDocumentsAtomic(request.Context(), []postgres.DocumentWrite{{Namespace: creditAccountNamespace, Key: creditDocumentKey(userID), ExpectedRevision: ar, Value: av}, {Namespace: creditReservationNamespace, Key: creditDocumentKey(generationID), ExpectedRevision: rr, Value: rv}}, nil, nil)
		if errors.Is(err, postgres.ErrRevisionConflict) {
			handler.clearCache(request, userID, generationID)
			continue
		}
		if err != nil {
			writeError(writer, 500, "credits reserve failed")
			return
		}
		handler.cacheDocuments(request, documents)
		writeJSON(writer, 200, map[string]any{"ok": true, "balance": account.Balance})
		return
	}
	writeError(writer, 409, "credits write conflict")
}
func (handler *TextCredits) settle(writer http.ResponseWriter, request *http.Request, generationID string, actualPoints int, projectID, reason string) {
	if generationID == "" {
		writeError(writer, 400, "generationId is required")
		return
	}
	if actualPoints < 0 {
		actualPoints = 0
	}
	for attempt := 0; attempt < maxCreditWriteAttempts; attempt++ {
		rr, reservation, err := handler.readReservation(request, generationID)
		if err != nil {
			writeError(writer, 500, "reservation read failed")
			return
		}
		if reservation == nil || !reservation.Active {
			writeJSON(writer, 200, map[string]bool{"ok": true})
			return
		}
		ar, account, err := handler.readAccount(request, reservation.UserID)
		if err != nil {
			writeError(writer, 500, "credits read failed")
			return
		}
		refund := reservation.Points - actualPoints
		if refund < 0 {
			refund = 0
		}
		now := requestTime()
		account.Balance += refund
		account.UpdatedAt = now
		delete(account.Reservations, generationID)
		if refund > 0 {
			id, err := newUUID()
			if err != nil {
				writeError(writer, 500, "ledger id failed")
				return
			}
			account.Ledger = append(account.Ledger, creditLedgerEntry{ID: id, UserID: reservation.UserID, Delta: refund, BalanceAfter: account.Balance, Reason: reason + ":release", GenerationID: generationID, ProjectID: projectID, CreatedAt: now})
		}
		reservation.Active = false
		reservation.UpdatedAt = now
		av, _ := json.Marshal(account)
		rv, _ := json.Marshal(reservation)
		documents, err := handler.store.PutDocumentsAtomic(request.Context(), []postgres.DocumentWrite{{Namespace: creditAccountNamespace, Key: creditDocumentKey(reservation.UserID), ExpectedRevision: ar, Value: av}, {Namespace: creditReservationNamespace, Key: creditDocumentKey(generationID), ExpectedRevision: rr, Value: rv}}, nil, nil)
		if errors.Is(err, postgres.ErrRevisionConflict) {
			handler.clearCache(request, reservation.UserID, generationID)
			continue
		}
		if err != nil {
			writeError(writer, 500, "credits settle failed")
			return
		}
		handler.cacheDocuments(request, documents)
		writeJSON(writer, 200, map[string]bool{"ok": true})
		return
	}
	writeError(writer, 409, "credits write conflict")
}
func (handler *TextCredits) clearCache(request *http.Request, userID, generationID string) {
	if handler.cache == nil {
		return
	}
	if userID != "" {
		_ = handler.cache.Delete(request.Context(), creditAccountNamespace, creditDocumentKey(userID))
	}
	if generationID != "" {
		_ = handler.cache.Delete(request.Context(), creditReservationNamespace, creditDocumentKey(generationID))
	}
}
func (handler *TextCredits) cacheDocuments(request *http.Request, documents []postgres.Document) {
	if handler.cache == nil {
		return
	}
	for _, document := range documents {
		_ = handler.cache.Set(request.Context(), document)
	}
}
