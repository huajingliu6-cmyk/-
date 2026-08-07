package cache

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"infinite-canvas/backend/internal/postgres"
	"infinite-canvas/backend/internal/ssdb"
)

func TestDocumentsWithoutSSDBUsesNoOpCache(t *testing.T) {
	documents := NewDocuments(nil, time.Minute, "test")
	document := postgres.Document{Namespace: "test", Key: "document"}

	if _, ok := documents.Get(context.Background(), document.Namespace, document.Key); ok {
		t.Fatal("disabled cache unexpectedly returned a document")
	}
	if err := documents.Set(context.Background(), document); err != nil {
		t.Fatal(err)
	}
	if err := documents.Delete(context.Background(), document.Namespace, document.Key); err != nil {
		t.Fatal(err)
	}
}

func TestGetOrFetchSingleflight(t *testing.T) {
	address, closeServer := startCacheTestSSDB(t)
	defer closeServer()
	client := ssdb.NewWithTimeout(address, "", time.Second)
	defer client.Close()
	documents := NewDocuments(client, time.Minute, "test")

	var fetchCount atomic.Int32
	fetch := func() (postgres.Document, error) {
		fetchCount.Add(1)
		time.Sleep(50 * time.Millisecond)
		return postgres.Document{
			Namespace: "ns",
			Key:       "key",
			Revision:  1,
			Value:     []byte(`{"ok":true}`),
			UpdatedAt: time.Now().UTC(),
		}, nil
	}

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			document, _, err := documents.GetOrFetch(context.Background(), "ns", "key", fetch)
			if err != nil {
				t.Errorf("fetch failed: %v", err)
				return
			}
			if document.Key != "key" {
				t.Errorf("unexpected document key: %q", document.Key)
			}
		}()
	}
	wg.Wait()
	if fetchCount.Load() != 1 {
		t.Fatalf("expected single fetch, got %d", fetchCount.Load())
	}
}

func TestGetOrFetchNegativeCache(t *testing.T) {
	address, closeServer := startCacheTestSSDB(t)
	defer closeServer()
	client := ssdb.NewWithTimeout(address, "", time.Second)
	defer client.Close()
	documents := NewDocuments(client, time.Minute, "test")

	var fetchCount atomic.Int32
	fetch := func() (postgres.Document, error) {
		fetchCount.Add(1)
		return postgres.Document{}, postgres.ErrNotFound
	}

	ctx := context.Background()
	if _, _, err := documents.GetOrFetch(ctx, "ns", "missing", fetch); !errors.Is(err, postgres.ErrNotFound) {
		t.Fatalf("expected not found, got %v", err)
	}
	if _, _, err := documents.GetOrFetch(ctx, "ns", "missing", fetch); !errors.Is(err, postgres.ErrNotFound) {
		t.Fatalf("expected cached not found, got %v", err)
	}
	if fetchCount.Load() != 1 {
		t.Fatalf("expected single postgres fallback, got %d", fetchCount.Load())
	}
}

func startCacheTestSSDB(t *testing.T) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &cacheTestSSDB{values: map[string]string{}}
	go func() {
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			go server.handle(connection)
		}
	}()
	return listener.Addr().String(), func() { _ = listener.Close() }
}

type cacheTestSSDB struct {
	mutex  sync.Mutex
	values map[string]string
}

func (server *cacheTestSSDB) handle(connection net.Conn) {
	defer connection.Close()
	reader := bufio.NewReader(connection)
	for {
		request, err := readCacheTestSSDBRequest(reader)
		if err != nil {
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
		if err := writeCacheTestSSDBResponse(connection, response); err != nil {
			return
		}
	}
}

func readCacheTestSSDBRequest(reader *bufio.Reader) ([]string, error) {
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

func writeCacheTestSSDBResponse(writer io.Writer, values []string) error {
	for _, value := range values {
		if _, err := fmt.Fprintf(writer, "%d\n%s\n", len([]byte(value)), value); err != nil {
			return err
		}
	}
	_, err := io.WriteString(writer, "\n")
	return err
}
