package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"infinite-canvas/backend/internal/blobstore/fileserver"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		if err := healthcheck(); err != nil {
			logger.Error("healthcheck failed", "error", err.Error())
			os.Exit(1)
		}
		return
	}
	address := value("BLOBSTORE_LISTEN_ADDRESS", "0.0.0.0:8090")
	handler, err := fileserver.New(os.Getenv("BLOBSTORE_DATA_ROOT"), os.Getenv("BLOBSTORE_INTERNAL_TOKEN"))
	if err != nil {
		logger.Error("configuration failed", "error", err.Error())
		os.Exit(1)
	}
	server := &http.Server{
		Addr:              address,
		Handler:           requestLogger(handler, logger),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       5 * time.Minute,
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       90 * time.Second,
	}
	logger.Info("blob store listening", "address", address)
	if err := server.ListenAndServe(); err != nil {
		logger.Error("blob store stopped", "error", err.Error())
		os.Exit(1)
	}
}

func healthcheck() error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, value("BLOBSTORE_HEALTH_URL", "http://127.0.0.1:8090/health/live"), nil)
	if err != nil {
		return err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %s", response.Status)
	}
	return nil
}

func requestLogger(next http.Handler, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		started := time.Now()
		wrapped := &statusWriter{ResponseWriter: writer}
		next.ServeHTTP(wrapped, request)
		status := wrapped.status
		if status == 0 {
			status = http.StatusOK
		}
		logger.Info("request", "request_id", request.Header.Get("X-Request-Id"), "method", request.Method, "path", request.URL.Path, "status", status, "bytes", wrapped.bytes, "duration_ms", time.Since(started).Milliseconds())
	})
}

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

func value(name string, fallback string) string {
	if configured := strings.TrimSpace(os.Getenv(name)); configured != "" {
		return configured
	}
	return fallback
}
