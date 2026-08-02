package cache

import (
	"context"
	"testing"
	"time"

	"infinite-canvas/backend/internal/postgres"
)

func TestDocumentsWithoutSSDBUsesNoOpCache(t *testing.T) {
	documents := NewDocuments(nil, time.Minute)
	document := postgres.Document{Namespace: "test", Key: "document"}

	if _, ok := documents.Get(context.Background(), document.Namespace, document.Key); ok {
		t.Fatal("disabled cache unexpectedly returned a document")
	}
	if err := documents.Set(context.Background(), document); err != nil {
		t.Fatal(err)
	}
	if err := documents.Delete(context.Background(), document.Namespace, document.Key); err != nil {
		t.Fatal(err)
	}
}
