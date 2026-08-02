package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

const taskRuleNamespace = "ai-task-rules"
const maxTaskRuleChars = 256 * 1024

type taskRuleDraft struct {
	Content        string  `json:"content"`
	SourceType     string  `json:"sourceType"`
	SourceFileName *string `json:"sourceFileName"`
	Revision       int     `json:"revision"`
	UpdatedBy      string  `json:"updatedBy"`
	UpdatedAt      string  `json:"updatedAt"`
}

type taskRuleVersion struct {
	Version               int     `json:"version"`
	Content               string  `json:"content"`
	ContentHash           string  `json:"contentHash"`
	SourceType            string  `json:"sourceType"`
	SourceFileName        *string `json:"sourceFileName"`
	PublishedBy           string  `json:"publishedBy"`
	PublishedAt           string  `json:"publishedAt"`
	RolledBackFromVersion *int    `json:"rolledBackFromVersion"`
}

type taskRuleRecord struct {
	CapabilityID               string            `json:"capabilityId"`
	Draft                      *taskRuleDraft    `json:"draft"`
	PublishedVersion           *int              `json:"publishedVersion"`
	Versions                   []taskRuleVersion `json:"versions"`
	LastPublishIdempotencyKey  *string           `json:"lastPublishIdempotencyKey,omitempty"`
	LastRollbackIdempotencyKey *string           `json:"lastRollbackIdempotencyKey,omitempty"`
}

type AiTaskRules struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewAiTaskRules(store *postgres.Store, documentCache *cache.Documents) *AiTaskRules {
	return &AiTaskRules{store: store, cache: documentCache}
}

var taskRuleCapabilities = []string{
	"story.generate", "script.outline.generate", "script.episodes.generate", "script.split.generate", "script.continue.generate",
	"asset.episode-design.generate", "asset.design-prompt.generate", "text.storyboard-prompt.generate", "image.character.generate",
	"audio.character-voice.generate", "image.scene.generate", "image.prop.generate", "video.storyboard-shot.generate",
	"video.storyboard-episode.generate", "video.workflow-node.generate", "video.reference-image.precheck",
}

func validTaskRuleCapability(value string) bool {
	for _, capability := range taskRuleCapabilities {
		if value == capability {
			return true
		}
	}
	return false
}

func emptyTaskRuleRecord(capabilityID string) taskRuleRecord {
	return taskRuleRecord{CapabilityID: capabilityID, Versions: []taskRuleVersion{}}
}

func taskRuleHash(content string) string {
	value := sha256.Sum256([]byte(content))
	return hex.EncodeToString(value[:])
}

func normalizeTaskRuleRecord(record taskRuleRecord, capabilityID string) (taskRuleRecord, error) {
	if record.CapabilityID != capabilityID {
		return taskRuleRecord{}, errors.New("capability mismatch")
	}
	if record.Versions == nil {
		record.Versions = []taskRuleVersion{}
	}
	seen := map[int]bool{}
	for _, version := range record.Versions {
		if version.Version < 1 || seen[version.Version] || version.ContentHash != taskRuleHash(version.Content) {
			return taskRuleRecord{}, errors.New("invalid version history")
		}
		if version.SourceType != "manual" && version.SourceType != "markdown" && version.SourceType != "rollback" && version.SourceType != "use-builtin" {
			return taskRuleRecord{}, errors.New("invalid version source")
		}
		seen[version.Version] = true
	}
	if record.PublishedVersion != nil && !seen[*record.PublishedVersion] {
		return taskRuleRecord{}, errors.New("published version missing")
	}
	if record.Draft != nil && (record.Draft.Revision < 1 || (record.Draft.SourceType != "manual" && record.Draft.SourceType != "markdown")) {
		return taskRuleRecord{}, errors.New("invalid draft")
	}
	return record, nil
}

func (handler *AiTaskRules) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	path := strings.Trim(strings.TrimPrefix(request.URL.Path, "/v1/ai-task-rules"), "/")
	if path == "" {
		if request.Method != http.MethodGet {
			methodNotAllowed(writer, "GET")
			return
		}
		handler.list(writer, request)
		return
	}
	parts := strings.Split(path, "/")
	capabilityID := parts[0]
	if !validTaskRuleCapability(capabilityID) {
		writeTaskRuleError(writer, http.StatusBadRequest, "AI_CAPABILITY_UNKNOWN", "unknown capability")
		return
	}
	if len(parts) == 1 {
		if request.Method != http.MethodGet {
			methodNotAllowed(writer, "GET")
			return
		}
		handler.get(writer, request, capabilityID)
		return
	}
	action := parts[1]
	switch action {
	case "draft":
		if request.Method == http.MethodPut {
			handler.saveDraft(writer, request, capabilityID)
			return
		}
		if request.Method == http.MethodDelete {
			handler.discardDraft(writer, request, capabilityID)
			return
		}
		methodNotAllowed(writer, "PUT, DELETE")
	case "publish":
		if request.Method != http.MethodPost {
			methodNotAllowed(writer, "POST")
			return
		}
		handler.publish(writer, request, capabilityID)
	case "rollback":
		if request.Method != http.MethodPost {
			methodNotAllowed(writer, "POST")
			return
		}
		handler.rollback(writer, request, capabilityID)
	case "use-builtin":
		if request.Method != http.MethodPost {
			methodNotAllowed(writer, "POST")
			return
		}
		handler.useBuiltin(writer, request, capabilityID)
	default:
		writeError(writer, http.StatusNotFound, "not found")
	}
}

func writeTaskRuleError(writer http.ResponseWriter, status int, code, message string) {
	writeJSON(writer, status, map[string]string{"error": message, "code": code})
}

func (handler *AiTaskRules) read(request *http.Request, capabilityID string) (int64, taskRuleRecord, error) {
	if handler.cache != nil {
		if document, ok := handler.cache.Get(request.Context(), taskRuleNamespace, capabilityID); ok {
			var record taskRuleRecord
			if json.Unmarshal(document.Value, &record) == nil {
				normalized, err := normalizeTaskRuleRecord(record, capabilityID)
				return document.Revision, normalized, err
			}
		}
	}
	document, err := handler.store.GetDocument(request.Context(), taskRuleNamespace, capabilityID)
	if errors.Is(err, postgres.ErrNotFound) {
		return 0, emptyTaskRuleRecord(capabilityID), nil
	}
	if err != nil {
		return 0, taskRuleRecord{}, err
	}
	var record taskRuleRecord
	if err := json.Unmarshal(document.Value, &record); err != nil {
		return 0, taskRuleRecord{}, err
	}
	normalized, err := normalizeTaskRuleRecord(record, capabilityID)
	if err != nil {
		return 0, taskRuleRecord{}, err
	}
	if handler.cache != nil {
		_ = handler.cache.Set(request.Context(), document)
	}
	return document.Revision, normalized, nil
}

func (handler *AiTaskRules) write(request *http.Request, capabilityID string, revision int64, record taskRuleRecord) error {
	value, err := json.Marshal(record)
	if err != nil {
		return err
	}
	document, err := handler.store.PutDocument(request.Context(), taskRuleNamespace, capabilityID, &revision, value)
	if err != nil {
		if handler.cache != nil {
			_ = handler.cache.Delete(request.Context(), taskRuleNamespace, capabilityID)
		}
		return err
	}
	if handler.cache != nil {
		_ = handler.cache.Set(request.Context(), document)
	}
	return nil
}

func (handler *AiTaskRules) list(writer http.ResponseWriter, request *http.Request) {
	rules := map[string]taskRuleRecord{}
	for _, capabilityID := range taskRuleCapabilities {
		_, record, err := handler.read(request, capabilityID)
		if err != nil {
			writeTaskRuleError(writer, http.StatusBadRequest, "AI_TASK_RULE_CONFIG_INVALID", "task rule document is invalid")
			return
		}
		if record.Draft != nil || record.PublishedVersion != nil || len(record.Versions) > 0 {
			rules[capabilityID] = record
		}
	}
	writeJSON(writer, http.StatusOK, map[string]any{"schemaVersion": 1, "rules": rules})
}

func (handler *AiTaskRules) get(writer http.ResponseWriter, request *http.Request, capabilityID string) {
	_, record, err := handler.read(request, capabilityID)
	if err != nil {
		writeTaskRuleError(writer, http.StatusBadRequest, "AI_TASK_RULE_CONFIG_INVALID", "task rule document is invalid")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"record": record})
}

func (handler *AiTaskRules) saveDraft(writer http.ResponseWriter, request *http.Request, capabilityID string) {
	var input struct {
		Content          string  `json:"content"`
		SourceType       string  `json:"sourceType"`
		SourceFileName   *string `json:"sourceFileName"`
		ExpectedRevision *int    `json:"expectedRevision"`
		UserID           string  `json:"userId"`
	}
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	if input.SourceType == "" {
		input.SourceType = "manual"
	}
	if (input.SourceType != "manual" && input.SourceType != "markdown") || utf8.RuneCountInString(input.Content) > maxTaskRuleChars {
		writeTaskRuleError(writer, http.StatusBadRequest, "AI_TASK_RULE_TOO_LARGE", "invalid task rule draft")
		return
	}
	revision, record, err := handler.read(request, capabilityID)
	if err != nil {
		writeTaskRuleError(writer, http.StatusBadRequest, "AI_TASK_RULE_CONFIG_INVALID", "task rule document is invalid")
		return
	}
	current := 0
	if record.Draft != nil {
		current = record.Draft.Revision
	}
	if input.ExpectedRevision != nil && *input.ExpectedRevision != current {
		writeTaskRuleError(writer, http.StatusConflict, "AI_TASK_RULE_REVISION_CONFLICT", "draft revision conflict")
		return
	}
	next := current + 1
	record.Draft = &taskRuleDraft{Content: strings.ReplaceAll(strings.ReplaceAll(strings.TrimPrefix(input.Content, "\ufeff"), "\r\n", "\n"), "\r", "\n"), SourceType: input.SourceType, SourceFileName: input.SourceFileName, Revision: next, UpdatedBy: input.UserID, UpdatedAt: requestTime()}
	if err := handler.write(request, capabilityID, revision, record); errors.Is(err, postgres.ErrRevisionConflict) {
		writeTaskRuleError(writer, http.StatusConflict, "AI_TASK_RULE_REVISION_CONFLICT", "task rule was updated by another request")
		return
	} else if err != nil {
		writeError(writer, http.StatusInternalServerError, "task rule write failed")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]int{"revision": next})
}

func (handler *AiTaskRules) discardDraft(writer http.ResponseWriter, request *http.Request, capabilityID string) {
	revision, record, err := handler.read(request, capabilityID)
	if err != nil {
		writeTaskRuleError(writer, http.StatusBadRequest, "AI_TASK_RULE_CONFIG_INVALID", "task rule document is invalid")
		return
	}
	if record.Draft == nil {
		writeJSON(writer, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	record.Draft = nil
	if err := handler.write(request, capabilityID, revision, record); errors.Is(err, postgres.ErrRevisionConflict) {
		writeTaskRuleError(writer, http.StatusConflict, "AI_TASK_RULE_REVISION_CONFLICT", "task rule was updated by another request")
		return
	} else if err != nil {
		writeError(writer, http.StatusInternalServerError, "task rule write failed")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]bool{"ok": true})
}

func nextTaskRuleVersion(versions []taskRuleVersion) int {
	next := 1
	for _, version := range versions {
		if version.Version >= next {
			next = version.Version + 1
		}
	}
	return next
}

func invalidRuleContent(content string) bool {
	if strings.TrimSpace(content) == "" || utf8.RuneCountInString(content) > maxTaskRuleChars {
		return true
	}
	for _, value := range []byte(content) {
		if value < 32 && value != '\n' && value != '\r' && value != '\t' {
			return true
		}
	}
	lower := strings.ToLower(content)
	return strings.Contains(lower, "api key") || strings.Contains(lower, "api_key") || strings.Contains(lower, "sk-") || strings.Contains(content, "{{") || strings.Contains(content, "${")
}

func (handler *AiTaskRules) publish(writer http.ResponseWriter, request *http.Request, capabilityID string) {
	var input struct {
		ExpectedRevision *int   `json:"expectedRevision"`
		IdempotencyKey   string `json:"idempotencyKey"`
		UserID           string `json:"userId"`
	}
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	revision, record, err := handler.read(request, capabilityID)
	if err != nil {
		writeTaskRuleError(writer, http.StatusBadRequest, "AI_TASK_RULE_CONFIG_INVALID", "task rule document is invalid")
		return
	}
	if input.IdempotencyKey != "" && record.LastPublishIdempotencyKey != nil && *record.LastPublishIdempotencyKey == input.IdempotencyKey && record.PublishedVersion != nil {
		for _, version := range record.Versions {
			if version.Version == *record.PublishedVersion {
				writeJSON(writer, http.StatusOK, map[string]any{"version": version.Version, "contentHash": version.ContentHash})
				return
			}
		}
	}
	if record.Draft == nil || invalidRuleContent(record.Draft.Content) {
		writeTaskRuleError(writer, http.StatusBadRequest, "AI_TASK_RULE_CONFIG_INVALID", "no publishable draft")
		return
	}
	if input.ExpectedRevision != nil && *input.ExpectedRevision != record.Draft.Revision {
		writeTaskRuleError(writer, http.StatusConflict, "AI_TASK_RULE_REVISION_CONFLICT", "draft revision conflict")
		return
	}
	next := nextTaskRuleVersion(record.Versions)
	hash := taskRuleHash(record.Draft.Content)
	published := next
	record.Versions = append(record.Versions, taskRuleVersion{Version: next, Content: record.Draft.Content, ContentHash: hash, SourceType: record.Draft.SourceType, SourceFileName: record.Draft.SourceFileName, PublishedBy: input.UserID, PublishedAt: requestTime()})
	record.PublishedVersion = &published
	record.Draft = nil
	if input.IdempotencyKey == "" {
		record.LastPublishIdempotencyKey = nil
	} else {
		record.LastPublishIdempotencyKey = &input.IdempotencyKey
	}
	if err := handler.write(request, capabilityID, revision, record); errors.Is(err, postgres.ErrRevisionConflict) {
		writeTaskRuleError(writer, http.StatusConflict, "AI_TASK_RULE_REVISION_CONFLICT", "task rule was updated by another request")
		return
	} else if err != nil {
		writeError(writer, http.StatusInternalServerError, "task rule write failed")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"version": next, "contentHash": hash})
}

func (handler *AiTaskRules) rollback(writer http.ResponseWriter, request *http.Request, capabilityID string) {
	var input struct {
		ToVersion      int    `json:"toVersion"`
		IdempotencyKey string `json:"idempotencyKey"`
		UserID         string `json:"userId"`
	}
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	revision, record, err := handler.read(request, capabilityID)
	if err != nil {
		writeTaskRuleError(writer, http.StatusBadRequest, "AI_TASK_RULE_CONFIG_INVALID", "task rule document is invalid")
		return
	}
	if input.IdempotencyKey != "" && record.LastRollbackIdempotencyKey != nil && *record.LastRollbackIdempotencyKey == input.IdempotencyKey && record.PublishedVersion != nil {
		for _, version := range record.Versions {
			if version.Version == *record.PublishedVersion && version.RolledBackFromVersion != nil && *version.RolledBackFromVersion == input.ToVersion {
				writeJSON(writer, http.StatusOK, map[string]any{"version": version.Version, "contentHash": version.ContentHash})
				return
			}
		}
	}
	var target *taskRuleVersion
	for index := range record.Versions {
		if record.Versions[index].Version == input.ToVersion {
			target = &record.Versions[index]
			break
		}
	}
	if target == nil {
		writeTaskRuleError(writer, http.StatusBadRequest, "AI_TASK_RULE_CONFIG_INVALID", "target version does not exist")
		return
	}
	next := nextTaskRuleVersion(record.Versions)
	hash := taskRuleHash(target.Content)
	published := next
	rolledBack := input.ToVersion
	record.Versions = append(record.Versions, taskRuleVersion{Version: next, Content: target.Content, ContentHash: hash, SourceType: "rollback", SourceFileName: target.SourceFileName, PublishedBy: input.UserID, PublishedAt: requestTime(), RolledBackFromVersion: &rolledBack})
	record.PublishedVersion = &published
	if input.IdempotencyKey == "" {
		record.LastRollbackIdempotencyKey = nil
	} else {
		record.LastRollbackIdempotencyKey = &input.IdempotencyKey
	}
	if err := handler.write(request, capabilityID, revision, record); errors.Is(err, postgres.ErrRevisionConflict) {
		writeTaskRuleError(writer, http.StatusConflict, "AI_TASK_RULE_REVISION_CONFLICT", "task rule was updated by another request")
		return
	} else if err != nil {
		writeError(writer, http.StatusInternalServerError, "task rule write failed")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"version": next, "contentHash": hash})
}

func (handler *AiTaskRules) useBuiltin(writer http.ResponseWriter, request *http.Request, capabilityID string) {
	var input struct {
		UserID string `json:"userId"`
	}
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	revision, record, err := handler.read(request, capabilityID)
	if err != nil {
		writeTaskRuleError(writer, http.StatusBadRequest, "AI_TASK_RULE_CONFIG_INVALID", "task rule document is invalid")
		return
	}
	next := nextTaskRuleVersion(record.Versions)
	record.PublishedVersion = nil
	record.Draft = nil
	record.Versions = append(record.Versions, taskRuleVersion{Version: next, Content: "", ContentHash: taskRuleHash(""), SourceType: "use-builtin", PublishedBy: input.UserID, PublishedAt: requestTime()})
	if err := handler.write(request, capabilityID, revision, record); errors.Is(err, postgres.ErrRevisionConflict) {
		writeTaskRuleError(writer, http.StatusConflict, "AI_TASK_RULE_REVISION_CONFLICT", "task rule was updated by another request")
		return
	} else if err != nil {
		writeError(writer, http.StatusInternalServerError, "task rule write failed")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]bool{"ok": true})
}
