package cache

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"infinite-canvas/backend/internal/postgres"
	"infinite-canvas/backend/internal/ssdb"
)

type Documents struct {
	client *ssdb.Client
	ttl    time.Duration
}

func NewDocuments(client *ssdb.Client, ttl time.Duration) *Documents {
	return &Documents{client: client, ttl: ttl}
}

func (c *Documents) Get(ctx context.Context, namespace string, key string) (postgres.Document, bool) {
	if c.client == nil {
		return postgres.Document{}, false
	}
	raw, err := c.client.Get(ctx, cacheKey(namespace, key))
	if err != nil {
		return postgres.Document{}, false
	}
	var document postgres.Document
	if json.Unmarshal(raw, &document) != nil {
		return postgres.Document{}, false
	}
	return document, true
}

func (c *Documents) Set(ctx context.Context, document postgres.Document) error {
	if c.client == nil {
		return nil
	}
	raw, err := json.Marshal(document)
	if err != nil {
		return err
	}
	return c.client.SetWithTTL(ctx, cacheKey(document.Namespace, document.Key), raw, c.ttl)
}

func (c *Documents) Delete(ctx context.Context, namespace string, key string) error {
	if c.client == nil {
		return nil
	}
	err := c.client.Delete(ctx, cacheKey(namespace, key))
	if errors.Is(err, ssdb.ErrNotFound) {
		return nil
	}
	return err
}

func cacheKey(namespace string, key string) string {
	hash := sha256.Sum256([]byte(namespace + `\x00` + key))
	return `ic:document:` + hex.EncodeToString(hash[:])
}
