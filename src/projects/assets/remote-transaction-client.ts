import "server-only";
import { requestRemoteData } from "@/persistence/remote-data-client";
export async function runProjectAssetTransaction(input: {
  writes: Array<{ namespace: string; key: string; expectedRevision: number; value: unknown }>;
  blobCopies?: Array<{ sourceStorageKey: string; targetStorageKey: string }>;
  blobChecks?: string[];
}): Promise<void> {
  const response = await requestRemoteData("/v1/project-asset-transactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 409) throw new Error("REVISION_CONFLICT");
  if (response.status === 422) throw new Error("REMOTE_BLOB_SOURCE_NOT_FOUND");
  if (!response.ok) throw new Error(`REMOTE_PROJECT_ASSET_TRANSACTION_FAILED:${response.status}`);
}