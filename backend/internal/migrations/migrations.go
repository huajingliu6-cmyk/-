package migrations

import (
	"context"
	_ "embed"

	"infinite-canvas/backend/internal/postgres"
)

//go:embed 0001_remote_storage.sql
var migration0001 string

//go:embed 0002_app_blobs_object_key_idx.sql
var migration0002 string

// Initial is the first migration kept for backward compatibility.
var Initial = migration0001

// All migrations applied in order.
var All = []string{migration0001, migration0002}

func Apply(ctx context.Context, store *postgres.Store) error {
	for _, sql := range All {
		if err := store.Migrate(ctx, sql); err != nil {
			return err
		}
	}
	return nil
}
