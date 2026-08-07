package migrations

import "testing"

func TestAllMigrationsPresent(t *testing.T) {
	if len(All) != 2 {
		t.Fatalf("expected 2 migrations, got %d", len(All))
	}
	if All[0] == "" || All[1] == "" {
		t.Fatal("migration SQL must not be empty")
	}
	if All[1] != "create index if not exists app_blobs_object_key_idx on app_blobs(object_key) where object_key is not null;\n" {
		t.Fatalf("unexpected second migration: %q", All[1])
	}
}
