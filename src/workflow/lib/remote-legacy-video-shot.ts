import "server-only";

import { requestRemoteData } from "@/persistence/remote-data-client";

export async function submitLegacyVideoShotToGo(
  input: Record<string, unknown>,
  actorId: string,
): Promise<Response> {
  return requestRemoteData("/v1/generate/video-shot", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-actor-id": actorId,
    },
    body: JSON.stringify(input),
  });
}
