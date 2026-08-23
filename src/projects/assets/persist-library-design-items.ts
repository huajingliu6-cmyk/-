import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import { parseResponseJson } from "@/projects/assets/parse-response-json";

export async function persistLibraryDesignItems(input: {
  projectId: string;
  context: "management" | "workspace";
  episodeId: string;
  items: EpisodeAssetDesignItem[];
}): Promise<void> {
  const episodeId = input.episodeId.trim();
  if (!episodeId || input.items.length === 0) return;

  const apiRoot =
    input.context === "workspace"
      ? `/api/workspace/projects/${encodeURIComponent(input.projectId)}`
      : `/api/projects/${encodeURIComponent(input.projectId)}`;

  const detailRes = await fetch(
    `${apiRoot}/asset-designs/episodes/${encodeURIComponent(episodeId)}`,
    { credentials: "include" },
  );
  const detail = await parseResponseJson<{
    error?: string;
    record?: { revision: number };
    currentFingerprint?: string;
  }>(detailRes);
  if (!detailRes.ok || !detail?.record || !detail.currentFingerprint) {
    throw new Error(detail?.error ?? "无法读取资产设计稿，提示词保存失败");
  }

  const putRes = await fetch(
    `${apiRoot}/asset-designs/episodes/${encodeURIComponent(episodeId)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: detail.record.revision,
        fingerprint: detail.currentFingerprint,
        items: input.items.map((item) => ({
          ...item,
          note: typeof item.note === "string" ? item.note : "",
          resolution:
            item.resolution === "pending" ? "create_new" : item.resolution,
        })),
      }),
    },
  );
  const putPayload = await parseResponseJson<{ error?: string }>(putRes);
  if (!putRes.ok) {
    throw new Error(putPayload?.error ?? "提示词保存失败");
  }
}
