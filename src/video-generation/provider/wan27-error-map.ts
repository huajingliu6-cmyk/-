/**
 * 万相 / 百炼 Provider 错误 → 安全中文提示。
 * 不向用户返回完整 Provider 响应、密钥、签名 URL、磁盘路径或堆栈。
 */

export type Wan27MappedError = {
  /** 稳定内部码（可记日志） */
  code: string;
  /** 面向普通用户的简洁中文 */
  userMessage: string;
  /** 可选：官方/原始错误码（脱敏后可给管理员） */
  providerCode?: string;
  /** 可选：request_id（不含敏感 payload） */
  requestId?: string;
};

const GENERIC_USER_MESSAGE = "视频生成服务暂时不可用，请稍后重试或联系管理员。";

function truncateMessage(raw: string | undefined, max = 200): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

/**
 * 将 HTTP 状态、Provider code、message 映射为安全中文错误。
 * 不回传完整 message 原文给用户（仅用于模式匹配）。
 */
export function mapWan27ProviderError(input: {
  httpStatus?: number;
  code?: string;
  message?: string;
  requestId?: string;
  context?:
    | "submit"
    | "status"
    | "cancel"
    | "transfer"
    | "unknownOutcome"
    | "config";
}): Wan27MappedError {
  const codeRaw = (input.code ?? "").trim();
  const codeLower = codeRaw.toLowerCase();
  const msg = (input.message ?? "").toLowerCase();
  const status = input.httpStatus;
  const requestId = input.requestId?.trim() || undefined;

  const withMeta = (
    code: string,
    userMessage: string,
  ): Wan27MappedError => ({
    code,
    userMessage,
    providerCode: codeRaw || undefined,
    requestId,
  });

  if (input.context === "unknownOutcome") {
    return withMeta(
      "GENERATION_SUBMISSION_UNKNOWN",
      "提交结果暂时无法确认，为避免重复计费，系统已暂停自动重试。",
    );
  }

  if (input.context === "config") {
    if (codeLower.includes("api_key") || codeRaw === "MISSING_DASHSCOPE_API_KEY") {
      return withMeta("MISSING_DASHSCOPE_API_KEY", "未配置百炼 API Key，请由管理员在服务端填写。");
    }
    if (
      codeLower.includes("workspace") ||
      codeRaw === "MISSING_DASHSCOPE_WORKSPACE_ID"
    ) {
      return withMeta(
        "MISSING_DASHSCOPE_WORKSPACE_ID",
        "未配置业务空间 ID，请填写与 API Key 同一地域的 Workspace。",
      );
    }
  }

  if (codeRaw === "MISSING_TASK_ID" || msg.includes("missing task_id")) {
    return withMeta(
      "PROVIDER_MISSING_TASK_ID",
      "创建任务失败：未返回任务 ID，请勿重复提交。",
    );
  }

  // —— 鉴权 / 权限 ——
  if (
    status === 401 ||
    codeLower === "invalidapikey" ||
    codeLower === "invalid_api_key" ||
    msg.includes("no api-key") ||
    msg.includes("invalid api-key") ||
    msg.includes("incorrect api key")
  ) {
    if (msg.includes("no api-key") || msg.includes("not provided")) {
      return withMeta("PROVIDER_API_KEY_MISSING", "百炼 API Key 缺失，请由管理员配置后重试。");
    }
    return withMeta("PROVIDER_API_KEY_INVALID", "百炼 API Key 无效，请检查密钥是否正确且属于同一地域。");
  }

  if (
    codeLower.includes("workspace.accessdenied") ||
    codeLower.includes("endpoint.accessdenied") ||
    (msg.includes("workspace") && msg.includes("not authorized"))
  ) {
    return withMeta(
      "PROVIDER_WORKSPACE_REGION_MISMATCH",
      "业务空间与地域不一致或无权访问，请确认 API Key、Workspace 与 Endpoint 属于同一地域。",
    );
  }

  if (
    status === 403 ||
    codeLower === "accessdenied" ||
    codeLower === "access_denied" ||
    codeLower.includes("model.accessdenied") ||
    codeLower.includes("app.accessdenied")
  ) {
    if (msg.includes("synchronous") || msg.includes("async")) {
      return withMeta(
        "PROVIDER_ASYNC_HEADER_REQUIRED",
        "请求缺少异步标志，请联系管理员检查服务配置。",
      );
    }
    return withMeta("PROVIDER_ACCESS_DENIED", "当前账号无权调用该模型或接口。");
  }

  // —— 模型 ——
  if (
    status === 404 ||
    codeLower === "modelnotfound" ||
    codeLower === "model_not_found" ||
    msg.includes("model not found") ||
    msg.includes("does not exist")
  ) {
    return withMeta("PROVIDER_MODEL_NOT_FOUND", "指定的视频模型不存在或不可用。");
  }

  if (
    codeLower.includes("model.accessdenied") ||
    msg.includes("model is not available") ||
    msg.includes("model unavailable")
  ) {
    return withMeta("PROVIDER_MODEL_UNAVAILABLE", "指定的视频模型当前不可用。");
  }

  // —— 参数 / 素材 ——
  if (
    codeLower.startsWith("invalidparameter") ||
    codeLower === "invalidparameter" ||
    msg.includes("invalid parameter")
  ) {
    if (msg.includes("prompt") && (msg.includes("length") || msg.includes("too long"))) {
      return withMeta("PROVIDER_PROMPT_TOO_LONG", "提示词过长，请缩短后重试。");
    }
    if (
      msg.includes("format") ||
      msg.includes("media format") ||
      msg.includes("file format")
    ) {
      return withMeta("PROVIDER_MEDIA_FORMAT_INVALID", "参考素材格式不符合模型要求。");
    }
    if (
      msg.includes("size") ||
      msg.includes("too large") ||
      msg.includes("file size")
    ) {
      return withMeta("PROVIDER_MEDIA_SIZE_EXCEEDED", "参考素材大小超过限制。");
    }
    if (
      msg.includes("download") ||
      msg.includes("url error") ||
      msg.includes("unable to download") ||
      msg.includes("media resource")
    ) {
      return withMeta("PROVIDER_MEDIA_UNREACHABLE", "参考素材不可访问，请检查素材地址后重试。");
    }
    return withMeta("PROVIDER_INVALID_PARAMETER", "生成参数不符合模型要求，请检查分辨率、比例与时长。");
  }

  if (
    msg.includes("prompt") &&
    (msg.includes("exceed") || msg.includes("too long") || msg.includes("最大"))
  ) {
    return withMeta("PROVIDER_PROMPT_TOO_LONG", "提示词过长，请缩短后重试。");
  }

  // —— 内容审核 ——
  if (
    codeLower.includes("datainspection") ||
    codeLower === "datainspectionfailed" ||
    msg.includes("inappropriate content") ||
    msg.includes("data inspection")
  ) {
    return withMeta(
      "PROVIDER_CONTENT_BLOCKED",
      "内容未通过审核，请修改提示词或素材后重试。",
    );
  }

  // —— 限流 / 并发 ——
  if (
    status === 429 ||
    codeLower.startsWith("throttling") ||
    msg.includes("rate limit") ||
    msg.includes("requests rate limit")
  ) {
    if (
      codeLower.includes("allocationquota") ||
      msg.includes("allocated quota") ||
      msg.includes("concurrent")
    ) {
      return withMeta(
        "PROVIDER_CONCURRENCY_LIMIT",
        "请求过于频繁或并发已达上限，请稍后再试。",
      );
    }
    return withMeta("PROVIDER_RATE_LIMITED", "请求过于频繁，请稍后再试。");
  }

  // —— 计费 ——
  if (
    codeLower === "arrearage" ||
    codeLower.includes("prepaidbilloverdue") ||
    codeLower.includes("postpaidbilloverdue") ||
    msg.includes("good standing") ||
    msg.includes("insufficient balance") ||
    msg.includes("run out of credits")
  ) {
    return withMeta("PROVIDER_INSUFFICIENT_BALANCE", "账户余额不足或已欠费，请充值后再试。");
  }

  if (
    codeLower.includes("freetier") ||
    codeLower.includes("freequota") ||
    msg.includes("free quota") ||
    msg.includes("free tier")
  ) {
    return withMeta("PROVIDER_FREE_QUOTA_EXHAUSTED", "免费额度已用尽，请开通计费或更换模型。");
  }

  // —— 取消 ——
  if (codeLower === "unsupportedoperation" || msg.includes("pending status")) {
    return withMeta(
      "PROVIDER_CANCEL_NOT_ALLOWED",
      "仅排队中（PENDING）的任务可以取消。",
    );
  }

  // —— 任务状态 / 过期 ——
  if (codeRaw === "UNKNOWN" || msg.includes("task_status") && msg.includes("unknown")) {
    return withMeta(
      "PROVIDER_TASK_UNKNOWN",
      "任务不存在或已过期，请勿自动重试同一任务。",
    );
  }

  if (
    msg.includes("task") &&
    (msg.includes("not found") || msg.includes("does not exist") || msg.includes("expired"))
  ) {
    if (msg.includes("expired") || msg.includes("24")) {
      return withMeta(
        "PROVIDER_TASK_ID_EXPIRED",
        "任务 ID 已过期（通常约 24 小时），无法继续查询。",
      );
    }
    return withMeta("PROVIDER_TASK_ID_NOT_FOUND", "任务 ID 不存在或无法查询。");
  }

  // —— 结果转存相关（本地错误码） ——
  if (codeRaw === "RESULT_HOST_ALLOWLIST_NOT_CONFIGURED") {
    return withMeta(
      "RESULT_HOST_ALLOWLIST_NOT_CONFIGURED",
      "尚未配置真实视频结果域名白名单，已阻止服务器下载远程结果。",
    );
  }
  if (codeRaw === "RESULT_HOST_NOT_ALLOWED") {
    return withMeta(
      "RESULT_HOST_NOT_ALLOWED",
      "远程结果域名不在白名单中，已阻止下载。",
    );
  }
  if (
    codeRaw === "RESULT_URL_EXPIRED" ||
    (msg.includes("result url") && msg.includes("expired")) ||
    (msg.includes("expires") && msg.includes("video"))
  ) {
    return withMeta(
      "RESULT_URL_EXPIRED",
      "结果视频链接已过期（通常约 24 小时），无法转存。",
    );
  }
  if (
    codeRaw === "RESULT_TRANSFER_FAILED" ||
    codeRaw.startsWith("RESULT_") ||
    codeRaw === "TRANSFER_SOURCE_MISMATCH" ||
    codeRaw === "NO_REMOTE_URL"
  ) {
    return withMeta(
      codeRaw || "RESULT_TRANSFER_FAILED",
      "结果视频转存失败，可在远程链接过期前使用转存重试（不会新建付费任务）。",
    );
  }

  // —— 超时 / 服务端 ——
  if (
    codeLower === "requesttimeout" ||
    codeLower.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    input.context === "submit" && status === 504
  ) {
    return withMeta("PROVIDER_REQUEST_TIMEOUT", "请求超时，请稍后查询任务状态，勿立即重复提交。");
  }

  if (status !== undefined && status >= 500) {
    return withMeta("PROVIDER_SERVER_ERROR", "百炼服务暂时异常，请稍后重试。");
  }

  if (status !== undefined && status >= 400) {
    return withMeta(
      `PROVIDER_HTTP_${status}`,
      GENERIC_USER_MESSAGE,
    );
  }

  if (codeRaw) {
    return withMeta(
      `PROVIDER_${codeRaw.toUpperCase().replace(/[^A-Z0-9_.]/gi, "_").slice(0, 64)}`,
      GENERIC_USER_MESSAGE,
    );
  }

  const safeHint = truncateMessage(input.message, 80);
  return {
    code: "PROVIDER_UNKNOWN_ERROR",
    userMessage: GENERIC_USER_MESSAGE,
    providerCode: codeRaw || undefined,
    requestId,
    // 故意不把 safeHint 暴露给用户；仅保留结构扩展点
    ...(safeHint ? {} : {}),
  };
}

export function mapWan27HttpStatusToHint(status: number): string {
  return mapWan27ProviderError({ httpStatus: status }).userMessage;
}
