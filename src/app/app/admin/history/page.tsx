"use client";

import { TextGenerationsHistoryTab } from "@/auth/ai-admin/TextGenerationsHistoryTab";

export default function SystemAdminHistoryPage() {
  return (
    <div data-testid="admin-history-page">
      <TextGenerationsHistoryTab active />
    </div>
  );
}
