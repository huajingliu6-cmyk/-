package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"infinite-canvas/backend/internal/postgres"
	"infinite-canvas/backend/internal/requestcontext"
)

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (writer *statusWriter) WriteHeader(status int) {
	writer.status = status
	writer.ResponseWriter.WriteHeader(status)
}

func (writer *statusWriter) Write(body []byte) (int, error) {
	if writer.status == 0 {
		writer.WriteHeader(http.StatusOK)
	}
	count, err := writer.ResponseWriter.Write(body)
	writer.bytes += count
	return count, err
}

func Middleware(next http.Handler, token string, store *postgres.Store, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestID := strings.TrimSpace(request.Header.Get(`X-Request-Id`))
		if requestID == `` {
			requestID = newRequestID()
		}
		writer.Header().Set(`X-Request-Id`, requestID)
		if !strings.HasPrefix(request.URL.Path, `/health/`) {
			writer.Header().Set(`Cache-Control`, `no-store`)
		}
		request = request.WithContext(requestcontext.WithRequestID(request.Context(), requestID))
		if request.URL.Path != `/health/live` && !validToken(request.Header.Get(`X-Internal-Token`), token) {
			writeError(writer, http.StatusUnauthorized, `invalid internal token`)
			return
		}

		started := time.Now()
		wrapped := &statusWriter{ResponseWriter: writer}
		next.ServeHTTP(wrapped, request)
		if wrapped.status == 0 {
			wrapped.status = http.StatusOK
		}
		duration := time.Since(started)
		logger.Info(`request`,
			`request_id`, requestID,
			`method`, request.Method,
			`path`, request.URL.Path,
			`status`, wrapped.status,
			`bytes`, wrapped.bytes,
			`duration_ms`, duration.Milliseconds(),
		)
		if request.Method != http.MethodGet && request.Method != http.MethodHead {
			writeAuditAsync(store, logger, requestID, request, wrapped.status, duration)
		}
	})
}

// writeAuditAsync records mutating requests without blocking the response.
// At most one short-lived goroutine is spawned per mutating request.
func writeAuditAsync(store *postgres.Store, logger *slog.Logger, requestID string, request *http.Request, status int, duration time.Duration) {
	metadata, _ := json.Marshal(map[string]any{
		`method`:     request.Method,
		`durationMs`: duration.Milliseconds(),
	})
	event := postgres.AuditEvent{
		RequestID:  requestID,
		ActorID:    request.Header.Get(`X-Actor-Id`),
		Action:     request.Method,
		Resource:   request.URL.Path,
		StatusCode: status,
		Metadata:   metadata,
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := store.WriteAuditEvent(ctx, event); err != nil {
			logger.Error(`audit write failed`, `request_id`, requestID, `error`, err.Error())
		}
	}()
}

func newRequestID() string {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return time.Now().UTC().Format(`20060102T150405.000000000`)
	}
	return hex.EncodeToString(buffer)
}

func validToken(candidate string, expected string) bool {
	candidate = strings.TrimSpace(candidate)
	if candidate == `` || len(candidate) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(candidate), []byte(expected)) == 1
}
