//go:build integration

package split

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"infinite-canvas/backend/internal/blobstore/remotefile"
	"infinite-canvas/backend/internal/migrations"
	"infinite-canvas/backend/internal/postgres"
	"infinite-canvas/backend/internal/requestcontext"
)

func TestRealPostgresAndBlobstore(t *testing.T) {
	databaseURL := os.Getenv("TEST_INTEGRATION_DATABASE_URL")
	blobstoreURL := os.Getenv("TEST_INTEGRATION_BLOBSTORE_URL")
	blobstoreToken := os.Getenv("TEST_INTEGRATION_BLOBSTORE_TOKEN")
	if databaseURL == "" || blobstoreURL == "" || blobstoreToken == "" {
		t.Skip("real integration environment is not configured")
	}
	ctx, cancel := context.WithTimeout(requestcontext.WithRequestID(context.Background(), "integration-real-request"), 45*time.Second)
	defer cancel()
	metadata, err := postgres.Open(ctx, databaseURL, postgres.DefaultPoolConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer metadata.Close()
	if err := metadata.Migrate(ctx, migrations.Initial); err != nil {
		t.Fatal(err)
	}
	objects, err := remotefile.NewClient(blobstoreURL, blobstoreToken, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := objects.Ping(ctx); err != nil {
		t.Fatal(err)
	}
	store := New(metadata, objects)
	storageKey := fmt.Sprintf("integration/%d/video.mp4", time.Now().UnixNano())
	body := []byte("integration-video-bytes")
	t.Cleanup(func() { _ = store.DeleteBlob(context.Background(), storageKey) })

	written, err := store.PutBlob(ctx, storageKey, "video/mp4", body)
	if err != nil {
		t.Fatal(err)
	}
	if written.StorageKey != storageKey || written.ContentLength != int64(len(body)) {
		t.Fatalf("unexpected written metadata: %+v", written)
	}
	record, err := metadata.GetBlobRecord(ctx, storageKey)
	if err != nil {
		t.Fatal(err)
	}
	if record.Body != nil || record.ObjectKey == "" {
		t.Fatalf("expected metadata-only row, body=%v objectKey=%q", record.Body, record.ObjectKey)
	}
	exists, err := objects.Exists(ctx, record.ObjectKey)
	if err != nil || !exists {
		t.Fatalf("physical object missing: exists=%v err=%v", exists, err)
	}
	read, err := store.GetBlob(ctx, storageKey)
	if err != nil || string(read.Body) != string(body) {
		t.Fatalf("unexpected read: %q, %v", read.Body, err)
	}
	if err := store.DeleteBlob(ctx, storageKey); err != nil {
		t.Fatal(err)
	}
	if _, err := metadata.GetBlobRecord(ctx, storageKey); err == nil {
		t.Fatal("metadata row still exists after delete")
	}
	exists, err = objects.Exists(ctx, record.ObjectKey)
	if err != nil || exists {
		t.Fatalf("physical object still exists after delete: exists=%v err=%v", exists, err)
	}
}

func TestRealRestartPersistencePhase(t *testing.T) {
	phase := os.Getenv("TEST_INTEGRATION_RESTART_PHASE")
	if phase == "" {
		t.Skip("restart persistence phase is not configured")
	}
	databaseURL := os.Getenv("TEST_INTEGRATION_DATABASE_URL")
	blobstoreURL := os.Getenv("TEST_INTEGRATION_BLOBSTORE_URL")
	blobstoreToken := os.Getenv("TEST_INTEGRATION_BLOBSTORE_TOKEN")
	if databaseURL == "" || blobstoreURL == "" || blobstoreToken == "" {
		t.Fatal("real integration environment is incomplete")
	}
	ctx, cancel := context.WithTimeout(requestcontext.WithRequestID(context.Background(), "integration-restart-request"), 30*time.Second)
	defer cancel()
	metadata, err := postgres.Open(ctx, databaseURL, postgres.DefaultPoolConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer metadata.Close()
	if err := metadata.Migrate(ctx, migrations.Initial); err != nil {
		t.Fatal(err)
	}
	objects, err := remotefile.NewClient(blobstoreURL, blobstoreToken, nil)
	if err != nil {
		t.Fatal(err)
	}
	store := New(metadata, objects)
	const storageKey = "integration/restart-persistence/video.mp4"
	const content = "restart-persistent-video"
	switch phase {
	case "write":
		_ = store.DeleteBlob(ctx, storageKey)
		if _, err := store.PutBlob(ctx, storageKey, "video/mp4", []byte(content)); err != nil {
			t.Fatal(err)
		}
	case "read-delete":
		blob, err := store.GetBlob(ctx, storageKey)
		if err != nil || string(blob.Body) != content {
			t.Fatalf("unexpected persisted blob: %q, %v", blob.Body, err)
		}
		if err := store.DeleteBlob(ctx, storageKey); err != nil {
			t.Fatal(err)
		}
	default:
		t.Fatalf("unknown restart phase: %s", phase)
	}
}

func TestRealMigrationIsIdempotent(t *testing.T) {
	databaseURL := os.Getenv("TEST_INTEGRATION_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("real integration database is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	connection, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close(ctx)
	if _, err := connection.Exec(ctx, migrations.Initial); err != nil {
		t.Fatal(err)
	}
	if _, err := connection.Exec(ctx, migrations.Initial); err != nil {
		t.Fatalf("second migration execution failed: %v", err)
	}
}
