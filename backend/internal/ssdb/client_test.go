package ssdb

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestClientConcurrentGetSet(t *testing.T) {
	address, closeServer := startFakeSSDB(t)
	defer closeServer()
	client := NewWithTimeout(address, "", 2*time.Second)
	defer client.Close()
	ctx := context.Background()

	var wg sync.WaitGroup
	for index := 0; index < 32; index++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			key := fmt.Sprintf("key-%d", i)
			value := []byte(fmt.Sprintf("value-%d", i))
			if err := client.Set(ctx, key, value); err != nil {
				t.Errorf("set failed: %v", err)
				return
			}
			got, err := client.Get(ctx, key)
			if err != nil {
				t.Errorf("get failed: %v", err)
				return
			}
			if string(got) != string(value) {
				t.Errorf("unexpected value: %q", got)
			}
		}(index)
	}
	wg.Wait()
}

func TestClientReconnectsAfterClose(t *testing.T) {
	address, closeServer := startFakeSSDB(t)
	defer closeServer()
	client := NewWithTimeout(address, "", 2*time.Second)
	defer client.Close()
	ctx := context.Background()

	if err := client.Set(ctx, "reconnect-key", []byte("one")); err != nil {
		t.Fatal(err)
	}
	client.mu.Lock()
	if client.conn != nil {
		_ = client.conn.Close()
	}
	client.closeConnLocked()
	client.mu.Unlock()

	got, err := client.Get(ctx, "reconnect-key")
	if err != nil {
		t.Fatalf("get after reconnect failed: %v", err)
	}
	if string(got) != "one" {
		t.Fatalf("unexpected value: %q", got)
	}
}

func startFakeSSDB(t *testing.T) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &fakeSSDB{values: map[string]string{}}
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

type fakeSSDB struct {
	mutex  sync.Mutex
	values map[string]string
}

func (server *fakeSSDB) handle(connection net.Conn) {
	defer connection.Close()
	reader := bufio.NewReader(connection)
	for {
		request, err := readSSDBRequest(reader)
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
		if err := writeSSDBResponse(connection, response); err != nil {
			return
		}
	}
}

func readSSDBRequest(reader *bufio.Reader) ([]string, error) {
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

func writeSSDBResponse(writer io.Writer, values []string) error {
	for _, value := range values {
		if _, err := fmt.Fprintf(writer, "%d\n%s\n", len([]byte(value)), value); err != nil {
			return err
		}
	}
	_, err := io.WriteString(writer, "\n")
	return err
}
