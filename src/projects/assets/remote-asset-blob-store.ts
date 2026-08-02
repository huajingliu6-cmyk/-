import 'server-only';

import {
  deleteRemoteBlob,
  getRemoteBlob,
  putRemoteBlob,
  type RemoteBlob,
} from '@/persistence/remote-data-client';

const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;

function isSafeAssetId(id: string): boolean {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 128 &&
    SAFE_ID_RE.test(id) &&
    !id.includes('..') &&
    !id.includes('/') &&
    !id.includes('\\') &&
    !id.includes('\0')
  );
}

export function imageStorageKey(projectId: string, assetId: string): string {
  if (!isSafeAssetId(projectId) || !isSafeAssetId(assetId)) {
    throw new Error('INVALID_REMOTE_ASSET_IMAGE_KEY');
  }
  return `projects/${projectId}/asset-images/${assetId}`;
}

function audioStorageKey(projectId: string, assetId: string): string {
  if (!isSafeAssetId(projectId) || !isSafeAssetId(assetId)) {
    throw new Error('INVALID_REMOTE_ASSET_AUDIO_KEY');
  }
  return `projects/${projectId}/asset-audio/${assetId}`;
}

export function getRemoteAssetImage(
  projectId: string,
  assetId: string,
): Promise<RemoteBlob | null> {
  return getRemoteBlob(imageStorageKey(projectId, assetId));
}

export async function putRemoteAssetImage(input: {
  projectId: string;
  assetId: string;
  mimeType: string;
  body: Buffer;
}): Promise<void> {
  await putRemoteBlob({
    storageKey: imageStorageKey(input.projectId, input.assetId),
    contentType: input.mimeType,
    body: input.body,
  });
}

export function deleteRemoteAssetImage(
  projectId: string,
  assetId: string,
): Promise<void> {
  return deleteRemoteBlob(imageStorageKey(projectId, assetId));
}

export function getRemoteAssetAudio(
  projectId: string,
  assetId: string,
): Promise<RemoteBlob | null> {
  return getRemoteBlob(audioStorageKey(projectId, assetId));
}

export async function putRemoteAssetAudio(input: {
  projectId: string;
  assetId: string;
  mimeType: string;
  body: Buffer;
}): Promise<void> {
  await putRemoteBlob({
    storageKey: audioStorageKey(input.projectId, input.assetId),
    contentType: input.mimeType,
    body: input.body,
  });
}

export function deleteRemoteAssetAudio(
  projectId: string,
  assetId: string,
): Promise<void> {
  return deleteRemoteBlob(audioStorageKey(projectId, assetId));
}
