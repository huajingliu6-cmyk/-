/**
 * 日志 / 客户端摘要：去掉 query、fragment；path 只保留固定长度摘要。
 * 绝不输出签名参数。
 */
export function redactRemoteUrlForLogs(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname || "/";
    const pathDigest =
      path.length <= 48
        ? path
        : `${path.slice(0, 24)}…(${path.length}chars)…${path.slice(-12)}`;
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}${pathDigest}`;
  } catch {
    return "[invalid-url]";
  }
}

export function summarizeRemoteUrlForClient(url: string | null | undefined): {
  hasRemoteVideo: boolean;
  remoteVideoSummary: string | null;
} {
  if (!url) {
    return { hasRemoteVideo: false, remoteVideoSummary: null };
  }
  return {
    hasRemoteVideo: true,
    remoteVideoSummary: redactRemoteUrlForLogs(url),
  };
}
