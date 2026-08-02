package blobstore

import (
	"context"
	"errors"
	"time"
)

var ErrNotFound = errors.New("blob not found")

type Blob struct {
	StorageKey    string
	ContentType   string
	ContentLength int64
	SHA256        string
	Body          []byte
	UpdatedAt     time.Time
}

type Store interface {
	GetBlob(ctx context.Context, storageKey string) (Blob, error)
	PutBlob(ctx context.Context, storageKey string, contentType string, body []byte) (Blob, error)
	DeleteBlob(ctx context.Context, storageKey string) error
	BlobExists(ctx context.Context, storageKey string) (bool, error)
}

type ObjectStore interface {
	Get(ctx context.Context, storageKey string) ([]byte, error)
	Put(ctx context.Context, storageKey string, body []byte) error
	Delete(ctx context.Context, storageKey string) error
	Exists(ctx context.Context, storageKey string) (bool, error)
}
