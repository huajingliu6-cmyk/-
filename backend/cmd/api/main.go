package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/config"
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		if err := healthcheck(); err != nil {
			slog.Error("healthcheck failed", "error", err.Error())
			os.Exit(1)
		}
		return
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error(`configuration failed`, `error`, err.Error())
		os.Exit(1)
	}

	application, err := app.New(context.Background(), cfg)
	if err != nil {
		slog.Error(`application startup failed`, `error`, err.Error())
		os.Exit(1)
	}
	defer application.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pprofServer, err := app.StartPprof(ctx, cfg.PprofListenAddress, cfg.InternalToken, logger)
	if err != nil {
		slog.Error(`pprof startup failed`, `error`, err.Error())
		os.Exit(1)
	}
	if pprofServer != nil {
		defer func() {
			shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = pprofServer.Shutdown(shutdown)
		}()
	}

	// WriteTimeout is 5m to accommodate large blob uploads/downloads via /v1/blobs/.
	// ReadHeaderTimeout guards slowloris; ReadTimeout bounds full request bodies.
	server := &http.Server{
		Addr:              cfg.ListenAddress,
		Handler:           application.Handler(),
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
	}

	go func() {
		slog.Info(`api listening`, `address`, cfg.ListenAddress)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error(`http server failed`, `error`, err.Error())
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdown); err != nil {
		slog.Error(`shutdown failed`, `error`, err.Error())
	}
}

func healthcheck() error {
	url := os.Getenv("BACKEND_HEALTH_URL")
	if url == "" {
		url = "http://127.0.0.1:8080/health/live"
	}
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Get(url)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return errors.New(response.Status)
	}
	return nil
}
