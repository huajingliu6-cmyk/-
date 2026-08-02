import type { VideoProviderId } from "../types";

/**
 * 服务端转存来源。必须由 GenerationRecord 派生，客户端不可构造。
 * 禁止仅根据 URL scheme 自动判定 Mock / Provider。
 */
export type TransferSource =
  | {
      kind: "mockFile";
      providerId: "mock" | "http";
      fileUrl: string;
    }
  | {
      kind: "providerHttps";
      providerId: "aliyun-wan27" | "http";
      remoteUrl: string;
    }
  | {
      kind: "remoteProviderBlob";
      providerId: "http";
      remoteBlobUrl: string;
    };

export type AllowedHostRule =
  | { mode: "exact"; host: string }
  | { mode: "suffix"; base: string };

export const MAX_PROVIDER_VIDEO_BYTES = 200 * 1024 * 1024;
export const MAX_PROVIDER_RESULT_URL_LENGTH = 4096;
export const MAX_PROVIDER_REDIRECTS = 3;
/** 整体下载超时（含重定向与读 body） */
export const PROVIDER_DOWNLOAD_TIMEOUT_MS = 120_000;
/** 单次连接/响应头超时 */
export const PROVIDER_CONNECT_TIMEOUT_MS = 30_000;

export type ProviderIdForTransfer = Extract<
  VideoProviderId,
  "mock" | "aliyun-wan27" | "http"
>;
