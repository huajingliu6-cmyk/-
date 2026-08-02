package httpapi

import (
	"net/http"
	"strings"
)

type legacyVideoShotGenerationRequest struct {
	VideoShotNodeID string `json:"videoShotNodeId"`
}

type LegacyVideoShotGeneration struct{}

func NewLegacyVideoShotGeneration() *LegacyVideoShotGeneration {
	return &LegacyVideoShotGeneration{}
}

func (handler *LegacyVideoShotGeneration) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		methodNotAllowed(writer, http.MethodPost)
		return
	}
	var input legacyVideoShotGenerationRequest
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	nodeID := strings.TrimSpace(input.VideoShotNodeID)
	if nodeID == "" {
		writeError(writer, http.StatusBadRequest, "videoShotNodeId is required")
		return
	}
	writeError(
		writer,
		http.StatusInternalServerError,
		"?? /api/generate/video-shot ?????? "+nodeID+"???????????? /api/generations?Provider ?????? API?video-shot ????",
	)
}
