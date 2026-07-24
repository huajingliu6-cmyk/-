/** 最终 generatedVideo 播放/下载 URL（基于 assetId，禁止 fileName） */
export function buildGeneratedVideoContentUrl(params: {
  assetId: string;
  generationId?: string | null;
  projectId?: string | null;
  download?: boolean;
  shotNumber?: number | null;
}): string {
  const qs = new URLSearchParams();
  if (params.generationId) qs.set("generationId", params.generationId);
  if (params.projectId) qs.set("projectId", params.projectId);
  if (params.download) qs.set("download", "1");
  if (
    typeof params.shotNumber === "number" &&
    Number.isFinite(params.shotNumber) &&
    params.shotNumber > 0
  ) {
    qs.set("shotNumber", String(Math.floor(params.shotNumber)));
  }
  const query = qs.toString();
  return `/api/assets/${params.assetId}${query ? `?${query}` : ""}`;
}
