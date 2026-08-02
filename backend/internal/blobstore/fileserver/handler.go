package fileserver

import (
	"crypto/subtle"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const maxObjectSize = 256 << 20

type Handler struct {
	root  string
	token string
}

func New(root string, token string) (*Handler, error) {
	root = strings.TrimSpace(root)
	token = strings.TrimSpace(token)
	if root == "" || token == "" {
		return nil, errors.New("file store root and token are required")
	}
	resolvedRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(resolvedRoot, 0o750); err != nil {
		return nil, err
	}
	return &Handler{root: resolvedRoot, token: token}, nil
}

func (handler *Handler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if request.URL.Path == "/health/live" {
		if request.Method != http.MethodGet {
			writer.Header().Set("Allow", "GET")
			http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		writer.WriteHeader(http.StatusOK)
		return
	}
	if !validToken(request.Header.Get("X-Internal-Token"), handler.token) {
		http.Error(writer, "unauthorized", http.StatusUnauthorized)
		return
	}
	storageKey := strings.TrimPrefix(request.URL.Path, "/v1/objects/")
	path, err := handler.resolve(storageKey)
	if err != nil {
		http.Error(writer, "invalid storage key", http.StatusBadRequest)
		return
	}
	switch request.Method {
	case http.MethodGet:
		handler.get(writer, path)
	case http.MethodHead:
		handler.head(writer, path)
	case http.MethodPut:
		handler.put(writer, request, path)
	case http.MethodDelete:
		handler.delete(writer, path)
	default:
		writer.Header().Set("Allow", "GET, HEAD, PUT, DELETE")
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (handler *Handler) head(writer http.ResponseWriter, path string) {
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		http.Error(writer, "not found", http.StatusNotFound)
		return
	}
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxObjectSize {
		http.Error(writer, "invalid object", http.StatusInternalServerError)
		return
	}
	writer.Header().Set("Content-Length", stringValue(info.Size()))
	writer.WriteHeader(http.StatusOK)
}

func (handler *Handler) get(writer http.ResponseWriter, path string) {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		http.Error(writer, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(writer, "read failed", http.StatusInternalServerError)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxObjectSize {
		http.Error(writer, "invalid object", http.StatusInternalServerError)
		return
	}
	writer.Header().Set("Content-Type", "application/octet-stream")
	writer.Header().Set("Cache-Control", "private, no-store")
	writer.Header().Set("Content-Length", stringValue(info.Size()))
	_, _ = io.Copy(writer, file)
}

func (handler *Handler) put(writer http.ResponseWriter, request *http.Request, path string) {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		http.Error(writer, "write failed", http.StatusInternalServerError)
		return
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".upload-*")
	if err != nil {
		http.Error(writer, "write failed", http.StatusInternalServerError)
		return
	}
	temporaryPath := temporary.Name()
	committed := false
	defer func() {
		_ = temporary.Close()
		if !committed {
			_ = os.Remove(temporaryPath)
		}
	}()
	written, err := io.Copy(temporary, io.LimitReader(request.Body, maxObjectSize+1))
	if err != nil || written > maxObjectSize || temporary.Sync() != nil || temporary.Close() != nil {
		http.Error(writer, "write failed", http.StatusRequestEntityTooLarge)
		return
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		http.Error(writer, "write failed", http.StatusInternalServerError)
		return
	}
	committed = true
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) delete(writer http.ResponseWriter, path string) {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		http.Error(writer, "delete failed", http.StatusInternalServerError)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) resolve(storageKey string) (string, error) {
	if storageKey == "" || strings.HasPrefix(storageKey, "/") || strings.HasSuffix(storageKey, "/") {
		return "", errors.New("invalid storage key")
	}
	segments := strings.Split(storageKey, "/")
	for _, segment := range segments {
		if segment == "" || segment == "." || segment == ".." || strings.Contains(segment, "\\") {
			return "", errors.New("invalid storage key")
		}
	}
	resolved := filepath.Join(append([]string{handler.root}, segments...)...)
	relative, err := filepath.Rel(handler.root, resolved)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", errors.New("invalid storage key")
	}
	return resolved, nil
}

func validToken(candidate string, expected string) bool {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" || len(candidate) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(candidate), []byte(expected)) == 1
}

func stringValue(value int64) string {
	if value == 0 {
		return "0"
	}
	buffer := make([]byte, 0, 20)
	for value > 0 {
		buffer = append(buffer, byte('0'+value%10))
		value /= 10
	}
	for left, right := 0, len(buffer)-1; left < right; left, right = left+1, right-1 {
		buffer[left], buffer[right] = buffer[right], buffer[left]
	}
	return string(buffer)
}
