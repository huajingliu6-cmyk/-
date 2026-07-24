import type { GenerationRecord, VideoProviderId } from "../types";
import { TransferError } from "./errors";
import type { TransferSource } from "./types";

/**
 * 由服务端 GenerationRecord 派生 TransferSource。
 * 禁止仅凭 URL scheme 判定；providerId / isMock / URL 必须一致。
 */
export function buildTransferSourceFromGeneration(
  record: Pick<
    GenerationRecord,
    "providerId" | "isMock" | "remoteVideoUrl"
  >,
): TransferSource {
  const url = record.remoteVideoUrl;
  if (!url) {
    throw new TransferError("NO_REMOTE_URL");
  }

  if (record.providerId === "mock") {
    if (!record.isMock) {
      throw new TransferError("TRANSFER_SOURCE_MISMATCH");
    }
    if (!url.startsWith("file://")) {
      throw new TransferError(
        "TRANSFER_SOURCE_MISMATCH",
        "Mock 任务只能转存本地 file:// 中间文件",
      );
    }
    return {
      kind: "mockFile",
      providerId: "mock",
      fileUrl: url,
    };
  }

  if (record.providerId === "aliyun-wan27") {
    if (record.isMock) {
      throw new TransferError("TRANSFER_SOURCE_MISMATCH");
    }
    if (url.startsWith("file://")) {
      throw new TransferError(
        "TRANSFER_SOURCE_MISMATCH",
        "真实 Provider 不能使用本地 file:// 路径",
      );
    }
    return {
      kind: "providerHttps",
      providerId: "aliyun-wan27",
      remoteUrl: url,
    };
  }

  throw new TransferError(
    "TRANSFER_SOURCE_MISMATCH",
    `不支持的 Provider：${record.providerId as VideoProviderId}`,
  );
}
