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
	"time"
)

var ErrNotFound = errors.New(`ssdb key not found`)

type Client struct {
	address  string
	password string
	timeout  time.Duration
}

func New(address string, password string) *Client {
	return &Client{address: address, password: password, timeout: 3 * time.Second}
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

func (c *Client) command(ctx context.Context, args ...string) ([]string, error) {
	dialer := net.Dialer{Timeout: c.timeout}
	connection, err := dialer.DialContext(ctx, `tcp`, c.address)
	if err != nil {
		return nil, err
	}
	defer connection.Close()
	deadline := time.Now().Add(c.timeout)
	_ = connection.SetDeadline(deadline)
	reader := bufio.NewReader(connection)
	if c.password != `` {
		if err := writeRequest(connection, []string{`auth`, c.password}); err != nil {
			return nil, err
		}
		auth, err := readResponse(reader)
		if err != nil {
			return nil, err
		}
		if len(auth) == 0 || auth[0] != `ok` {
			return nil, errors.New(`ssdb authentication failed`)
		}
	}
	if err := writeRequest(connection, args); err != nil {
		return nil, err
	}
	return readResponse(reader)
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
