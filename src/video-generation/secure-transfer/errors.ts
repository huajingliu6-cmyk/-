/** 转存 / SSRF 相关结构化错误码（服务端保留；客户端只见中文 message） */
export type TransferErrorCode =
  | "RESULT_URL_INVALID"
  | "RESULT_URL_PROTOCOL_NOT_ALLOWED"
  | "RESULT_HOST_NOT_ALLOWED"
  | "RESULT_HOST_ALLOWLIST_NOT_CONFIGURED"
  | "RESULT_PRIVATE_ADDRESS_BLOCKED"
  | "RESULT_DNS_RESOLUTION_FAILED"
  | "RESULT_REDIRECT_NOT_ALLOWED"
  | "RESULT_TOO_MANY_REDIRECTS"
  | "RESULT_DOWNLOAD_TIMEOUT"
  | "RESULT_FILE_TOO_LARGE"
  | "RESULT_CONTENT_TYPE_INVALID"
  | "RESULT_CONTENT_LENGTH_MISMATCH"
  | "RESULT_VIDEO_STRUCTURE_INVALID"
  | "TRANSFER_SOURCE_MISMATCH"
  | "RESULT_TRANSFER_FAILED"
  | "NO_REMOTE_URL";

const MESSAGES: Record<TransferErrorCode, string> = {
  RESULT_URL_INVALID: "远程结果地址无效，已阻止下载。",
  RESULT_URL_PROTOCOL_NOT_ALLOWED: "远程结果地址协议不被允许，仅支持 HTTPS。",
  RESULT_HOST_NOT_ALLOWED: "远程结果域名不在白名单中，已阻止下载。",
  RESULT_HOST_ALLOWLIST_NOT_CONFIGURED:
    "尚未配置真实视频结果域名白名单，已阻止服务器下载远程结果。",
  RESULT_PRIVATE_ADDRESS_BLOCKED: "远程结果解析到不可信地址，已阻止下载。",
  RESULT_DNS_RESOLUTION_FAILED: "无法解析远程结果域名，已阻止下载。",
  RESULT_REDIRECT_NOT_ALLOWED: "远程结果重定向目标不被允许，已阻止下载。",
  RESULT_TOO_MANY_REDIRECTS: "远程结果重定向次数过多，已阻止下载。",
  RESULT_DOWNLOAD_TIMEOUT: "下载远程结果超时，已中止并清理临时文件。",
  RESULT_FILE_TOO_LARGE: "远程结果超过大小限制，已阻止下载。",
  RESULT_CONTENT_TYPE_INVALID: "远程结果 Content-Type 不是预期的视频类型。",
  RESULT_CONTENT_LENGTH_MISMATCH: "远程结果实际大小与 Content-Length 不一致。",
  RESULT_VIDEO_STRUCTURE_INVALID: "远程结果不是合法的 MP4 结构，已拒绝。",
  TRANSFER_SOURCE_MISMATCH: "转存来源与任务 Provider 不一致，已阻止下载。",
  RESULT_TRANSFER_FAILED: "结果视频转存失败。",
  NO_REMOTE_URL: "没有可转存的远程视频地址。",
};

export class TransferError extends Error {
  readonly code: TransferErrorCode;

  constructor(code: TransferErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = "TransferError";
    this.code = code;
  }
}

export function transferErrorMessage(code: TransferErrorCode): string {
  return MESSAGES[code];
}
