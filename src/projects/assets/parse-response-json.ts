/**
 * Safely parse a fetch Response body as JSON.
 * Empty / non-JSON bodies become user-facing Chinese errors (never raw SyntaxError).
 * HTTP 204 / 202 with empty body return null (cast as T) — treat as accepted / no content.
 */

export type ParseResponseJsonOptions = {
  /** When true, empty body on any status returns null instead of throwing. */
  allowEmpty?: boolean;
};

function responseMeta(response: Response, text: string) {
  const requestId =
    response.headers.get("x-request-id") ||
    response.headers.get("x-correlation-id") ||
    "";
  return {
    status: response.status,
    url: response.url,
    contentType: response.headers.get("content-type") || undefined,
    requestId: requestId || undefined,
    bodyLength: text.length,
  };
}

export async function parseResponseJson<T = unknown>(
  response: Response,
  options: ParseResponseJsonOptions = {},
): Promise<T> {
  const text = await response.text();
  const allowEmpty =
    options.allowEmpty === true ||
    response.status === 204 ||
    response.status === 202;

  if (!text.trim()) {
    if (allowEmpty) {
      return null as T;
    }
    console.error(
      "[parseResponseJson] empty response",
      responseMeta(response, text),
    );
    throw new Error("服务器没有返回有效数据，请稍后重试。");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    console.error("[parseResponseJson] non-json response", {
      ...responseMeta(response, text),
      bodyPreview: text.slice(0, 200),
    });
    throw new Error(`服务器返回了无效响应（status=${response.status}）`);
  }
}

/** Alias: empty body → null; otherwise JSON or throw. */
export async function readJsonIfPresent<T = unknown>(
  response: Response,
): Promise<T | null> {
  return parseResponseJson<T | null>(response, { allowEmpty: true });
}
