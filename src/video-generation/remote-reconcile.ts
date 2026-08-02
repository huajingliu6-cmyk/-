import "server-only";

import { requestRemoteData } from "@/persistence/remote-data-client";

export async function reconcileGenerationInGo(
  generationId: string,
  actorId: string,
): Promise<Response> {
  return requestRemoteData("/v1/video-generation-idempotency/reconcile", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-actor-id": actorId,
    },
    body: JSON.stringify({ generationId }),
  });
}
