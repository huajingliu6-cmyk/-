package cache

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"time"

	"golang.org/x/sync/singleflight"

	"infinite-canvas/backend/internal/postgres"
	"infinite-canvas/backend/internal/ssdb"
)

const maxConcurrentFallbacks = 32

type Documents struct {
	client *ssdb.Client
	ttl    time.Duration
	env    string

	group       singleflight.Group
	fallbackSem chan struct{}
}

type negativeCacheEntry struct {
	Missing   bool      `json:"missing"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func NewDocuments(client *ssdb.Client, ttl time.Duration, env string) *Documents {
	if env == "" {
		env = "dev"
	}
	return &Documents{
		client:      client,
		ttl:         ttl,
		env:         env,
		fallbackSem: make(chan struct{}, maxConcurrentFallbacks),
	}
}

func (c *Documents) Get(ctx context.Context, namespace string, key string) (postgres.Document, bool) {
	if c.client == nil {
		return postgres.Document{}, false
	}
	document, hit, _ := c.readCachedDocument(ctx, namespace, key)
	return document, hit
}

func (c *Documents) GetOrFetch(
	ctx context.Context,
	namespace string,
	key string,
	fetch func() (postgres.Document, error),
) (postgres.Document, bool, error) {
	if c.client == nil {
		document, err := fetch()
		return document, false, err
	}

	if c.isNegativeCached(ctx, namespace, key) {
		return postgres.Document{}, true, postgres.ErrNotFound
	}
	if document, hit, cacheErr := c.readCachedDocument(ctx, namespace, key); hit {
		return document, true, nil
	} else if cacheErr {
		c.acquireFallback()
		defer c.releaseFallback()
	}

	singleflightKey := namespace + "\x00" + key
	result, err, _ := c.group.Do(singleflightKey, func() (any, error) {
		if c.isNegativeCached(ctx, namespace, key) {
			return postgres.Document{}, postgres.ErrNotFound
		}
		if document, hit, cacheErr := c.readCachedDocument(ctx, namespace, key); hit {
			return document, nil
		} else if cacheErr {
			c.acquireFallback()
			defer c.releaseFallback()
		}

		document, fetchErr := fetch()
		if errors.Is(fetchErr, postgres.ErrNotFound) {
			c.storeNegativeCache(ctx, namespace, key)
			return postgres.Document{}, fetchErr
		}
		if fetchErr != nil {
			return postgres.Document{}, fetchErr
		}
		_ = c.Set(ctx, document)
		return document, nil
	})
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			return postgres.Document{}, true, err
		}
		return postgres.Document{}, false, err
	}
	return result.(postgres.Document), false, nil
}

func (c *Documents) Set(ctx context.Context, document postgres.Document) error {
	if c.client == nil {
		return nil
	}
	raw, err := json.Marshal(document)
	if err != nil {
		return err
	}
	jittered := time.Duration(float64(c.ttl) * (1 + rand.Float64()*0.2))
	if err := c.client.SetWithTTL(ctx, c.cacheKey(document.Namespace, document.Key), raw, jittered); err != nil {
		return err
	}
	_ = c.client.Delete(ctx, c.missKey(document.Namespace, document.Key))
	return nil
}

func (c *Documents) Delete(ctx context.Context, namespace string, key string) error {
	if c.client == nil {
		return nil
	}
	if err := c.client.Delete(ctx, c.cacheKey(namespace, key)); err != nil && !errors.Is(err, ssdb.ErrNotFound) {
		return err
	}
	if err := c.client.Delete(ctx, c.missKey(namespace, key)); err != nil && !errors.Is(err, ssdb.ErrNotFound) {
		return err
	}
	return nil
}

func (c *Documents) readCachedDocument(ctx context.Context, namespace, key string) (postgres.Document, bool, bool) {
	raw, err := c.client.Get(ctx, c.cacheKey(namespace, key))
	if errors.Is(err, ssdb.ErrNotFound) {
		return postgres.Document{}, false, false
	}
	if err != nil {
		return postgres.Document{}, false, true
	}
	var document postgres.Document
	if json.Unmarshal(raw, &document) != nil {
		return postgres.Document{}, false, false
	}
	return document, true, false
}

func (c *Documents) isNegativeCached(ctx context.Context, namespace, key string) bool {
	raw, err := c.client.Get(ctx, c.missKey(namespace, key))
	if errors.Is(err, ssdb.ErrNotFound) {
		return false
	}
	if err != nil {
		return false
	}
	var entry negativeCacheEntry
	if json.Unmarshal(raw, &entry) != nil || !entry.Missing {
		return false
	}
	if time.Now().After(entry.ExpiresAt) {
		_ = c.client.Delete(ctx, c.missKey(namespace, key))
		return false
	}
	return true
}

func (c *Documents) storeNegativeCache(ctx context.Context, namespace, key string) {
	if c.client == nil {
		return
	}
	ttl := 15*time.Second + time.Duration(rand.Int63n(int64(15*time.Second)))
	entry := negativeCacheEntry{Missing: true, ExpiresAt: time.Now().Add(ttl)}
	raw, err := json.Marshal(entry)
	if err != nil {
		return
	}
	_ = c.client.SetWithTTL(ctx, c.missKey(namespace, key), raw, ttl)
}

func (c *Documents) cacheKey(namespace string, key string) string {
	hash := sha256.Sum256([]byte(namespace + "\x00" + key))
	return fmt.Sprintf("ic:%s:document:%s", c.env, hex.EncodeToString(hash[:]))
}

func (c *Documents) missKey(namespace string, key string) string {
	return c.cacheKey(namespace, key) + ":miss"
}

func (c *Documents) acquireFallback() {
	c.fallbackSem <- struct{}{}
}

func (c *Documents) releaseFallback() {
	<-c.fallbackSem
}
