package app

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"time"

	"infinite-canvas/backend/internal/blobstore"
	"infinite-canvas/backend/internal/blobstore/remotefile"
	"infinite-canvas/backend/internal/blobstore/split"
	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/config"
	"infinite-canvas/backend/internal/httpapi"
	"infinite-canvas/backend/internal/migrations"
	"infinite-canvas/backend/internal/postgres"
	"infinite-canvas/backend/internal/ssdb"
)

type App struct {
	store   *postgres.Store
	cache   *ssdb.Client
	handler http.Handler
}

func remoteFileHTTPClient() *http.Client {
	transport := &http.Transport{
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   20,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
	}
	return &http.Client{
		Timeout:   5 * time.Minute,
		Transport: transport,
	}
}

func New(ctx context.Context, cfg config.Config) (*App, error) {
	poolCfg := postgres.PoolConfig{
		MaxConns:        cfg.PostgresMaxConns,
		MinConns:        cfg.PostgresMinConns,
		MaxConnLifetime: cfg.PostgresMaxConnLifetime,
		MaxConnIdleTime: cfg.PostgresMaxConnIdleTime,
		ConnectTimeout:  cfg.PostgresConnectTimeout,
	}
	if poolCfg.MaxConns == 0 {
		poolCfg = postgres.DefaultPoolConfig()
	}
	store, err := postgres.Open(ctx, cfg.DatabaseURL, poolCfg)
	if err != nil {
		return nil, err
	}
	if err := migrations.Apply(ctx, store); err != nil {
		store.Close()
		return nil, err
	}
	var cacheClient *ssdb.Client
	if cfg.SSDBAddress != "" {
		ssdbTimeout := cfg.SSDBTimeout
		if ssdbTimeout == 0 {
			ssdbTimeout = 500 * time.Millisecond
		}
		cacheClient = ssdb.NewWithTimeout(cfg.SSDBAddress, cfg.SSDBPassword, ssdbTimeout)
		if err := cacheClient.Ping(ctx); err != nil {
			store.Close()
			return nil, err
		}
	}

	documentCache := cache.NewDocuments(cacheClient, cfg.CacheTTL, cfg.CacheEnv)
	documents := httpapi.NewDocuments(store, documentCache)
	var blobStorage blobstore.Store = store
	var remoteFileClient *remotefile.Client
	if cfg.BlobStorageDriver == "remotefile" {
		remoteFileClient, err = remotefile.NewClient(cfg.BlobstoreInternalURL, cfg.BlobstoreToken, remoteFileHTTPClient())
		if err != nil {
			store.Close()
			return nil, err
		}
		if err := remoteFileClient.Ping(ctx); err != nil {
			store.Close()
			return nil, err
		}
		blobStorage = split.New(store, remoteFileClient)
	}
	documentTransactions := httpapi.NewDocumentTransactions(store, documentCache, blobStorage)
	blobs := httpapi.NewBlobs(blobStorage)
	projects := httpapi.NewProjects(store, documentCache)
	users := httpapi.NewUsers(store, documentCache)
	projectMembers := httpapi.NewProjectMembers(store, documentCache)
	notifications := httpapi.NewNotifications(store, documentCache)
	aiTaskRules := httpapi.NewAiTaskRules(store, documentCache)
	generationAPIConfigs := httpapi.NewGenerationAPIConfigs(store, documentCache)
	modelConnections := httpapi.NewModelConnections(store, documentCache)
	textCredits := httpapi.NewTextCredits(store, documentCache)
	textGenerationJobs := httpapi.NewTextGenerationJobs(store, documentCache)
	videoGenerations := httpapi.NewVideoGenerations(store, documentCache)
	videoGenerationIdempotency := httpapi.NewVideoGenerationIdempotency(store, documentCache)
	localPaidTestGuard := httpapi.NewLocalPaidTestGuard(store, documentCache)
	scriptDrafts := httpapi.NewScriptDrafts(store, documentCache)
	projectTextDocuments := httpapi.NewProjectTextDocuments(store, documentCache)
	storyboardProductions := httpapi.NewStoryboardProductions(store, documentCache)
	workflows := httpapi.NewWorkflows(store, documentCache)
	workspaceData := httpapi.NewWorkspaceData(store, documentCache)
	projectAssetData := httpapi.NewProjectAssetData(store, documentCache)
	projectAssetTransactions := httpapi.NewProjectAssetTransactions(store, documentCache, blobStorage)
	legacyVideoShotGeneration := httpapi.NewLegacyVideoShotGeneration()
	mux := http.NewServeMux()
	mux.HandleFunc(`/health/live`, func(writer http.ResponseWriter, _ *http.Request) {
		httpapi.WriteHealth(writer, http.StatusOK, map[string]string{`status`: `ok`})
	})
	mux.HandleFunc(`/health/ready`, func(writer http.ResponseWriter, request *http.Request) {
		if err := store.Ping(request.Context()); err != nil {
			httpapi.WriteHealth(writer, http.StatusServiceUnavailable, map[string]string{`status`: `postgres_unavailable`})
			return
		}
		if cacheClient != nil {
			if err := cacheClient.Ping(request.Context()); err != nil {
				httpapi.WriteHealth(writer, http.StatusServiceUnavailable, map[string]string{`status`: `ssdb_unavailable`})
				return
			}
		}
		if remoteFileClient != nil {
			if err := remoteFileClient.Ping(request.Context()); err != nil {
				httpapi.WriteHealth(writer, http.StatusServiceUnavailable, map[string]string{`status`: `blobstore_unavailable`})
				return
			}
		}
		httpapi.WriteHealth(writer, http.StatusOK, map[string]string{`status`: `ready`})
	})
	mux.Handle(`/v1/documents/`, documents)
	mux.Handle(`/v1/document-transactions`, documentTransactions)
	mux.Handle(`/v1/blobs/`, blobs)
	mux.Handle(`/v1/projects`, projects)
	mux.Handle(`/v1/projects/`, projects)
	mux.Handle(`/v1/users`, users)
	mux.Handle(`/v1/users/`, users)
	mux.Handle("/v1/project-members", projectMembers)
	mux.Handle("/v1/project-members/", projectMembers)
	mux.Handle("/v1/notifications", notifications)
	mux.Handle("/v1/ai-task-rules", aiTaskRules)
	mux.Handle("/v1/ai-task-rules/", aiTaskRules)
	mux.Handle("/v1/generation-api-configs", generationAPIConfigs)
	mux.Handle("/v1/model-connections", modelConnections)
	mux.Handle("/v1/text-credits", textCredits)
	mux.Handle("/v1/text-generation-jobs", textGenerationJobs)
	mux.Handle("/v1/video-generations", videoGenerations)
	mux.HandleFunc("/v1/video-generations/browser-metadata", videoGenerations.ServeBrowserMetadataHTTP)
	mux.Handle("/v1/video-generation-idempotency", videoGenerationIdempotency)
	mux.HandleFunc("/v1/video-generation-idempotency/reconcile", videoGenerationIdempotency.ServeReconcileHTTP)
	mux.Handle("/v1/local-paid-test-guard", localPaidTestGuard)
	mux.Handle("/v1/script-drafts", scriptDrafts)
	mux.Handle("/v1/project-text-documents", projectTextDocuments)
	mux.Handle("/v1/storyboard-productions", storyboardProductions)
	mux.Handle("/v1/workflows", workflows)
	mux.Handle("/v1/workspace-data", workspaceData)
	mux.Handle("/v1/project-asset-data", projectAssetData)
	mux.Handle("/v1/project-asset-transactions", projectAssetTransactions)
	mux.Handle("/v1/generate/video-shot", legacyVideoShotGeneration)
	mux.HandleFunc(`/`, func(writer http.ResponseWriter, _ *http.Request) {
		httpapi.WriteHealth(writer, http.StatusNotFound, map[string]string{`error`: `not found`})
	})

	return &App{
		store:   store,
		cache:   cacheClient,
		handler: httpapi.Middleware(mux, cfg.InternalToken, store, slog.Default()),
	}, nil
}

func (app *App) Handler() http.Handler { return app.handler }
func (app *App) Close() {
	if app.cache != nil {
		_ = app.cache.Close()
	}
	app.store.Close()
}

// StartPprof starts an optional pprof HTTP server when address is non-empty.
func StartPprof(ctx context.Context, address string, internalToken string, logger *slog.Logger) (*http.Server, error) {
	if address == "" {
		return nil, nil
	}
	mux := http.NewServeMux()
	if config.PprofRequiresAuth(address) {
		mux.Handle("/", httpapi.PprofHandler(internalToken))
	} else {
		mux.Handle("/", httpapi.PprofHandler(""))
	}
	server := &http.Server{
		Addr:              address,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}
	go func() {
		logger.Info("pprof listening", "address", address, "auth_required", config.PprofRequiresAuth(address))
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("pprof server failed", "error", err.Error())
		}
	}()
	return server, nil
}
