package ssdb

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
	"time"
)

var ErrNotFound = errors.New(`ssdb key not found`)

type Client struct {
	address  string
	password string
	timeout  time.Duration

	mu            sync.Mutex
	conn          net.Conn
	reader        *bufio.Reader
	authenticated bool
}

func New(address string, password string) *Client {
	return NewWithTimeout(address, password, 500*time.Millisecond)
}

func NewWithTimeout(address string, password string, timeout time.Duration) *Client {
	return &Client{address: address, password: password, timeout: timeout}
}

func (c *Client) Ping(ctx context.Context) error {
	response, err := c.command(ctx, `version`)
	if err != nil {
		return err
	}
	if len(response) == 0 || response[0] != `ok` {
		return fmt.Errorf(`ssdb ping failed: %v`, response)
	}
	return nil
}

func (c *Client) Get(ctx context.Context, key string) ([]byte, error) {
	response, err := c.command(ctx, `get`, key)
	if err != nil {
		return nil, err
	}
	if len(response) > 0 && response[0] == `not_found` {
		return nil, ErrNotFound
	}
	if len(response) < 2 || response[0] != `ok` {
		return nil, fmt.Errorf(`ssdb get failed: %v`, response)
	}
	return []byte(response[1]), nil
}

func (c *Client) Set(ctx context.Context, key string, value []byte) error {
	response, err := c.command(ctx, `set`, key, string(value))
	if err != nil {
		return err
	}
	if len(response) == 0 || response[0] != `ok` {
		return fmt.Errorf(`ssdb set failed: %v`, response)
	}
	return nil
}

func (c *Client) SetWithTTL(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	seconds := int64(ttl / time.Second)
	if seconds < 1 {
		return c.Set(ctx, key, value)
	}
	response, err := c.command(ctx, `setx`, key, string(value), strconv.FormatInt(seconds, 10))
	if err != nil {
		return err
	}
	if len(response) == 0 || response[0] != `ok` {
		return fmt.Errorf(`ssdb setx failed: %v`, response)
	}
	return nil
}

func (c *Client) Delete(ctx context.Context, key string) error {
	response, err := c.command(ctx, `del`, key)
	if err != nil {
		return err
	}
	if len(response) == 0 || response[0] != `ok` {
		return fmt.Errorf(`ssdb del failed: %v`, response)
	}
	return nil
}

func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closeConnLocked()
	return nil
}

func (c *Client) closeConnLocked() {
	if c.conn != nil {
		_ = c.conn.Close()
	}
	c.conn = nil
	c.reader = nil
	c.authenticated = false
}

func (c *Client) ensureConn(ctx context.Context) error {
	if c.conn != nil {
		return nil
	}
	dialer := net.Dialer{Timeout: c.timeout}
	connection, err := dialer.DialContext(ctx, `tcp`, c.address)
	if err != nil {
		return err
	}
	c.conn = connection
	c.reader = bufio.NewReader(connection)
	c.authenticated = false
	return nil
}

func (c *Client) authenticateLocked(ctx context.Context) error {
	if c.password == `` || c.authenticated {
		return nil
	}
	deadline := time.Now().Add(c.timeout)
	_ = c.conn.SetDeadline(deadline)
	if err := writeRequest(c.conn, []string{`auth`, c.password}); err != nil {
		return err
	}
	auth, err := readResponse(c.reader)
	if err != nil {
		return err
	}
	if len(auth) == 0 || auth[0] != `ok` {
		return errors.New(`ssdb authentication failed`)
	}
	c.authenticated = true
	return nil
}

func (c *Client) command(ctx context.Context, args ...string) ([]string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		if err := c.ensureConn(ctx); err != nil {
			lastErr = err
			c.closeConnLocked()
			continue
		}
		deadline := time.Now().Add(c.timeout)
		_ = c.conn.SetDeadline(deadline)
		if err := c.authenticateLocked(ctx); err != nil {
			lastErr = err
			c.closeConnLocked()
			continue
		}
		if err := writeRequest(c.conn, args); err != nil {
			lastErr = err
			c.closeConnLocked()
			continue
		}
		response, err := readResponse(c.reader)
		if err != nil {
			lastErr = err
			c.closeConnLocked()
			continue
		}
		return response, nil
	}
	if lastErr == nil {
		lastErr = errors.New(`ssdb command failed`)
	}
	return nil, lastErr
}

func writeRequest(writer io.Writer, args []string) error {
	for _, arg := range args {
		if _, err := io.WriteString(writer, strconv.Itoa(len([]byte(arg)))); err != nil {
			return err
		}
		if _, err := writer.Write([]byte{'\n'}); err != nil {
			return err
		}
		if _, err := io.WriteString(writer, arg); err != nil {
			return err
		}
		if _, err := writer.Write([]byte{'\n'}); err != nil {
			return err
		}
	}
	_, err := writer.Write([]byte{'\n'})
	return err
}

func readResponse(reader *bufio.Reader) ([]string, error) {
	response := make([]string, 0, 4)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimSpace(line)
		if line == `` {
			return response, nil
		}
		length, err := strconv.Atoi(line)
		if err != nil || length < 0 {
			return nil, fmt.Errorf(`invalid ssdb frame length: %q`, line)
		}
		payload := make([]byte, length+1)
		if _, err := io.ReadFull(reader, payload); err != nil {
			return nil, err
		}
		if payload[length] != '\n' {
			return nil, errors.New(`invalid ssdb frame terminator`)
		}
		response = append(response, string(payload[:length]))
	}
}
