package migrations

import (
	"strings"
	"testing"
)

func TestAllMigrationsPresent(t *testing.T) {
	if len(All) != 3 {
		t.Fatalf("expected 3 migrations, got %d", len(All))
	}
	if All[0] == "" || All[1] == "" || All[2] == "" {
		t.Fatal("migration SQL must not be empty")
	}
	if strings.TrimSpace(All[1]) != "create index if not exists app_blobs_object_key_idx on app_blobs(object_key) where object_key is not null;" {
		t.Fatalf("unexpected second migration: %q", All[1])
	}
	if !strings.Contains(All[2], "episode-asset-designs") || !strings.Contains(All[2], "imageFileName") {
		t.Fatal("third migration must backfill confirmed asset image metadata")
	}
}
