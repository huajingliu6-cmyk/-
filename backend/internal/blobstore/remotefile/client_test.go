package remotefile

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/blobstore"
	"infinite-canvas/backend/internal/requestcontext"
)

func TestClientRoundTrip(t *testing.T) {
	objects := map[string][]byte{}
	tracedRequestID := ""
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/health/live" {
			writer.WriteHeader(http.StatusOK)
			return
		}
		if request.Header.Get("X-Internal-Token") != "secret" {
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		key := request.URL.Path[len("/v1/objects/"):]
		if key == "projects/p1/traced.mp4" {
			tracedRequestID = request.Header.Get("X-Request-Id")
		}
		switch request.Method {
		case http.MethodPut:
			body, _ := io.ReadAll(request.Body)
			objects[key] = body
			writer.WriteHeader(http.StatusNoContent)
		case http.MethodGet:
			body, exists := objects[key]
			if !exists {
				writer.WriteHeader(http.StatusNotFound)
				return
			}
			_, _ = writer.Write(body)
		case http.MethodHead:
			body, exists := objects[key]
			if !exists {
				writer.WriteHeader(http.StatusNotFound)
				return
			}
			writer.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
			writer.WriteHeader(http.StatusOK)
		case http.MethodDelete:
			delete(objects, key)
			writer.WriteHeader(http.StatusNoContent)
		}
	}))
	defer server.Close()

	client, err := NewClient(server.URL, "secret", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := client.Ping(ctx); err != nil {
		t.Fatal(err)
	}
	if err := client.Put(ctx, "projects/p1/video.mp4", []byte("video")); err != nil {
		t.Fatal(err)
	}
	requestContext := requestcontext.WithRequestID(ctx, "request-123")
	if err := client.Put(requestContext, "projects/p1/traced.mp4", []byte("trace")); err != nil {
		t.Fatal(err)
	}
	if tracedRequestID != "request-123" {
		t.Fatalf("request id was not forwarded: %q", tracedRequestID)
	}
	body, err := client.Get(ctx, "projects/p1/video.mp4")
	if err != nil || string(body) != "video" {
		t.Fatalf("unexpected read: %q, %v", body, err)
	}
	exists, err := client.Exists(ctx, "projects/p1/video.mp4")
	if err != nil || !exists {
		t.Fatalf("unexpected existence result: %v, %v", exists, err)
	}
	if err := client.Delete(ctx, "projects/p1/video.mp4"); err != nil {
		t.Fatal(err)
	}
	_, err = client.Get(ctx, "projects/p1/video.mp4")
	if !errors.Is(err, blobstore.ErrNotFound) {
		t.Fatalf("expected not found, got %v", err)
	}
	exists, err = client.Exists(ctx, "projects/p1/video.mp4")
	if err != nil || exists {
		t.Fatalf("unexpected deleted existence result: %v, %v", exists, err)
	}
}

func TestClientRejectsUnsafeKeys(t *testing.T) {
	client, err := NewClient("http://blobstore:8090", "secret", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"", "/root", "../secret", "a//b", "a\b"} {
		if err := client.Put(context.Background(), key, nil); err == nil {
			t.Fatalf("expected unsafe key rejection for %q", key)
		}
	}
}
