import { randomUUID } from "crypto";
import {
  deleteRemoteBlob,
  getRemoteBlob,
  putRemoteBlob,
  type RemoteBlob,
} from "@/persistence/remote-data-client";

const STORAGE_PREFIX = "video-provider-results/";
const URL_PREFIX = "remote-blob:";
const SAFE_RESULT_ID = /^[A-Za-z0-9_-]+$/;

function storageKey(resultId: string): string {
  if (!SAFE_RESULT_ID.test(resultId)) {
    throw new Error("INVALID_REMOTE_PROVIDER_RESULT_ID");
  }
  return `${STORAGE_PREFIX}${resultId}`;
}

export async function storeRemoteProviderResult(buffer: Buffer): Promise<string> {
  const resultId = randomUUID();
  const key = storageKey(resultId);
  await putRemoteBlob({
    storageKey: key,
    contentType: "video/mp4",
    body: buffer,
  });
  return `${URL_PREFIX}${key}`;
}

export function parseRemoteProviderResultUrl(value: string): string | null {
  if (!value.startsWith(URL_PREFIX)) return null;
  const key = value.slice(URL_PREFIX.length);
  if (!key.startsWith(STORAGE_PREFIX)) return null;
  const resultId = key.slice(STORAGE_PREFIX.length);
  return SAFE_RESULT_ID.test(resultId) ? key : null;
}

export function getRemoteProviderResult(value: string): Promise<RemoteBlob | null> {
  const key = parseRemoteProviderResultUrl(value);
  if (!key) throw new Error("INVALID_REMOTE_PROVIDER_RESULT_URL");
  return getRemoteBlob(key);
}

export function deleteRemoteProviderResult(value: string): Promise<void> {
  const key = parseRemoteProviderResultUrl(value);
  if (!key) throw new Error("INVALID_REMOTE_PROVIDER_RESULT_URL");
  return deleteRemoteBlob(key);
}
