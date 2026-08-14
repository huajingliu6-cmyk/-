"use client";

import { AssetApprovalsHistoryTab } from "@/auth/ai-admin/AssetApprovalsHistoryTab";

export default function SystemAdminApprovalsPage() {
  return (
    <div data-testid="admin-approvals-page">
      <AssetApprovalsHistoryTab active />
    </div>
  );
}
