import "server-only";

import { requestRemoteData } from "@/persistence/remote-data-client";
import type { EnterpriseCatalog } from "@/enterprise/types";

export type RemoteEnterpriseCatalog = {
  revision: number;
  value: EnterpriseCatalog;
};

export async function readRemoteEnterpriseCatalog(): Promise<RemoteEnterpriseCatalog | null> {
  const response = await requestRemoteData("/v1/enterprises/catalog");
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`REMOTE_ENTERPRISE_READ_FAILED:${response.status}`);
  }
  return (await response.json()) as RemoteEnterpriseCatalog;
}

export async function writeRemoteEnterpriseCatalog(input: {
  expectedRevision: number;
  value: EnterpriseCatalog;
}): Promise<void> {
  const response = await requestRemoteData("/v1/enterprises/catalog", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 409) throw new Error("ENTERPRISE_REVISION_CONFLICT");
  if (!response.ok) {
    throw new Error(`REMOTE_ENTERPRISE_WRITE_FAILED:${response.status}`);
  }
}

export function isEnterpriseRevisionConflict(error: unknown): boolean {
  return error instanceof Error && error.message === "ENTERPRISE_REVISION_CONFLICT";
}
