package httpapi

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestTextCreditsReserveReturnsHTTP402Code(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	src, err := os.ReadFile(filepath.Join(filepath.Dir(file), "text_credits.go"))
	if err != nil {
		t.Fatalf("read text_credits.go: %v", err)
	}
	text := string(src)
	if !strings.Contains(text, `writeJSON(writer, 402, map[string]any{`) {
		t.Fatal("reserve path must write HTTP 402 on insufficient balance")
	}
	if !strings.Contains(text, `"code":  "INSUFFICIENT_CREDITS"`) {
		t.Fatal("reserve path must include code=INSUFFICIENT_CREDITS")
	}
}
