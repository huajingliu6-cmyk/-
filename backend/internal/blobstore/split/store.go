package split

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"

	"infinite-canvas/backend/internal/blobstore"
	"infinite-canvas/backend/internal/postgres"
)

type Store struct {
	metadata metadataStore
	objects  blobstore.ObjectStore
}

type metadataStore interface {
	GetBlobRecord(ctx context.Context, storageKey string) (postgres.BlobRecord, error)
	PutBlobRecord(ctx context.Context, record postgres.BlobRecord) (postgres.BlobRecord, string, error)
	DeleteBlobRecord(ctx context.Context, storageKey string) (postgres.BlobRecord, error)
	BlobObjectReferenced(ctx context.Context, objectKey string) (bool, error)
}

func New(metadata metadataStore, objects blobstore.ObjectStore) *Store {
	return &Store{metadata: metadata, objects: objects}
}

func (store *Store) GetBlob(ctx context.Context, storageKey string) (blobstore.Blob, error) {
	record, err := store.metadata.GetBlobRecord(ctx, storageKey)
	if err != nil {
		return blobstore.Blob{}, err
	}
	if record.ObjectKey == "" {
		return record.Blob, nil
	}
	body, err := store.objects.Get(ctx, record.ObjectKey)
	if err != nil {
		return blobstore.Blob{}, err
	}
	if int64(len(body)) != record.ContentLength || digest(body) != record.SHA256 {
		return blobstore.Blob{}, errors.New("blob object integrity check failed")
	}
	record.Body = body
	return record.Blob, nil
}

func (store *Store) PutBlob(ctx context.Context, storageKey string, contentType string, body []byte) (blobstore.Blob, error) {
	objectKey, err := newObjectKey()
	if err != nil {
		return blobstore.Blob{}, err
	}
	if err := store.objects.Put(ctx, objectKey, body); err != nil {
		return blobstore.Blob{}, err
	}
	record, previousObjectKey, err := store.metadata.PutBlobRecord(ctx, postgres.BlobRecord{
		Blob: blobstore.Blob{
			StorageKey:    storageKey,
			ContentType:   contentType,
			ContentLength: int64(len(body)),
			SHA256:        digest(body),
		},
		ObjectKey: objectKey,
	})
	if err != nil {
		_ = store.objects.Delete(ctx, objectKey)
		return blobstore.Blob{}, err
	}
	if previousObjectKey != "" && previousObjectKey != objectKey {
		store.deleteUnreferencedObject(ctx, previousObjectKey)
	}
	record.Body = body
	return record.Blob, nil
}

func (store *Store) DeleteBlob(ctx context.Context, storageKey string) error {
	record, err := store.metadata.DeleteBlobRecord(ctx, storageKey)
	if errors.Is(err, blobstore.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if record.ObjectKey != "" {
		store.deleteUnreferencedObject(ctx, record.ObjectKey)
	}
	return nil
}

func (store *Store) BlobExists(ctx context.Context, storageKey string) (bool, error) {
	record, err := store.metadata.GetBlobRecord(ctx, storageKey)
	if errors.Is(err, blobstore.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if record.ObjectKey == "" {
		return record.Body != nil, nil
	}
	return store.objects.Exists(ctx, record.ObjectKey)
}

func (store *Store) deleteUnreferencedObject(ctx context.Context, objectKey string) {
	referenced, err := store.metadata.BlobObjectReferenced(ctx, objectKey)
	if err == nil && !referenced {
		_ = store.objects.Delete(ctx, objectKey)
	}
}

func digest(body []byte) string {
	return fmt.Sprintf("%x", sha256.Sum256(body))
}

func newObjectKey() (string, error) {
	buffer := make([]byte, 24)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return "objects/" + hex.EncodeToString(buffer), nil
}
