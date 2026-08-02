package config

import "testing"

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
