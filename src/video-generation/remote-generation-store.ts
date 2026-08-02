import "server-only";

import { requestRemoteData } from "@/persistence/remote-data-client";
import type { GenerationRecord } from "@/video-generation/types";

async function videoGenerationRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await requestRemoteData(path, init);
  if (!response.ok) {
    throw new Error(`REMOTE_VIDEO_GENERATION_REQUEST_FAILED:${response.status}`);
  }
  return (await response.json()) as T;
}

export async function readGenerationRecordRemote(
  id: string,
): Promise<GenerationRecord | null> {
  const result = await videoGenerationRequest<{
    record: GenerationRecord | null;
  }>(`/v1/video-generations?id=${encodeURIComponent(id)}`);
  return result.record;
}

export async function saveGenerationRecordRemote(
  record: GenerationRecord,
): Promise<void> {
  await videoGenerationRequest("/v1/video-generations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record),
  });
}

export async function updateGenerationRecordRemote(
  id: string,
  patch: Partial<GenerationRecord>,
): Promise<GenerationRecord> {
  const result = await videoGenerationRequest<{ record: GenerationRecord }>(
    `/v1/video-generations?id=${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  return result.record;
}

export async function listGenerationRecordsRemote(): Promise<GenerationRecord[]> {
  const result = await videoGenerationRequest<{ records: GenerationRecord[] }>(
    "/v1/video-generations",
  );
  return result.records;
}