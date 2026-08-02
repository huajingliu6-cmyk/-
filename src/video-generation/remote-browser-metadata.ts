import "server-only";

import { requestRemoteData } from "@/persistence/remote-data-client";
import type { GenerationRecord } from "./types";

export type BrowserMetadataCommandInput = {
  generationId: string;
  videoAssetId: string;
  actualWidth: number;
  actualHeight: number;
  actualDurationSeconds: number;
};

export type BrowserMetadataCommandResult = {
  record: GenerationRecord;
  idempotent: boolean;
};

export async function updateBrowserMetadataInGo(
  input: BrowserMetadataCommandInput,
  actorId: string,
): Promise<Response> {
  return requestRemoteData("/v1/video-generations/browser-metadata", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-actor-id": actorId,
    },
    body: JSON.stringify(input),
  });
}
