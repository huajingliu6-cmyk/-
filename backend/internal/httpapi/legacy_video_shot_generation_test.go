package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLegacyVideoShotGenerationRejectsDeprecatedEndpoint(t *testing.T) {
	handler := NewLegacyVideoShotGeneration()
	request := httptest.NewRequest(http.MethodPost, "/v1/generate/video-shot", strings.NewReader(`{"videoShotNodeId":"shot-1"}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	var payload map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	want := "?? /api/generate/video-shot ?????? shot-1???????????? /api/generations?Provider ?????? API?video-shot ????"
	if payload["error"] != want {
		t.Fatalf("error = %q, want %q", payload["error"], want)
	}
}

func TestLegacyVideoShotGenerationRequiresNodeID(t *testing.T) {
	handler := NewLegacyVideoShotGeneration()
	request := httptest.NewRequest(http.MethodPost, "/v1/generate/video-shot", strings.NewReader(`{}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}
