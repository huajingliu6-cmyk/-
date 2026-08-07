package httpapi

import (
	"encoding/json"
	"errors"
	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
	"net/http"
	"strings"
)

const workflowDocumentNamespace = "workflow-documents"
const workflowIndexNamespace = "workflow-index"
const workflowIndexKey = "all"
const maxWorkflowIndexAttempts = 6

type workflowIndex struct {
	Version    int      `json:"version"`
	ProjectIDs []string `json:"projectIds"`
	UpdatedAt  string   `json:"updatedAt"`
}
type workflowSaveInput struct {
	ExpectedRevision int64          `json:"expectedRevision"`
	Workflow         map[string]any `json:"workflow"`
}
type Workflows struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewWorkflows(store *postgres.Store, c *cache.Documents) *Workflows {
	return &Workflows{store: store, cache: c}
}
func (h *Workflows) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.get(w, r)
	case http.MethodPost:
		h.save(w, r)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}
func (h *Workflows) read(r *http.Request, ns, key string) (postgres.Document, bool, error) {
	if h.cache != nil {
		if d, ok := h.cache.Get(r.Context(), ns, key); ok {
			return d, true, nil
		}
	}
	d, e := h.store.GetDocument(r.Context(), ns, key)
	if errors.Is(e, postgres.ErrNotFound) {
		return postgres.Document{}, false, nil
	}
	if e == nil && h.cache != nil {
		_ = h.cache.Set(r.Context(), d)
	}
	return d, e == nil, e
}
func normalizeWorkflowIndex(i workflowIndex) workflowIndex {
	i.Version = 1
	seen := map[string]bool{}
	out := []string{}
	for _, id := range i.ProjectIDs {
		if id != "" && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	i.ProjectIDs = out
	if i.UpdatedAt == "" {
		i.UpdatedAt = requestTime()
	}
	return i
}
func (h *Workflows) readIndex(r *http.Request) (int64, workflowIndex, error) {
	d, ok, e := h.read(r, workflowIndexNamespace, workflowIndexKey)
	if e != nil {
		return 0, workflowIndex{}, e
	}
	if !ok {
		return 0, normalizeWorkflowIndex(workflowIndex{}), nil
	}
	var i workflowIndex
	if json.Unmarshal(d.Value, &i) != nil {
		return 0, workflowIndex{}, errors.New("corrupt")
	}
	return d.Revision, normalizeWorkflowIndex(i), nil
}
func (h *Workflows) get(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("projectId"))
	if id != "" {
		d, ok, e := h.read(r, workflowDocumentNamespace, id)
		if e != nil {
			writeError(w, 500, "workflow read failed")
			return
		}
		if !ok {
			writeJSON(w, 200, map[string]any{"workflow": nil, "revision": 0})
			return
		}
		var v map[string]any
		if json.Unmarshal(d.Value, &v) != nil || v["projectId"] != id {
			writeError(w, 409, "workflow corrupted")
			return
		}
		writeJSON(w, 200, map[string]any{"workflow": v, "revision": d.Revision})
		return
	}
	_, i, e := h.readIndex(r)
	if e != nil {
		writeError(w, 500, "workflow index read failed")
		return
	}
	items := []map[string]any{}
	documents, err := loadDocumentsBatch(r.Context(), h.store, h.cache, workflowDocumentNamespace, i.ProjectIDs)
	if err != nil {
		writeError(w, 500, "workflow read failed")
		return
	}
	for _, pid := range i.ProjectIDs {
		d, ok := documents[pid]
		if !ok {
			continue
		}
		var v map[string]any
		if json.Unmarshal(d.Value, &v) == nil && v["projectId"] == pid {
			items = append(items, map[string]any{"projectId": pid, "value": v, "revision": d.Revision})
		}
	}
	writeJSON(w, 200, map[string]any{"documents": items})
}
func (h *Workflows) save(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("projectId"))
	var in workflowSaveInput
	if decodeJSON(w, r, &in) != nil {
		return
	}
	if id == "" || in.ExpectedRevision < 0 || in.Workflow["projectId"] != id {
		writeError(w, 400, "invalid workflow")
		return
	}
	for a := 0; a < maxWorkflowIndexAttempts; a++ {
		ir, idx, e := h.readIndex(r)
		if e != nil {
			writeError(w, 500, "workflow index read failed")
			return
		}
		indexed := false
		for _, pid := range idx.ProjectIDs {
			if pid == id {
				indexed = true
			}
		}
		value, _ := json.Marshal(in.Workflow)
		if indexed {
			d, e := h.store.PutDocument(r.Context(), workflowDocumentNamespace, id, &in.ExpectedRevision, value)
			if errors.Is(e, postgres.ErrRevisionConflict) {
				writeError(w, 409, "workflow revision conflict")
				return
			}
			if e != nil {
				writeError(w, 500, "workflow write failed")
				return
			}
			if h.cache != nil {
				_ = h.cache.Set(r.Context(), d)
			}
			writeJSON(w, 200, map[string]any{"workflow": in.Workflow, "revision": d.Revision})
			return
		}
		idx.ProjectIDs = append(idx.ProjectIDs, id)
		idx.UpdatedAt = requestTime()
		iv, _ := json.Marshal(idx)
		ds, e := h.store.PutDocumentsAtomic(r.Context(), []postgres.DocumentWrite{{Namespace: workflowDocumentNamespace, Key: id, ExpectedRevision: in.ExpectedRevision, Value: value}, {Namespace: workflowIndexNamespace, Key: workflowIndexKey, ExpectedRevision: ir, Value: iv}}, nil, nil)
		if errors.Is(e, postgres.ErrRevisionConflict) {
			if h.cache != nil {
				_ = h.cache.Delete(r.Context(), workflowIndexNamespace, workflowIndexKey)
				_ = h.cache.Delete(r.Context(), workflowDocumentNamespace, id)
			}
			current, ok, _ := h.read(r, workflowDocumentNamespace, id)
			if ok && current.Revision != in.ExpectedRevision {
				writeError(w, 409, "workflow revision conflict")
				return
			}
			continue
		}
		if e != nil {
			writeError(w, 500, "workflow write failed")
			return
		}
		for _, d := range ds {
			if h.cache != nil {
				_ = h.cache.Set(r.Context(), d)
			}
		}
		rev := int64(1)
		for _, d := range ds {
			if d.Namespace == workflowDocumentNamespace {
				rev = d.Revision
			}
		}
		writeJSON(w, 200, map[string]any{"workflow": in.Workflow, "revision": rev})
		return
	}
	writeError(w, 409, "workflow index write conflict")
}
