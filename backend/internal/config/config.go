package config

import (
	"errors"
	"os"
	"strings"
	"time"
)

type Config struct {
	ListenAddress        string
	DatabaseURL          string
	SSDBAddress          string
	SSDBPassword         string
	InternalToken        string
	BlobStorageDriver    string
	BlobstoreInternalURL string
	BlobstoreToken       string
	CacheTTL             time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		ListenAddress:        value(`BACKEND_LISTEN_ADDRESS`, `0.0.0.0:8080`),
		DatabaseURL:          strings.TrimSpace(os.Getenv(`DATABASE_URL`)),
		SSDBAddress:          strings.TrimSpace(os.Getenv(`SSDB_ADDRESS`)),
		SSDBPassword:         os.Getenv(`SSDB_PASSWORD`),
		InternalToken:        strings.TrimSpace(os.Getenv(`INTERNAL_API_TOKEN`)),
		BlobStorageDriver:    strings.ToLower(value(`BLOB_STORAGE_DRIVER`, `postgres`)),
		BlobstoreInternalURL: strings.TrimSpace(os.Getenv(`BLOBSTORE_INTERNAL_URL`)),
		BlobstoreToken:       strings.TrimSpace(os.Getenv(`BLOBSTORE_INTERNAL_TOKEN`)),
		CacheTTL:             15 * time.Minute,
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

func value(name string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != `` {
		return value
	}
	return fallback
}
