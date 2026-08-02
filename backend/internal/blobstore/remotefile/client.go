package remotefile

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"infinite-canvas/backend/internal/blobstore"
	"infinite-canvas/backend/internal/requestcontext"
)

const maxBlobSize = 256 << 20

type Client struct {
	baseURL    string
	token      string
	httpClient *http.Client
}

func (client *Client) Ping(ctx context.Context) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, client.baseURL+"/health/live", nil)
	if err != nil {
		return err
	}
	response, err := client.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("remote file health check failed: %s", response.Status)
	}
	return nil
}

func NewClient(baseURL string, token string, httpClient *http.Client) (*Client, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	token = strings.TrimSpace(token)
	if baseURL == "" || token == "" {
		return nil, errors.New("remote file store URL and token are required")
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, errors.New("invalid remote file store URL")
	}
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Client{baseURL: baseURL, token: token, httpClient: httpClient}, nil
}

func (client *Client) Get(ctx context.Context, storageKey string) ([]byte, error) {
	request, err := client.request(ctx, http.MethodGet, storageKey, nil)
	if err != nil {
		return nil, err
	}
	response, err := client.httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil, blobstore.ErrNotFound
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("remote file read failed: %s", response.Status)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxBlobSize+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxBlobSize {
		return nil, errors.New("remote file exceeds size limit")
	}
	return body, nil
}

func (client *Client) Put(ctx context.Context, storageKey string, body []byte) error {
	if len(body) > maxBlobSize {
		return errors.New("remote file exceeds size limit")
	}
	request, err := client.request(ctx, http.MethodPut, storageKey, bytes.NewReader(body))
	if err != nil {
		return err
	}
	response, err := client.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		return fmt.Errorf("remote file write failed: %s", response.Status)
	}
	return nil
}

func (client *Client) Delete(ctx context.Context, storageKey string) error {
	request, err := client.request(ctx, http.MethodDelete, storageKey, nil)
	if err != nil {
		return err
	}
	response, err := client.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		return fmt.Errorf("remote file delete failed: %s", response.Status)
	}
	return nil
}

func (client *Client) Exists(ctx context.Context, storageKey string) (bool, error) {
	request, err := client.request(ctx, http.MethodHead, storageKey, nil)
	if err != nil {
		return false, err
	}
	response, err := client.httpClient.Do(request)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if response.StatusCode != http.StatusOK {
		return false, fmt.Errorf("remote file existence check failed: %s", response.Status)
	}
	return true, nil
}

func (client *Client) request(ctx context.Context, method string, storageKey string, body io.Reader) (*http.Request, error) {
	if err := validateStorageKey(storageKey); err != nil {
		return nil, err
	}
	segments := strings.Split(storageKey, "/")
	for index, segment := range segments {
		segments[index] = url.PathEscape(segment)
	}
	request, err := http.NewRequestWithContext(ctx, method, client.baseURL+"/v1/objects/"+strings.Join(segments, "/"), body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("X-Internal-Token", client.token)
	if requestID := requestcontext.RequestID(ctx); requestID != "" {
		request.Header.Set("X-Request-Id", requestID)
	}
	return request, nil
}

func validateStorageKey(storageKey string) error {
	if storageKey == "" || strings.HasPrefix(storageKey, "/") || strings.HasSuffix(storageKey, "/") {
		return errors.New("invalid storage key")
	}
	for _, segment := range strings.Split(storageKey, "/") {
		if segment == "" || segment == "." || segment == ".." || strings.Contains(segment, "\\") {
			return errors.New("invalid storage key")
		}
	}
	return nil
}
