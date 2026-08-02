import "server-only";

import { requestRemoteData } from "@/persistence/remote-data-client";
import type { ProjectTextDocument, StoryDraft, TextOutputKind } from "@/text-generation/types";

const ENDPOINT = "/v1/project-text-documents";

async function projectTextRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await requestRemoteData(path, init);
  if (!response.ok) throw new Error(`REMOTE_TEXT_DOCUMENT_REQUEST_FAILED:${response.status}`);
  return (await response.json()) as T;
}

export async function listDocumentVersionsRemote(projectId: string): Promise<ProjectTextDocument[]> {
  const result = await projectTextRequest<{ documents: ProjectTextDocument[] }>(
    `${ENDPOINT}?projectId=${encodeURIComponent(projectId)}`,
  );
  return result.documents;
}

export async function getCurrentDocumentRemote(projectId: string): Promise<ProjectTextDocument | null> {
  const result = await projectTextRequest<{ document: ProjectTextDocument | null }>(
    `${ENDPOINT}?projectId=${encodeURIComponent(projectId)}&view=current`,
  );
  return result.document;
}

export async function saveNewDocumentVersionRemote(input: {
  projectId: string;
  rootFolderId: string;
  documentType: TextOutputKind;
  title: string;
  content: string;
  createdBy: string;
  modelKey: string;
  providerModel: string;
  targetChars: number;
  actualChars: number;
  inputTokens: number | null;
  outputTokens: number | null;
  generationId: string;
}): Promise<ProjectTextDocument> {
  const result = await projectTextRequest<{ document: ProjectTextDocument }>(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "saveVersion", input }),
  });
  return result.document;
}

export async function saveStoryDraftRemote(draft: StoryDraft): Promise<void> {
  await projectTextRequest(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "saveDraft", draft }),
  });
}

export async function loadStoryDraftRemote(projectId: string): Promise<StoryDraft | null> {
  const result = await projectTextRequest<{ draft: StoryDraft | null }>(
    `${ENDPOINT}?projectId=${encodeURIComponent(projectId)}&view=draft`,
  );
  return result.draft;
}