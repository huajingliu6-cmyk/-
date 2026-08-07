//go:build integration

package app

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"infinite-canvas/backend/internal/config"
	"infinite-canvas/backend/internal/postgres"
)

func TestRealGoAPIBlobFlowWithProtocolSSDB(t *testing.T) {
	databaseURL := os.Getenv("TEST_INTEGRATION_DATABASE_URL")
	blobstoreURL := os.Getenv("TEST_INTEGRATION_BLOBSTORE_URL")
	blobstoreToken := os.Getenv("TEST_INTEGRATION_BLOBSTORE_TOKEN")
	if databaseURL == "" || blobstoreURL == "" || blobstoreToken == "" {
		t.Skip("real integration environment is not configured")
	}
	ssdbAddress, closeSSDB := startProtocolSSDB(t)
	defer closeSSDB()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	application, err := New(ctx, config.Config{
		ListenAddress:        "127.0.0.1:0",
		DatabaseURL:          databaseURL,
		SSDBAddress:          ssdbAddress,
		InternalToken:        "api-integration-token",
		BlobStorageDriver:    "remotefile",
		BlobstoreInternalURL: blobstoreURL,
		BlobstoreToken:       blobstoreToken,
		CacheTTL:             time.Minute,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer application.Close()
	ready := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	ready.Header.Set("X-Internal-Token", "api-integration-token")
	readyResponse := httptest.NewRecorder()
	application.Handler().ServeHTTP(readyResponse, ready)
	if readyResponse.Code != http.StatusOK {
		t.Fatalf("unexpected readiness status: %d %s", readyResponse.Code, readyResponse.Body.String())
	}
	storageKey := fmt.Sprintf("integration/api/%d/video.mp4", time.Now().UnixNano())
	path := "/v1/blobs/" + storageKey
	body := []byte("go-api-integration-video")
	put := httptest.NewRequest(http.MethodPut, path, bytes.NewReader(body))
	put.Header.Set("X-Internal-Token", "api-integration-token")
	put.Header.Set("X-Request-Id", "integration-api-request")
	put.Header.Set("Content-Type", "video/mp4")
	putResponse := httptest.NewRecorder()
	application.Handler().ServeHTTP(putResponse, put)
	if putResponse.Code != http.StatusOK {
		t.Fatalf("unexpected put status: %d %s", putResponse.Code, putResponse.Body.String())
	}
	metadata, err := postgres.Open(ctx, databaseURL, postgres.DefaultPoolConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer metadata.Close()
	record, err := metadata.GetBlobRecord(ctx, storageKey)
	if err != nil {
		t.Fatal(err)
	}
	if record.Body != nil || record.ObjectKey == "" {
		t.Fatalf("expected metadata-only Blob row, body=%v objectKey=%q", record.Body, record.ObjectKey)
	}
	get := httptest.NewRequest(http.MethodGet, path, nil)
	get.Header.Set("X-Internal-Token", "api-integration-token")
	get.Header.Set("X-Request-Id", "integration-api-request")
	getResponse := httptest.NewRecorder()
	application.Handler().ServeHTTP(getResponse, get)
	if getResponse.Code != http.StatusOK || !bytes.Equal(getResponse.Body.Bytes(), body) {
		t.Fatalf("unexpected get: %d %q", getResponse.Code, getResponse.Body.Bytes())
	}
	deleteRequest := httptest.NewRequest(http.MethodDelete, path, nil)
	deleteRequest.Header.Set("X-Internal-Token", "api-integration-token")
	deleteRequest.Header.Set("X-Request-Id", "integration-api-request")
	deleteResponse := httptest.NewRecorder()
	application.Handler().ServeHTTP(deleteResponse, deleteRequest)
	if deleteResponse.Code != http.StatusNoContent {
		t.Fatalf("unexpected delete status: %d %s", deleteResponse.Code, deleteResponse.Body.String())
	}
	if _, err := metadata.GetBlobRecord(ctx, storageKey); err == nil {
		t.Fatal("Blob metadata remains after API delete")
	}
}

func startProtocolSSDB(t *testing.T) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &protocolSSDB{values: map[string]string{}}
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			go server.handle(ctx, connection)
		}
	}()
	return listener.Addr().String(), func() {
		cancel()
		_ = listener.Close()
	}
}

type protocolSSDB struct {
	mutex  sync.Mutex
	values map[string]string
}

func (server *protocolSSDB) handle(_ context.Context, connection net.Conn) {
	defer connection.Close()
	request, err := readSSDBFrame(bufio.NewReader(connection))
	if err != nil || len(request) == 0 {
		return
	}
	response := []string{"ok"}
	server.mutex.Lock()
	switch request[0] {
	case "version":
		response = []string{"ok", "test-ssdb"}
	case "get":
		value, exists := server.values[request[1]]
		if !exists {
			response = []string{"not_found"}
		} else {
			response = []string{"ok", value}
		}
	case "set", "setx":
		server.values[request[1]] = request[2]
	case "del":
		delete(server.values, request[1])
	default:
		response = []string{"error"}
	}
	server.mutex.Unlock()
	_ = writeSSDBFrame(connection, response)
}

func readSSDBFrame(reader *bufio.Reader) ([]string, error) {
	result := []string{}
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimSpace(line)
		if line == "" {
			return result, nil
		}
		length, err := strconv.Atoi(line)
		if err != nil {
			return nil, err
		}
		payload := make([]byte, length+1)
		if _, err := io.ReadFull(reader, payload); err != nil {
			return nil, err
		}
		result = append(result, string(payload[:length]))
	}
}

func writeSSDBFrame(writer io.Writer, values []string) error {
	for _, value := range values {
		if _, err := fmt.Fprintf(writer, "%d\n%s\n", len([]byte(value)), value); err != nil {
			return err
		}
	}
	_, err := io.WriteString(writer, "\n")
	return err
}
