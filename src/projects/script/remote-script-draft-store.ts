import "server-only";

import { requestRemoteData } from "@/persistence/remote-data-client";
import type { ScriptDraft } from "@/projects/script/script-draft-store";

async function scriptDraftRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await requestRemoteData(path, init);
  if (!response.ok) {
    throw new Error(`REMOTE_SCRIPT_DRAFT_REQUEST_FAILED:${response.status}`);
  }
  return (await response.json()) as T;
}

export async function loadScriptDraftRemoteValue(projectId: string): Promise<unknown | null> {
  const result = await scriptDraftRequest<{ draft: unknown | null }>(
    `/v1/script-drafts?projectId=${encodeURIComponent(projectId)}`,
  );
  return result.draft;
}

export async function saveScriptDraftRemote(draft: ScriptDraft): Promise<ScriptDraft> {
  const result = await scriptDraftRequest<{ draft: ScriptDraft }>("/v1/script-drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  return result.draft;
}