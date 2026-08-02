package httpapi

import (
	"math"
	"net/http"
	"reflect"
	"testing"
)

func browserMetadataGeneration() map[string]any {
	return map[string]any{
		"id":                    "generation-1",
		"projectId":             "project-1",
		"shotNodeId":            "shot-1",
		"providerId":            "mock",
		"providerTaskId":        "provider-task-1",
		"status":                "completed",
		"requestSnapshot":       map[string]any{"prompt": "keep-me"},
		"requestedResolution":   "1080p",
		"providerResolution":    "720p",
		"actualWidth":           float64(720),
		"actualHeight":          float64(1280),
		"actualDurationSeconds": 5.0,
		"metadataSource":        "provider",
		"localVideoAssetId":     "asset-1",
		"resultAsset": map[string]any{
			"id":        "asset-1",
			"assetType": "generatedVideo",
			"mimeType":  "video/mp4",
		},
		"createdAt": "2026-08-02T00:00:00Z",
		"updatedAt": "2026-08-02T00:00:00Z",
	}
}

func validBrowserMetadataInput() browserVideoMetadataInput {
	return browserVideoMetadataInput{
		GenerationID:          "generation-1",
		VideoAssetID:          "asset-1",
		ActualWidth:           1080,
		ActualHeight:          1920,
		ActualDurationSeconds: 5.1234,
	}
}

func TestApplyBrowserVideoMetadataUpdatesOnlyAllowedFields(t *testing.T) {
	current := browserMetadataGeneration()
	before := make(map[string]any, len(current))
	for key, value := range current {
		before[key] = value
	}

	next, idempotent, businessErr := applyBrowserVideoMetadata(current, validBrowserMetadataInput())
	if businessErr != nil {
		t.Fatalf("unexpected error: %+v", businessErr)
	}
	if idempotent {
		t.Fatal("first update must not be idempotent")
	}
	if next["actualWidth"] != int64(1080) || next["actualHeight"] != int64(1920) {
		t.Fatalf("unexpected dimensions: %#v x %#v", next["actualWidth"], next["actualHeight"])
	}
	if next["actualDurationSeconds"] != 5.123 {
		t.Fatalf("duration = %#v, want 5.123", next["actualDurationSeconds"])
	}
	if next["metadataSource"] != "browser" {
		t.Fatalf("metadataSource = %#v", next["metadataSource"])
	}
	for key, value := range before {
		switch key {
		case "actualWidth", "actualHeight", "actualDurationSeconds", "metadataSource":
			continue
		}
		if !reflect.DeepEqual(next[key], value) {
			t.Fatalf("field %s changed: got %#v want %#v", key, next[key], value)
		}
	}
	if current["metadataSource"] != "provider" {
		t.Fatal("input record was mutated")
	}
}

func TestApplyBrowserVideoMetadataIsIdempotent(t *testing.T) {
	current := browserMetadataGeneration()
	current["actualWidth"] = float64(1080)
	current["actualHeight"] = float64(1920)
	current["actualDurationSeconds"] = 5.123
	current["metadataSource"] = "browser"

	next, idempotent, businessErr := applyBrowserVideoMetadata(current, validBrowserMetadataInput())
	if businessErr != nil || !idempotent {
		t.Fatalf("idempotent=%v error=%+v", idempotent, businessErr)
	}
	if !reflect.DeepEqual(next, current) {
		t.Fatal("idempotent response changed the record")
	}
}

func TestApplyBrowserVideoMetadataBusinessErrors(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(map[string]any, *browserVideoMetadataInput)
		status int
		code   string
	}{
		{name: "generation missing", mutate: func(record map[string]any, input *browserVideoMetadataInput) {}, status: http.StatusNotFound, code: "GENERATION_NOT_FOUND"},
		{name: "local asset mismatch", mutate: func(record map[string]any, input *browserVideoMetadataInput) { record["localVideoAssetId"] = "asset-2" }, status: http.StatusConflict, code: "ASSET_MISMATCH"},
		{name: "result asset mismatch", mutate: func(record map[string]any, input *browserVideoMetadataInput) {
			record["resultAsset"].(map[string]any)["id"] = "asset-2"
		}, status: http.StatusConflict, code: "ASSET_MISMATCH"},
		{name: "asset missing", mutate: func(record map[string]any, input *browserVideoMetadataInput) { record["resultAsset"] = nil }, status: http.StatusNotFound, code: "ASSET_NOT_FOUND"},
		{name: "wrong asset type", mutate: func(record map[string]any, input *browserVideoMetadataInput) {
			record["resultAsset"].(map[string]any)["assetType"] = "image"
		}, status: http.StatusUnsupportedMediaType, code: "NOT_GENERATED_VIDEO"},
		{name: "wrong mime", mutate: func(record map[string]any, input *browserVideoMetadataInput) {
			record["resultAsset"].(map[string]any)["mimeType"] = "video/webm"
		}, status: http.StatusUnsupportedMediaType, code: "UNSUPPORTED_MEDIA_TYPE"},
		{name: "invalid width", mutate: func(record map[string]any, input *browserVideoMetadataInput) { input.ActualWidth = 1.5 }, status: http.StatusBadRequest, code: "INVALID_WIDTH"},
		{name: "invalid height", mutate: func(record map[string]any, input *browserVideoMetadataInput) { input.ActualHeight = 0 }, status: http.StatusBadRequest, code: "INVALID_HEIGHT"},
		{name: "invalid duration", mutate: func(record map[string]any, input *browserVideoMetadataInput) {
			input.ActualDurationSeconds = math.Inf(1)
		}, status: http.StatusBadRequest, code: "INVALID_DURATION"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var current map[string]any
			if test.code != "GENERATION_NOT_FOUND" {
				current = browserMetadataGeneration()
			}
			input := validBrowserMetadataInput()
			test.mutate(current, &input)
			_, _, businessErr := applyBrowserVideoMetadata(current, input)
			if businessErr == nil {
				t.Fatal("expected business error")
			}
			if businessErr.Status != test.status || businessErr.Code != test.code {
				t.Fatalf("error = %+v, want status=%d code=%s", businessErr, test.status, test.code)
			}
		})
	}
}
