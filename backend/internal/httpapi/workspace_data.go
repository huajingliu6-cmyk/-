package httpapi

import (
	"encoding/json"
	"errors"
	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
	"net/http"
	"strings"
)

var workspaceDataNamespaces = map[string]string{"snapshot": "workspace-snapshots", "assets": "workspace-assets", "episode-designs": "workspace-episode-asset-designs"}

type workspaceDataSaveInput struct {
	Value            any    `json:"value"`
	ExpectedRevision *int64 `json:"expectedRevision"`
}
type WorkspaceData struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewWorkspaceData(s *postgres.Store, c *cache.Documents) *WorkspaceData {
	return &WorkspaceData{store: s, cache: c}
}
func (h *WorkspaceData) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.get(w, r)
	case http.MethodPost:
		h.save(w, r)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}
func workspaceNamespace(kind string) (string, bool) {
	v, ok := workspaceDataNamespaces[kind]
	return v, ok
}
func (h *WorkspaceData) read(r *http.Request, ns, id string) (postgres.Document, bool, error) {
	if h.cache != nil {
		if d, ok := h.cache.Get(r.Context(), ns, id); ok {
			return d, true, nil
		}
	}
	d, e := h.store.GetDocument(r.Context(), ns, id)
	if errors.Is(e, postgres.ErrNotFound) {
		return postgres.Document{}, false, nil
	}
	if e == nil && h.cache != nil {
		_ = h.cache.Set(r.Context(), d)
	}
	return d, e == nil, e
}
func (h *WorkspaceData) get(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("projectId"))
	ns, ok := workspaceNamespace(r.URL.Query().Get("kind"))
	if id == "" || !ok {
		writeError(w, 400, "invalid workspace data request")
		return
	}
	d, found, e := h.read(r, ns, id)
	if e != nil {
		writeError(w, 500, "workspace data read failed")
		return
	}
	if !found {
		writeJSON(w, 200, map[string]any{"value": nil, "revision": 0})
		return
	}
	var value any
	if json.Unmarshal(d.Value, &value) != nil {
		writeError(w, 409, "workspace data corrupted")
		return
	}
	writeJSON(w, 200, map[string]any{"value": value, "revision": d.Revision})
}
func (h *WorkspaceData) save(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("projectId"))
	ns, ok := workspaceNamespace(r.URL.Query().Get("kind"))
	var in workspaceDataSaveInput
	if decodeJSON(w, r, &in) != nil {
		return
	}
	if id == "" || !ok || in.Value == nil {
		writeError(w, 400, "invalid workspace data request")
		return
	}
	d, found, e := h.read(r, ns, id)
	if e != nil {
		writeError(w, 500, "workspace data read failed")
		return
	}
	rev := int64(0)
	if found {
		rev = d.Revision
	}
	if in.ExpectedRevision != nil {
		rev = *in.ExpectedRevision
	}
	value, _ := json.Marshal(in.Value)
	saved, e := h.store.PutDocument(r.Context(), ns, id, &rev, value)
	if errors.Is(e, postgres.ErrRevisionConflict) {
		if h.cache != nil {
			_ = h.cache.Delete(r.Context(), ns, id)
		}
		writeError(w, 409, "workspace data write conflict")
		return
	}
	if e != nil {
		writeError(w, 500, "workspace data write failed")
		return
	}
	if h.cache != nil {
		_ = h.cache.Set(r.Context(), saved)
	}
	writeJSON(w, 200, map[string]any{"value": in.Value, "revision": saved.Revision})
}
