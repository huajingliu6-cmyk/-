package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"infinite-canvas/backend/internal/blobstore"
)

var ErrNotFound = blobstore.ErrNotFound
var ErrRevisionConflict = errors.New(`document revision conflict`)

type Document struct {
	Namespace string          `json:"namespace"`
	Key       string          `json:"key"`
	Revision  int64           `json:"revision"`
	Value     json.RawMessage `json:"value"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type DocumentWrite struct {
	Namespace        string
	Key              string
	ExpectedRevision int64
	Value            json.RawMessage
}

type BlobCopy struct {
	SourceStorageKey string
	TargetStorageKey string
}

type Store struct{ pool *pgxpool.Pool }

type AuditEvent struct {
	RequestID  string
	ActorID    string
	Action     string
	Resource   string
	StatusCode int
	Metadata   json.RawMessage
}

type Blob = blobstore.Blob

type BlobRecord struct {
	Blob
	ObjectKey string
}

func Open(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close()                         { s.pool.Close() }
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }
func (s *Store) Migrate(ctx context.Context, schema string) error {
	_, err := s.pool.Exec(ctx, schema)
	return err
}

func (s *Store) GetDocument(ctx context.Context, namespace string, key string) (Document, error) {
	var document Document
	err := s.pool.QueryRow(ctx, `
		select namespace, document_key, revision, value, updated_at
		from app_documents where namespace = $1 and document_key = $2
	`, namespace, key).Scan(&document.Namespace, &document.Key, &document.Revision, &document.Value, &document.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Document{}, ErrNotFound
	}
	return document, err
}

func (s *Store) PutDocument(ctx context.Context, namespace string, key string, expectedRevision *int64, value json.RawMessage) (Document, error) {
	var document Document
	if expectedRevision == nil {
		err := s.pool.QueryRow(ctx, `
			insert into app_documents(namespace, document_key, revision, value)
			values ($1, $2, 1, $3)
			on conflict(namespace, document_key) do update
			set revision = app_documents.revision + 1, value = excluded.value, updated_at = now()
			returning namespace, document_key, revision, value, updated_at
		`, namespace, key, value).Scan(&document.Namespace, &document.Key, &document.Revision, &document.Value, &document.UpdatedAt)
		return document, err
	}
	if *expectedRevision == 0 {
		err := s.pool.QueryRow(ctx, `
			insert into app_documents(namespace, document_key, revision, value)
			values ($1, $2, 1, $3)
			on conflict(namespace, document_key) do nothing
			returning namespace, document_key, revision, value, updated_at
		`, namespace, key, value).Scan(&document.Namespace, &document.Key, &document.Revision, &document.Value, &document.UpdatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return Document{}, ErrRevisionConflict
		}
		return document, err
	}
	command, err := s.pool.Exec(ctx, `
		update app_documents set revision = revision + 1, value = $4, updated_at = now()
		where namespace = $1 and document_key = $2 and revision = $3
	`, namespace, key, *expectedRevision, value)
	if err != nil {
		return Document{}, err
	}
	if command.RowsAffected() != 1 {
		return Document{}, ErrRevisionConflict
	}
	return s.GetDocument(ctx, namespace, key)
}

func (s *Store) PutDocumentsAtomic(ctx context.Context, writes []DocumentWrite, blobCopies []BlobCopy, blobChecks []string) ([]Document, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	documents := make([]Document, 0, len(writes))
	for _, write := range writes {
		var document Document
		if write.ExpectedRevision == 0 {
			err = tx.QueryRow(ctx, `
				insert into app_documents(namespace, document_key, revision, value)
				values ($1, $2, 1, $3)
				on conflict(namespace, document_key) do nothing
				returning namespace, document_key, revision, value, updated_at
			`, write.Namespace, write.Key, write.Value).Scan(
				&document.Namespace,
				&document.Key,
				&document.Revision,
				&document.Value,
				&document.UpdatedAt,
			)
		} else {
			err = tx.QueryRow(ctx, `
				update app_documents
				set revision = revision + 1, value = $4, updated_at = now()
				where namespace = $1 and document_key = $2 and revision = $3
				returning namespace, document_key, revision, value, updated_at
			`, write.Namespace, write.Key, write.ExpectedRevision, write.Value).Scan(
				&document.Namespace,
				&document.Key,
				&document.Revision,
				&document.Value,
				&document.UpdatedAt,
			)
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRevisionConflict
		}
		if err != nil {
			return nil, err
		}
		documents = append(documents, document)
	}
	for _, blobCopy := range blobCopies {
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, blobCopy.TargetStorageKey); err != nil {
			return nil, err
		}
		command, err := tx.Exec(ctx, `
			insert into app_blobs(storage_key, content_type, content_length, sha256, body, object_key)
			select $2, content_type, content_length, sha256, body, object_key
			from app_blobs where storage_key = $1
			on conflict(storage_key) do update
			set content_type = excluded.content_type,
				content_length = excluded.content_length,
				sha256 = excluded.sha256,
				body = excluded.body,
				object_key = excluded.object_key,
				updated_at = now()
		`, blobCopy.SourceStorageKey, blobCopy.TargetStorageKey)
		if err != nil {
			return nil, err
		}
		if command.RowsAffected() != 1 {
			return nil, ErrNotFound
		}
	}
	for _, storageKey := range blobChecks {
		var exists bool
		err := tx.QueryRow(ctx, `
			select true from app_blobs where storage_key = $1 for share
		`, storageKey).Scan(&exists)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return documents, nil
}

func (s *Store) DeleteDocument(ctx context.Context, namespace string, key string) error {
	_, err := s.pool.Exec(ctx, `delete from app_documents where namespace = $1 and document_key = $2`, namespace, key)
	return err
}

func (s *Store) WriteAuditEvent(ctx context.Context, event AuditEvent) error {
	metadata := event.Metadata
	if !json.Valid(metadata) {
		metadata = json.RawMessage(`{}`)
	}
	_, err := s.pool.Exec(ctx, `
		insert into audit_events(request_id, actor_id, action, resource, status_code, metadata)
		values ($1, nullif($2, ''), $3, $4, $5, $6)
	`, event.RequestID, event.ActorID, event.Action, event.Resource, event.StatusCode, metadata)
	return err
}

func (s *Store) GetBlob(ctx context.Context, storageKey string) (Blob, error) {
	var blob Blob
	err := s.pool.QueryRow(ctx, `
		select storage_key, content_type, content_length, sha256, body, updated_at
		from app_blobs where storage_key = $1
	`, storageKey).Scan(
		&blob.StorageKey,
		&blob.ContentType,
		&blob.ContentLength,
		&blob.SHA256,
		&blob.Body,
		&blob.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Blob{}, ErrNotFound
	}
	return blob, err
}

func (s *Store) PutBlob(ctx context.Context, storageKey string, contentType string, body []byte) (Blob, error) {
	digest := fmt.Sprintf(`%x`, sha256.Sum256(body))
	var blob Blob
	err := s.pool.QueryRow(ctx, `
		insert into app_blobs(storage_key, content_type, content_length, sha256, body)
		values ($1, $2, $3, $4, $5)
		on conflict(storage_key) do update
		set content_type = excluded.content_type,
			content_length = excluded.content_length,
			sha256 = excluded.sha256,
			body = excluded.body,
			object_key = null,
			updated_at = now()
		returning storage_key, content_type, content_length, sha256, body, updated_at
	`, storageKey, contentType, len(body), digest, body).Scan(
		&blob.StorageKey,
		&blob.ContentType,
		&blob.ContentLength,
		&blob.SHA256,
		&blob.Body,
		&blob.UpdatedAt,
	)
	return blob, err
}

func (s *Store) DeleteBlob(ctx context.Context, storageKey string) error {
	_, err := s.pool.Exec(ctx, `delete from app_blobs where storage_key = $1`, storageKey)
	return err
}

func (s *Store) BlobExists(ctx context.Context, storageKey string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `select exists(select 1 from app_blobs where storage_key = $1)`, storageKey).Scan(&exists)
	return exists, err
}

func (s *Store) GetBlobRecord(ctx context.Context, storageKey string) (BlobRecord, error) {
	var record BlobRecord
	err := s.pool.QueryRow(ctx, `
		select storage_key, content_type, content_length, sha256, body, coalesce(object_key, ''), updated_at
		from app_blobs where storage_key = $1
	`, storageKey).Scan(
		&record.StorageKey,
		&record.ContentType,
		&record.ContentLength,
		&record.SHA256,
		&record.Body,
		&record.ObjectKey,
		&record.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return BlobRecord{}, ErrNotFound
	}
	return record, err
}

func (s *Store) PutBlobRecord(ctx context.Context, record BlobRecord) (BlobRecord, string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return BlobRecord{}, "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, record.StorageKey); err != nil {
		return BlobRecord{}, "", err
	}
	var previousObjectKey string
	err = tx.QueryRow(ctx, `
		select coalesce(object_key, '') from app_blobs where storage_key = $1 for update
	`, record.StorageKey).Scan(&previousObjectKey)
	if errors.Is(err, pgx.ErrNoRows) {
		previousObjectKey = ""
	} else if err != nil {
		return BlobRecord{}, "", err
	}
	var stored BlobRecord
	err = tx.QueryRow(ctx, `
		insert into app_blobs(storage_key, content_type, content_length, sha256, body, object_key)
		values ($1, $2, $3, $4, null, $5)
		on conflict(storage_key) do update
		set content_type = excluded.content_type,
			content_length = excluded.content_length,
			sha256 = excluded.sha256,
			body = null,
			object_key = excluded.object_key,
			updated_at = now()
		returning storage_key, content_type, content_length, sha256, coalesce(object_key, ''), updated_at
	`, record.StorageKey, record.ContentType, record.ContentLength, record.SHA256, record.ObjectKey).Scan(
		&stored.StorageKey,
		&stored.ContentType,
		&stored.ContentLength,
		&stored.SHA256,
		&stored.ObjectKey,
		&stored.UpdatedAt,
	)
	if err != nil {
		return BlobRecord{}, "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return BlobRecord{}, "", err
	}
	return stored, previousObjectKey, nil
}

func (s *Store) DeleteBlobRecord(ctx context.Context, storageKey string) (BlobRecord, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return BlobRecord{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, storageKey); err != nil {
		return BlobRecord{}, err
	}
	var record BlobRecord
	err = tx.QueryRow(ctx, `
		delete from app_blobs where storage_key = $1
		returning storage_key, content_type, content_length, sha256, body, coalesce(object_key, ''), updated_at
	`, storageKey).Scan(
		&record.StorageKey,
		&record.ContentType,
		&record.ContentLength,
		&record.SHA256,
		&record.Body,
		&record.ObjectKey,
		&record.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return BlobRecord{}, ErrNotFound
	}
	if err != nil {
		return BlobRecord{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return BlobRecord{}, err
	}
	return record, nil
}

func (s *Store) BlobObjectReferenced(ctx context.Context, objectKey string) (bool, error) {
	if objectKey == "" {
		return false, nil
	}
	var exists bool
	err := s.pool.QueryRow(ctx, `
		select exists(select 1 from app_blobs where object_key = $1)
	`, objectKey).Scan(&exists)
	return exists, err
}
