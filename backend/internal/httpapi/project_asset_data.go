package httpapi

import (
	"encoding/json"
	"errors"
	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
	"net/http"
	"strings"
)

var projectAssetDataNamespaces = map[string]string{"bundle": "asset-bundles", "episode-designs": "episode-asset-designs", "approvals": "asset-approvals", "asset-extraction": "asset-extraction"}

type projectAssetDataSaveInput struct {
	Value            any    `json:"value"`
	ExpectedRevision *int64 `json:"expectedRevision"`
}
type ProjectAssetData struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewProjectAssetData(s *postgres.Store, c *cache.Documents) *ProjectAssetData {
	return &ProjectAssetData{store: s, cache: c}
}
func (h *ProjectAssetData) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.get(w, r)
	case http.MethodPost:
		h.save(w, r)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}
func projectAssetNamespace(kind string) (string, bool) {
	v, ok := projectAssetDataNamespaces[kind]
	return v, ok
}
func (h *ProjectAssetData) read(r *http.Request, ns, id string) (postgres.Document, bool, error) {
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
func (h *ProjectAssetData) get(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("projectId"))
	ns, ok := projectAssetNamespace(r.URL.Query().Get("kind"))
	if id == "" || !ok {
		writeError(w, 400, "invalid project asset data request")
		return
	}
	d, found, e := h.read(r, ns, id)
	if e != nil {
		writeError(w, 500, "project asset data read failed")
		return
	}
	if !found {
		writeJSON(w, 200, map[string]any{"value": nil, "revision": 0})
		return
	}
	var value any
	if json.Unmarshal(d.Value, &value) != nil {
		writeError(w, 409, "project asset data corrupted")
		return
	}
	writeJSON(w, 200, map[string]any{"value": value, "revision": d.Revision})
}
func (h *ProjectAssetData) save(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("projectId"))
	ns, ok := projectAssetNamespace(r.URL.Query().Get("kind"))
	var in projectAssetDataSaveInput
	if decodeJSON(w, r, &in) != nil {
		return
	}
	if id == "" || !ok || in.Value == nil {
		writeError(w, 400, "invalid project asset data request")
		return
	}
	d, found, e := h.read(r, ns, id)
	if e != nil {
		writeError(w, 500, "project asset data read failed")
		return
	}
	rev := int64(0)
	if found {
		rev = d.Revision
	}
	if in.ExpectedRevision != nil {
		rev = *in.ExpectedRevision
	}
	valueObject, objectOK := in.Value.(map[string]any)
	if objectOK {
		valueObject["updatedAt"] = requestTime()
		if r.URL.Query().Get("kind") == "approvals" {
			valueObject["version"] = 1
		}
		in.Value = valueObject
	}
	value, _ := json.Marshal(in.Value)
	saved, e := h.store.PutDocument(r.Context(), ns, id, &rev, value)
	if errors.Is(e, postgres.ErrRevisionConflict) {
		if h.cache != nil {
			_ = h.cache.Delete(r.Context(), ns, id)
		}
		// Do not retry the same stale payload — callers must reload and re-merge.
		writeError(w, 409, "project asset data write conflict")
		return
	}
	if e != nil {
		writeError(w, 500, "project asset data write failed")
		return
	}
	if h.cache != nil {
		_ = h.cache.Set(r.Context(), saved)
	}
	writeJSON(w, 200, map[string]any{"value": in.Value, "revision": saved.Revision})
}
