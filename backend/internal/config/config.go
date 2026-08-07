package config

import (
	"errors"
	"net"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ListenAddress        string
	DatabaseURL          string
	SSDBAddress          string
	SSDBPassword         string
	SSDBTimeout          time.Duration
	InternalToken        string
	BlobStorageDriver    string
	BlobstoreInternalURL string
	BlobstoreToken       string
	CacheTTL             time.Duration
	CacheEnv             string

	PostgresMaxConns        int32
	PostgresMinConns        int32
	PostgresMaxConnLifetime time.Duration
	PostgresMaxConnIdleTime time.Duration
	PostgresConnectTimeout  time.Duration

	PprofListenAddress string

	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		ListenAddress:        value(`BACKEND_LISTEN_ADDRESS`, `0.0.0.0:8080`),
		DatabaseURL:          strings.TrimSpace(os.Getenv(`DATABASE_URL`)),
		SSDBAddress:          strings.TrimSpace(os.Getenv(`SSDB_ADDRESS`)),
		SSDBPassword:         os.Getenv(`SSDB_PASSWORD`),
		SSDBTimeout:          ssdbTimeout(),
		InternalToken:        strings.TrimSpace(os.Getenv(`INTERNAL_API_TOKEN`)),
		BlobStorageDriver:    strings.ToLower(value(`BLOB_STORAGE_DRIVER`, `postgres`)),
		BlobstoreInternalURL: strings.TrimSpace(os.Getenv(`BLOBSTORE_INTERNAL_URL`)),
		BlobstoreToken:       strings.TrimSpace(os.Getenv(`BLOBSTORE_INTERNAL_TOKEN`)),
		CacheTTL:             cacheTTL(),
		CacheEnv:             cacheEnv(),

		PostgresMaxConns:        int32(intEnv(`POSTGRES_MAX_CONNS`, 20)),
		PostgresMinConns:        int32(intEnv(`POSTGRES_MIN_CONNS`, 2)),
		PostgresMaxConnLifetime: durationEnv(`POSTGRES_MAX_CONN_LIFETIME`, 30*time.Minute),
		PostgresMaxConnIdleTime: durationEnv(`POSTGRES_MAX_CONN_IDLE_TIME`, 5*time.Minute),
		PostgresConnectTimeout:  durationEnv(`POSTGRES_CONNECT_TIMEOUT`, 5*time.Second),

		PprofListenAddress: strings.TrimSpace(os.Getenv(`PPROF_LISTEN_ADDRESS`)),

		ReadHeaderTimeout: durationEnv(`HTTP_READ_HEADER_TIMEOUT`, 5*time.Second),
		ReadTimeout:       durationEnv(`HTTP_READ_TIMEOUT`, 30*time.Second),
		WriteTimeout:      durationEnv(`HTTP_WRITE_TIMEOUT`, 5*time.Minute),
		IdleTimeout:       durationEnv(`HTTP_IDLE_TIMEOUT`, 60*time.Second),
	}
	if cfg.DatabaseURL == `` {
		return Config{}, errors.New(`DATABASE_URL is required`)
	}
	if cfg.InternalToken == `` {
		return Config{}, errors.New(`INTERNAL_API_TOKEN is required`)
	}
	if cfg.BlobStorageDriver != `postgres` && cfg.BlobStorageDriver != `remotefile` {
		return Config{}, errors.New(`BLOB_STORAGE_DRIVER must be postgres or remotefile`)
	}
	if cfg.BlobStorageDriver == `remotefile` && (cfg.BlobstoreInternalURL == `` || cfg.BlobstoreToken == ``) {
		return Config{}, errors.New(`BLOBSTORE_INTERNAL_URL and BLOBSTORE_INTERNAL_TOKEN are required for remotefile storage`)
	}
	return cfg, nil
}

func cacheEnv() string {
	if env := strings.TrimSpace(os.Getenv(`CACHE_ENV`)); env != `` {
		return env
	}
	if env := strings.TrimSpace(os.Getenv(`APP_ENV`)); env != `` {
		return env
	}
	return `dev`
}

func cacheTTL() time.Duration {
	seconds := intEnv(`CACHE_TTL_SECONDS`, 900)
	if seconds < 1 {
		return 900 * time.Second
	}
	return time.Duration(seconds) * time.Second
}

func ssdbTimeout() time.Duration {
	ms := intEnv(`SSDB_TIMEOUT_MS`, 500)
	if ms < 100 {
		ms = 100
	}
	if ms > 3000 {
		ms = 3000
	}
	return time.Duration(ms) * time.Millisecond
}

func value(name string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != `` {
		return value
	}
	return fallback
}

func intEnv(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == `` {
		return fallback
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return parsed
}

func durationEnv(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == `` {
		return fallback
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil {
		return fallback
	}
	return parsed
}

// PprofRequiresAuth reports whether the pprof listener binds to a non-loopback address.
func PprofRequiresAuth(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return true
	}
	if host == `` || host == `localhost` || host == `127.0.0.1` || host == `::1` {
		return false
	}
	ip := net.ParseIP(host)
	return ip == nil || !ip.IsLoopback()
}
