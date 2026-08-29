package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/cache"
	"infinite-canvas/backend/internal/postgres"
)

const notificationNamespace = "notifications"
const maxNotificationWriteAttempts = 6

type notification struct {
	ID              string  `json:"id"`
	RecipientUserID string  `json:"recipientUserId"`
	Type            string  `json:"type"`
	ProjectID       string  `json:"projectId"`
	EpisodeID       string  `json:"episodeId"`
	SubmissionID    string  `json:"submissionId"`
	SubmitterUserID string  `json:"submitterUserId"`
	EnterpriseID    string  `json:"enterpriseId,omitempty"`
	Title           string  `json:"title"`
	Summary         string  `json:"summary"`
	CreatedAt       string  `json:"createdAt"`
	ReadAt          *string `json:"readAt"`
}

type notificationFile struct {
	Version       int            `json:"version"`
	Notifications []notification `json:"notifications"`
}

type Notifications struct {
	store *postgres.Store
	cache *cache.Documents
}

func NewNotifications(store *postgres.Store, documentCache *cache.Documents) *Notifications {
	return &Notifications{store: store, cache: documentCache}
}

func (handler *Notifications) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet:
		handler.list(writer, request)
	case http.MethodPost:
		handler.create(writer, request)
	case http.MethodPatch:
		handler.markRead(writer, request)
	case http.MethodDelete:
		handler.delete(writer, request)
	default:
		methodNotAllowed(writer, "GET, POST, PATCH, DELETE")
	}
}

func normalizeNotificationFile(file notificationFile) notificationFile {
	file.Version = 1
	if file.Notifications == nil {
		file.Notifications = []notification{}
	}
	return file
}

func (handler *Notifications) readFile(request *http.Request, userID string) (int64, notificationFile, error) {
	if handler.cache != nil {
		if document, ok := handler.cache.Get(request.Context(), notificationNamespace, userID); ok {
			var file notificationFile
			if json.Unmarshal(document.Value, &file) == nil {
				return document.Revision, normalizeNotificationFile(file), nil
			}
		}
	}
	document, err := handler.store.GetDocument(request.Context(), notificationNamespace, userID)
	if errors.Is(err, postgres.ErrNotFound) {
		return 0, notificationFile{Version: 1, Notifications: []notification{}}, nil
	}
	if err != nil {
		return 0, notificationFile{}, err
	}
	var file notificationFile
	if err := json.Unmarshal(document.Value, &file); err != nil {
		return 0, notificationFile{}, err
	}
	if handler.cache != nil {
		_ = handler.cache.Set(request.Context(), document)
	}
	return document.Revision, normalizeNotificationFile(file), nil
}

func (handler *Notifications) mutateFile(request *http.Request, userID string, mutate func(*notificationFile) (any, bool, error)) (any, error) {
	for attempt := 0; attempt < maxNotificationWriteAttempts; attempt++ {
		revision, file, err := handler.readFile(request, userID)
		if err != nil {
			return nil, err
		}
		result, changed, err := mutate(&file)
		if err != nil || !changed {
			return result, err
		}
		value, err := json.Marshal(file)
		if err != nil {
			return nil, err
		}
		document, err := handler.store.PutDocument(request.Context(), notificationNamespace, userID, &revision, value)
		if errors.Is(err, postgres.ErrRevisionConflict) {
			if handler.cache != nil {
				_ = handler.cache.Delete(request.Context(), notificationNamespace, userID)
			}
			continue
		}
		if err != nil {
			return nil, err
		}
		if handler.cache != nil {
			_ = handler.cache.Set(request.Context(), document)
		}
		return result, nil
	}
	return nil, postgres.ErrRevisionConflict
}

func validNotificationType(value string) bool {
	switch value {
	case "asset_approval_submitted",
		"asset_approval_approved",
		"asset_approval_rejected",
		"enterprise_join_approved",
		"enterprise_join_rejected",
		"image_generation_succeeded",
		"image_generation_failed",
		"storyboard_prompt_generating",
		"storyboard_prompt_ready",
		"storyboard_prompt_failed":
		return true
	default:
		return false
	}
}

func enterpriseNotificationType(value string) bool {
	return value == "enterprise_join_approved" || value == "enterprise_join_rejected"
}

func (handler *Notifications) list(writer http.ResponseWriter, request *http.Request) {
	userID := strings.TrimSpace(request.URL.Query().Get("userId"))
	if userID == "" {
		writeError(writer, http.StatusBadRequest, "userId is required")
		return
	}
	revision, file, err := handler.readFile(request, userID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "notifications read failed")
		return
	}
	if request.URL.Query().Get("snapshot") == "true" {
		writeJSON(writer, http.StatusOK, map[string]any{"file": file, "revision": revision})
		return
	}
	sort.SliceStable(file.Notifications, func(left, right int) bool {
		return file.Notifications[left].CreatedAt > file.Notifications[right].CreatedAt
	})
	unread := 0
	for _, item := range file.Notifications {
		if item.ReadAt == nil {
			unread++
		}
	}
	writeJSON(writer, http.StatusOK, map[string]any{"notifications": file.Notifications, "unreadCount": unread})
}

func (handler *Notifications) create(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		RecipientUserID      string `json:"recipientUserId"`
		Type                 string `json:"type"`
		ProjectID            string `json:"projectId"`
		EpisodeID            string `json:"episodeId"`
		SubmissionID         string `json:"submissionId"`
		SubmitterUserID      string `json:"submitterUserId"`
		EnterpriseID         string `json:"enterpriseId"`
		Title                string `json:"title"`
		Summary              string `json:"summary"`
		DedupeBySubmissionID bool   `json:"dedupeBySubmissionId"`
	}
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	validTarget := strings.TrimSpace(input.ProjectID) != "" && strings.TrimSpace(input.EpisodeID) != ""
	if enterpriseNotificationType(input.Type) {
		validTarget = strings.TrimSpace(input.EnterpriseID) != ""
	}
	if strings.TrimSpace(input.RecipientUserID) == "" || !validNotificationType(input.Type) || !validTarget || strings.TrimSpace(input.SubmissionID) == "" || strings.TrimSpace(input.SubmitterUserID) == "" || strings.TrimSpace(input.Title) == "" {
		writeError(writer, http.StatusBadRequest, "invalid notification payload")
		return
	}
	idBytes := make([]byte, 8)
	if _, err := rand.Read(idBytes); err != nil {
		writeError(writer, http.StatusInternalServerError, "notification id generation failed")
		return
	}
	item := notification{ID: "ntf_" + hex.EncodeToString(idBytes), RecipientUserID: input.RecipientUserID, Type: input.Type, ProjectID: input.ProjectID, EpisodeID: input.EpisodeID, SubmissionID: input.SubmissionID, SubmitterUserID: input.SubmitterUserID, EnterpriseID: input.EnterpriseID, Title: input.Title, Summary: input.Summary, CreatedAt: requestTime()}
	result, err := handler.mutateFile(request, input.RecipientUserID, func(file *notificationFile) (any, bool, error) {
		if input.DedupeBySubmissionID {
			for _, existing := range file.Notifications {
				if existing.Type == input.Type && existing.SubmissionID == input.SubmissionID {
					return map[string]any{"notification": existing}, false, nil
				}
			}
		}
		file.Notifications = append(file.Notifications, item)
		return map[string]any{"notification": item}, true, nil
	})
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "notification create failed")
		return
	}
	writeJSON(writer, http.StatusCreated, result)
}

func (handler *Notifications) markRead(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		UserID         string   `json:"userId"`
		NotificationID string   `json:"notificationId"`
		SubmissionID   string   `json:"submissionId"`
		Types          []string `json:"types"`
	}
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	if strings.TrimSpace(input.UserID) == "" || (input.NotificationID == "" && input.SubmissionID == "") || (input.NotificationID != "" && input.SubmissionID != "") {
		writeError(writer, http.StatusBadRequest, "invalid notification read payload")
		return
	}
	result, err := handler.mutateFile(request, input.UserID, func(file *notificationFile) (any, bool, error) {
		if input.NotificationID != "" {
			for index, current := range file.Notifications {
				if current.ID != input.NotificationID {
					continue
				}
				if current.ReadAt != nil {
					return map[string]any{"notification": current}, false, nil
				}
				now := requestTime()
				current.ReadAt = &now
				file.Notifications[index] = current
				return map[string]any{"notification": current}, true, nil
			}
			return map[string]any{"notification": nil}, false, nil
		}
		allowed := map[string]bool{}
		for _, value := range input.Types {
			if !validNotificationType(value) {
				return nil, false, errors.New("invalid notification type")
			}
			allowed[value] = true
		}
		now := requestTime()
		changed := 0
		for index, current := range file.Notifications {
			if current.SubmissionID != input.SubmissionID || current.ReadAt != nil || (len(allowed) > 0 && !allowed[current.Type]) {
				continue
			}
			current.ReadAt = &now
			file.Notifications[index] = current
			changed++
		}
		return map[string]any{"changed": changed}, changed > 0, nil
	})
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (handler *Notifications) delete(writer http.ResponseWriter, request *http.Request) {
	userID := strings.TrimSpace(request.URL.Query().Get("userId"))
	notificationID := strings.TrimSpace(request.URL.Query().Get("notificationId"))
	if userID == "" || notificationID == "" {
		writeError(writer, http.StatusBadRequest, "userId and notificationId are required")
		return
	}
	result, err := handler.mutateFile(request, userID, func(file *notificationFile) (any, bool, error) {
		for index, current := range file.Notifications {
			if current.ID != notificationID {
				continue
			}
			if current.ReadAt == nil {
				return map[string]any{"ok": false, "code": "NOT_COMPLETED", "message": "未完成的审批通知不可删除"}, false, nil
			}
			file.Notifications = append(file.Notifications[:index], file.Notifications[index+1:]...)
			return map[string]any{"ok": true, "notification": current}, true, nil
		}
		return map[string]any{"ok": false, "code": "NOT_FOUND", "message": "通知不存在"}, false, nil
	})
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "notification delete failed")
		return
	}
	writeJSON(writer, http.StatusOK, result)
}
