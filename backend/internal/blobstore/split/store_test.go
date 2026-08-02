package split

import (
	"context"
	"errors"
	"testing"

	"infinite-canvas/backend/internal/blobstore"
	"infinite-canvas/backend/internal/postgres"
)

type fakeMetadata struct {
	records map[string]postgres.BlobRecord
	putErr  error
}

func (metadata *fakeMetadata) GetBlobRecord(_ context.Context, storageKey string) (postgres.BlobRecord, error) {
	record, exists := metadata.records[storageKey]
	if !exists {
		return postgres.BlobRecord{}, blobstore.ErrNotFound
	}
	return record, nil
}

func (metadata *fakeMetadata) PutBlobRecord(_ context.Context, record postgres.BlobRecord) (postgres.BlobRecord, string, error) {
	if metadata.putErr != nil {
		return postgres.BlobRecord{}, "", metadata.putErr
	}
	previous := metadata.records[record.StorageKey].ObjectKey
	metadata.records[record.StorageKey] = record
	return record, previous, nil
}

func (metadata *fakeMetadata) DeleteBlobRecord(_ context.Context, storageKey string) (postgres.BlobRecord, error) {
	record, exists := metadata.records[storageKey]
	if !exists {
		return postgres.BlobRecord{}, blobstore.ErrNotFound
	}
	delete(metadata.records, storageKey)
	return record, nil
}

func (metadata *fakeMetadata) BlobObjectReferenced(_ context.Context, objectKey string) (bool, error) {
	for _, record := range metadata.records {
		if record.ObjectKey == objectKey {
			return true, nil
		}
	}
	return false, nil
}

type fakeObjects struct {
	objects map[string][]byte
	deleted []string
}

func (objects *fakeObjects) Get(_ context.Context, storageKey string) ([]byte, error) {
	body, exists := objects.objects[storageKey]
	if !exists {
		return nil, blobstore.ErrNotFound
	}
	return append([]byte(nil), body...), nil
}

func (objects *fakeObjects) Put(_ context.Context, storageKey string, body []byte) error {
	objects.objects[storageKey] = append([]byte(nil), body...)
	return nil
}

func (objects *fakeObjects) Delete(_ context.Context, storageKey string) error {
	delete(objects.objects, storageKey)
	objects.deleted = append(objects.deleted, storageKey)
	return nil
}

func (objects *fakeObjects) Exists(_ context.Context, storageKey string) (bool, error) {
	_, exists := objects.objects[storageKey]
	return exists, nil
}

func TestGetBlobSupportsLegacyDatabaseBody(t *testing.T) {
	metadata := &fakeMetadata{records: map[string]postgres.BlobRecord{
		"legacy": {Blob: blobstore.Blob{StorageKey: "legacy", ContentType: "video/mp4", ContentLength: 6, SHA256: digest([]byte("legacy")), Body: []byte("legacy")}},
	}}
	store := New(metadata, &fakeObjects{objects: map[string][]byte{}})
	blob, err := store.GetBlob(context.Background(), "legacy")
	if err != nil || string(blob.Body) != "legacy" {
		t.Fatalf("unexpected legacy blob: %q, %v", blob.Body, err)
	}
}

func TestGetBlobRejectsCorruptObject(t *testing.T) {
	metadata := &fakeMetadata{records: map[string]postgres.BlobRecord{
		"video": {Blob: blobstore.Blob{StorageKey: "video", ContentLength: 5, SHA256: digest([]byte("video"))}, ObjectKey: "objects/one"},
	}}
	store := New(metadata, &fakeObjects{objects: map[string][]byte{"objects/one": []byte("wrong")}})
	if _, err := store.GetBlob(context.Background(), "video"); err == nil {
		t.Fatal("expected integrity failure")
	}
}

func TestPutBlobDeletesNewObjectWhenMetadataWriteFails(t *testing.T) {
	metadata := &fakeMetadata{records: map[string]postgres.BlobRecord{}, putErr: errors.New("database unavailable")}
	objects := &fakeObjects{objects: map[string][]byte{}}
	store := New(metadata, objects)
	if _, err := store.PutBlob(context.Background(), "video", "video/mp4", []byte("video")); err == nil {
		t.Fatal("expected metadata failure")
	}
	if len(objects.objects) != 0 || len(objects.deleted) != 1 {
		t.Fatalf("expected compensating delete, objects=%d deleted=%d", len(objects.objects), len(objects.deleted))
	}
}

func TestDeleteBlobPreservesSharedObject(t *testing.T) {
	metadata := &fakeMetadata{records: map[string]postgres.BlobRecord{
		"source": {Blob: blobstore.Blob{StorageKey: "source"}, ObjectKey: "objects/shared"},
		"target": {Blob: blobstore.Blob{StorageKey: "target"}, ObjectKey: "objects/shared"},
	}}
	objects := &fakeObjects{objects: map[string][]byte{"objects/shared": []byte("video")}}
	store := New(metadata, objects)
	if err := store.DeleteBlob(context.Background(), "source"); err != nil {
		t.Fatal(err)
	}
	if _, exists := objects.objects["objects/shared"]; !exists {
		t.Fatal("shared object was deleted")
	}
	if err := store.DeleteBlob(context.Background(), "target"); err != nil {
		t.Fatal(err)
	}
	if _, exists := objects.objects["objects/shared"]; exists {
		t.Fatal("unreferenced object was not deleted")
	}
}
