package config

import (
	"testing"
	"time"
)

func TestLoadDefaultsBlobStorageToPostgres(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://database")
	t.Setenv("SSDB_ADDRESS", "")
	t.Setenv("INTERNAL_API_TOKEN", "secret")
	t.Setenv("BLOB_STORAGE_DRIVER", "")
	t.Setenv("BLOBSTORE_INTERNAL_URL", "")
	t.Setenv("BLOBSTORE_INTERNAL_TOKEN", "")
	config, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if config.BlobStorageDriver != "postgres" {
		t.Fatalf("unexpected driver: %s", config.BlobStorageDriver)
	}
}

func TestLoadAllowsSSDBToBeDisabled(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://database")
	t.Setenv("SSDB_ADDRESS", "")
	t.Setenv("INTERNAL_API_TOKEN", "secret")
	config, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if config.SSDBAddress != "" {
		t.Fatalf("unexpected SSDB address: %s", config.SSDBAddress)
	}
}

func TestLoadRequiresRemoteFileSettings(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://database")
	t.Setenv("SSDB_ADDRESS", "ssdb:8888")
	t.Setenv("INTERNAL_API_TOKEN", "secret")
	t.Setenv("BLOB_STORAGE_DRIVER", "remotefile")
	t.Setenv("BLOBSTORE_INTERNAL_URL", "")
	t.Setenv("BLOBSTORE_INTERNAL_TOKEN", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected missing remote file settings error")
	}
	t.Setenv("BLOBSTORE_INTERNAL_URL", "http://blobstore:8090")
	t.Setenv("BLOBSTORE_INTERNAL_TOKEN", "blob-secret")
	config, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if config.BlobStorageDriver != "remotefile" {
		t.Fatalf("unexpected driver: %s", config.BlobStorageDriver)
	}
}

func TestLoadRejectsUnknownBlobStorageDriver(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://database")
	t.Setenv("SSDB_ADDRESS", "ssdb:8888")
	t.Setenv("INTERNAL_API_TOKEN", "secret")
	t.Setenv("BLOB_STORAGE_DRIVER", "unknown")
	if _, err := Load(); err == nil {
		t.Fatal("expected invalid driver error")
	}
}

func TestLoadPostgresPoolDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://database")
	t.Setenv("INTERNAL_API_TOKEN", "secret")
	unsetEnv(t,
		"POSTGRES_MAX_CONNS",
		"POSTGRES_MIN_CONNS",
		"POSTGRES_MAX_CONN_LIFETIME",
		"POSTGRES_MAX_CONN_IDLE_TIME",
		"POSTGRES_CONNECT_TIMEOUT",
	)
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PostgresMaxConns != 20 || cfg.PostgresMinConns != 2 {
		t.Fatalf("unexpected pool sizes: max=%d min=%d", cfg.PostgresMaxConns, cfg.PostgresMinConns)
	}
	if cfg.PostgresMaxConnLifetime != 30*time.Minute {
		t.Fatalf("unexpected max lifetime: %s", cfg.PostgresMaxConnLifetime)
	}
	if cfg.PostgresMaxConnIdleTime != 5*time.Minute {
		t.Fatalf("unexpected max idle: %s", cfg.PostgresMaxConnIdleTime)
	}
	if cfg.PostgresConnectTimeout != 5*time.Second {
		t.Fatalf("unexpected connect timeout: %s", cfg.PostgresConnectTimeout)
	}
}

func TestLoadSSDBTimeoutClamped(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://database")
	t.Setenv("INTERNAL_API_TOKEN", "secret")
	t.Setenv("SSDB_TIMEOUT_MS", "50")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SSDBTimeout != 100*time.Millisecond {
		t.Fatalf("expected clamped 100ms, got %s", cfg.SSDBTimeout)
	}
	t.Setenv("SSDB_TIMEOUT_MS", "9999")
	cfg, err = Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SSDBTimeout != 3000*time.Millisecond {
		t.Fatalf("expected clamped 3000ms, got %s", cfg.SSDBTimeout)
	}
}

func TestLoadCacheTTLAndEnv(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://database")
	t.Setenv("INTERNAL_API_TOKEN", "secret")
	t.Setenv("CACHE_TTL_SECONDS", "120")
	t.Setenv("APP_ENV", "staging")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.CacheTTL != 120*time.Second {
		t.Fatalf("unexpected cache ttl: %s", cfg.CacheTTL)
	}
	if cfg.CacheEnv != "staging" {
		t.Fatalf("unexpected cache env: %s", cfg.CacheEnv)
	}
}

func TestPprofRequiresAuth(t *testing.T) {
	if PprofRequiresAuth("127.0.0.1:6060") {
		t.Fatal("loopback should not require auth")
	}
	if !PprofRequiresAuth("0.0.0.0:6060") {
		t.Fatal("non-loopback should require auth")
	}
}

func unsetEnv(t *testing.T, names ...string) {
	t.Helper()
	for _, name := range names {
		t.Setenv(name, "")
	}
}
