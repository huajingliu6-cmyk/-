import type { GenerationRecord } from "../types";
import { summarizeRemoteUrlForClient } from "./redact-url";

/**
 * 面向客户端的 Generation 视图：不返回完整签名 remoteVideoUrl。
 * 服务端磁盘记录仍保留完整 URL 供转存重试。
 */
export type ClientGenerationRecord = Omit<GenerationRecord, "remoteVideoUrl"> & {
  remoteVideoUrl: null;
  hasRemoteVideo: boolean;
  remoteVideoSummary: string | null;
};

export function sanitizeGenerationForClient(
  record: GenerationRecord,
): ClientGenerationRecord {
  const summary = summarizeRemoteUrlForClient(record.remoteVideoUrl);
  return {
    ...record,
    remoteVideoUrl: null,
    hasRemoteVideo: summary.hasRemoteVideo,
    remoteVideoSummary: summary.remoteVideoSummary,
  };
}
