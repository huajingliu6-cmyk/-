package fileserver

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestHandlerRoundTrip(t *testing.T) {
	root := t.TempDir()
	handler, err := New(root, "secret")
	if err != nil {
		t.Fatal(err)
	}
	put := httptest.NewRequest(http.MethodPut, "/v1/objects/projects/p1/video.mp4", bytes.NewReader([]byte("video")))
	put.Header.Set("X-Internal-Token", "secret")
	putResponse := httptest.NewRecorder()
	handler.ServeHTTP(putResponse, put)
	if putResponse.Code != http.StatusNoContent {
		t.Fatalf("unexpected put status: %d", putResponse.Code)
	}
	stored, err := os.ReadFile(filepath.Join(root, "projects", "p1", "video.mp4"))
	if err != nil || string(stored) != "video" {
		t.Fatalf("unexpected stored object: %q, %v", stored, err)
	}
	get := httptest.NewRequest(http.MethodGet, "/v1/objects/projects/p1/video.mp4", nil)
	get.Header.Set("X-Internal-Token", "secret")
	getResponse := httptest.NewRecorder()
	handler.ServeHTTP(getResponse, get)
	body, _ := io.ReadAll(getResponse.Result().Body)
	if getResponse.Code != http.StatusOK || string(body) != "video" {
		t.Fatalf("unexpected get: %d %q", getResponse.Code, body)
	}
	head := httptest.NewRequest(http.MethodHead, "/v1/objects/projects/p1/video.mp4", nil)
	head.Header.Set("X-Internal-Token", "secret")
	headResponse := httptest.NewRecorder()
	handler.ServeHTTP(headResponse, head)
	if headResponse.Code != http.StatusOK || headResponse.Header().Get("Content-Length") != "5" {
		t.Fatalf("unexpected head: %d %s", headResponse.Code, headResponse.Header().Get("Content-Length"))
	}
	deleteRequest := httptest.NewRequest(http.MethodDelete, "/v1/objects/projects/p1/video.mp4", nil)
	deleteRequest.Header.Set("X-Internal-Token", "secret")
	deleteResponse := httptest.NewRecorder()
	handler.ServeHTTP(deleteResponse, deleteRequest)
	if deleteResponse.Code != http.StatusNoContent {
		t.Fatalf("unexpected delete status: %d", deleteResponse.Code)
	}
}

func TestHandlerRejectsUnauthorizedAndUnsafeRequests(t *testing.T) {
	handler, err := New(t.TempDir(), "secret")
	if err != nil {
		t.Fatal(err)
	}
	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/v1/objects/a", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unexpected unauthorized status: %d", unauthorized.Code)
	}
	unsafeRequest := httptest.NewRequest(http.MethodPut, "/v1/objects/a/../b", nil)
	unsafeRequest.Header.Set("X-Internal-Token", "secret")
	unsafe := httptest.NewRecorder()
	handler.ServeHTTP(unsafe, unsafeRequest)
	if unsafe.Code != http.StatusBadRequest {
		t.Fatalf("unexpected unsafe status: %d", unsafe.Code)
	}
}

func TestHandlerHealthDoesNotRequireToken(t *testing.T) {
	handler, err := New(t.TempDir(), "secret")
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health/live", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected health status: %d", response.Code)
	}
}
