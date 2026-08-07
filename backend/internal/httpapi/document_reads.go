package httpapi

import (
	"context"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

func loadDocumentsBatch(
	ctx context.Context,
	store *postgres.Store,
	documentCache *cache.Documents,
	namespace string,
	keys []string,
) (map[string]postgres.Document, error) {
	result := make(map[string]postgres.Document, len(keys))
	misses := make([]postgres.DocumentKey, 0, len(keys))
	for _, key := range keys {
		if documentCache != nil {
			if document, ok := documentCache.Get(ctx, namespace, key); ok {
				result[key] = document
				continue
			}
		}
		misses = append(misses, postgres.DocumentKey{Namespace: namespace, Key: key})
	}
	if len(misses) == 0 {
		return result, nil
	}
	fetched, err := store.GetDocuments(ctx, misses)
	if err != nil {
		return nil, err
	}
	for _, pair := range misses {
		document, ok := fetched[postgres.DocumentMapKey(pair.Namespace, pair.Key)]
		if !ok {
			continue
		}
		result[pair.Key] = document
		if documentCache != nil {
			_ = documentCache.Set(ctx, document)
		}
	}
	return result, nil
}
