//go:build integration

package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"infinite-canvas/backend/internal/blobstore"
	"infinite-canvas/backend/internal/blobstore/remotefile"
	"infinite-canvas/backend/internal/blobstore/split"
	"infinite-canvas/backend/internal/migrations"
	"infinite-canvas/backend/internal/postgres"
)

func TestRealDocumentTransactionRejectsMissingPhysicalObject(t *testing.T) {
	databaseURL := os.Getenv("TEST_INTEGRATION_DATABASE_URL")
	blobstoreURL := os.Getenv("TEST_INTEGRATION_BLOBSTORE_URL")
	blobstoreToken := os.Getenv("TEST_INTEGRATION_BLOBSTORE_TOKEN")
	if databaseURL == "" || blobstoreURL == "" || blobstoreToken == "" {
		t.Skip("real integration environment is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
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
	blobs := split.New(metadata, objects)
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	storageKey := "integration/missing-physical/" + suffix
	objectKey := "objects/missing-" + suffix
	firstKey := "integration-first-" + suffix
	secondKey := "integration-second-" + suffix
	_, _, err = metadata.PutBlobRecord(ctx, postgres.BlobRecord{
		Blob: blobstore.Blob{
			StorageKey:    storageKey,
			ContentType:   "video/mp4",
			ContentLength: 1,
			SHA256:        "00",
		},
		ObjectKey: objectKey,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = metadata.DeleteBlobRecord(context.Background(), storageKey)
		_ = metadata.DeleteDocument(context.Background(), "integration", firstKey)
		_ = metadata.DeleteDocument(context.Background(), "integration", secondKey)
	}()
	payload, err := json.Marshal(map[string]any{
		"writes": []map[string]any{
			{"namespace": "integration", "key": firstKey, "expectedRevision": 0, "value": map[string]bool{"ok": true}},
			{"namespace": "integration", "key": secondKey, "expectedRevision": 0, "value": map[string]bool{"ok": true}},
		},
		"blobChecks": []string{storageKey},
	})
	if err != nil {
		t.Fatal(err)
	}
	handler := NewDocumentTransactions(metadata, nil, blobs)
	request := httptest.NewRequest(http.MethodPost, "/v1/document-transactions", bytes.NewReader(payload))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", response.Code, response.Body.String())
	}
	if _, err := metadata.GetDocument(ctx, "integration", firstKey); err == nil {
		t.Fatal("first document was written before missing-object rejection")
	}
	if _, err := metadata.GetDocument(ctx, "integration", secondKey); err == nil {
		t.Fatal("second document was written before missing-object rejection")
	}
}
