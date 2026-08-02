import 'server-only';

type RemoteDocument<T> = {
  namespace: string;
  key: string;
  revision: number;
  value: T;
  updatedAt: string;
};

function config() {
  const baseUrl = (process.env.GO_BACKEND_INTERNAL_URL ?? '').trim();
  const token = (process.env.INTERNAL_API_TOKEN ?? '').trim();
  if (!baseUrl || !token) {
    throw new Error('REMOTE_DATA_SERVICE_NOT_CONFIGURED');
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), token };
}

function documentUrl(namespace: string, key: string) {
  const { baseUrl } = config();
  return `${baseUrl}/v1/documents/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`;
}

function blobUrl(storageKey: string) {
  const { baseUrl } = config();
  const encodedKey = storageKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${baseUrl}/v1/blobs/${encodedKey}`;
}

function headers() {
  const { token } = config();
  return {
    'content-type': 'application/json',
    'x-internal-token': token,
  };
}

export async function requestRemoteData(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const runtime = config();
  const headers = new Headers(init.headers);
  headers.set("x-internal-token", runtime.token);
  return remoteFetch(`${runtime.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}
async function remoteFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error('REMOTE_DATA_UNAVAILABLE');
  }
}

export function isRemoteDataOnly(): boolean {
  return process.env.REMOTE_DATA_ONLY === 'true' || process.env.NODE_ENV === 'production';
}

export async function getRemoteDocument<T>(namespace: string, key: string) {
  const response = await remoteFetch(documentUrl(namespace, key), {
    headers: headers(),
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`REMOTE_DATA_READ_FAILED:${response.status}`);
  return (await response.json()) as RemoteDocument<T>;
}

export async function putRemoteDocument<T>(input: {
  namespace: string;
  key: string;
  expectedRevision?: number;
  value: T;
}) {
  const response = await remoteFetch(documentUrl(input.namespace, input.key), {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({
      expectedRevision: input.expectedRevision,
      value: input.value,
    }),
    cache: 'no-store',
  });
  if (response.status === 409) throw new Error('REVISION_CONFLICT');
  if (!response.ok) throw new Error(`REMOTE_DATA_WRITE_FAILED:${response.status}`);
  return (await response.json()) as RemoteDocument<T>;
}

export async function putRemoteDocumentsAtomic(input: {
  writes: Array<{
    namespace: string;
    key: string;
    expectedRevision: number;
    value: unknown;
  }>;
  blobCopies?: Array<{
    sourceStorageKey: string;
    targetStorageKey: string;
  }>;
  blobChecks?: string[];
}) {
  const response = await remoteFetch(`${config().baseUrl}/v1/document-transactions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(input),
    cache: 'no-store',
  });
  if (response.status === 409) throw new Error('REVISION_CONFLICT');
  if (response.status === 422) throw new Error('REMOTE_BLOB_SOURCE_NOT_FOUND');
  if (!response.ok) throw new Error(`REMOTE_DATA_WRITE_FAILED:${response.status}`);
  return (await response.json()) as { documents: RemoteDocument<unknown>[] };
}

export type RemoteBlob = {
  body: Buffer;
  contentType: string;
  etag: string | null;
};

export async function getRemoteBlob(
  storageKey: string,
): Promise<RemoteBlob | null> {
  const response = await remoteFetch(blobUrl(storageKey), {
    headers: { 'x-internal-token': config().token },
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`REMOTE_BLOB_READ_FAILED:${response.status}`);
  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    etag: response.headers.get('etag'),
  };
}

export async function putRemoteBlob(input: {
  storageKey: string;
  contentType: string;
  body: Buffer;
}): Promise<void> {
  const response = await remoteFetch(blobUrl(input.storageKey), {
    method: 'PUT',
    headers: {
      'content-type': input.contentType,
      'x-internal-token': config().token,
    },
    body: new Uint8Array(input.body),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`REMOTE_BLOB_WRITE_FAILED:${response.status}`);
}

export async function deleteRemoteBlob(storageKey: string): Promise<void> {
  const response = await remoteFetch(blobUrl(storageKey), {
    method: 'DELETE',
    headers: { 'x-internal-token': config().token },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`REMOTE_BLOB_DELETE_FAILED:${response.status}`);
}

export function isRemoteRevisionConflict(error: unknown): boolean {
  return error instanceof Error && error.message === 'REVISION_CONFLICT';
}

export function isRemoteDataServiceError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === 'REMOTE_DATA_SERVICE_NOT_CONFIGURED' ||
      error.message === 'REMOTE_DATA_UNAVAILABLE' ||
      error.message.startsWith('REMOTE_DATA_READ_FAILED:') ||
      error.message.startsWith('REMOTE_DATA_WRITE_FAILED:') ||
      error.message.startsWith('REMOTE_BLOB_READ_FAILED:') ||
      error.message.startsWith('REMOTE_BLOB_WRITE_FAILED:') ||
      error.message.startsWith('REMOTE_BLOB_DELETE_FAILED:'))
  );
}
