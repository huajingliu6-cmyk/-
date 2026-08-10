package httpapi

import "testing"

func TestEnterpriseNotificationTypes(t *testing.T) {
	for _, value := range []string{"enterprise_join_approved", "enterprise_join_rejected"} {
		if !validNotificationType(value) {
			t.Fatalf("expected %s to be a valid notification type", value)
		}
		if !enterpriseNotificationType(value) {
			t.Fatalf("expected %s to be an enterprise notification type", value)
		}
	}
	if enterpriseNotificationType("asset_approval_approved") {
		t.Fatal("asset approval notification must not use enterprise payload validation")
	}
}
