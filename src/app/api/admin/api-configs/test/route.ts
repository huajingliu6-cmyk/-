import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import {
  getGenerationApiConfig,
  isGenerationApiId,
  isPlausibleApiKey,
  type GenerationApiId,
} from "@/auth/api-config";

/**
 * Test a saved connection only — no arbitrary URL from the request body.
 * Mock: no network. HTTP: minimal HEAD/GET with short timeout (no user content).
 */
export async function POST(request: Request) {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;

  let body: {
    connectionId?: string;
    id?: string;
    confirmPaidTest?: boolean;
  };
  try {
    body = (await request.json()) as {
      connectionId?: string;
      id?: string;
      confirmPaidTest?: boolean;
    };
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const id = body.connectionId ?? body.id;
  if (!id || !isGenerationApiId(id)) {
    return NextResponse.json({ error: "无效的连接 ID" }, { status: 400 });
  }

  const started = Date.now();
  const config = await getGenerationApiConfig(id as GenerationApiId);

  if (config.provider === "mock") {
    return NextResponse.json({
      success: true,
      status: "ok",
      latencyMs: Date.now() - started,
      errorCode: null,
      testedAt: new Date().toISOString(),
      note: "Mock 连接测试不访问外部网络",
    });
  }

  if (!config.apiUrl.trim()) {
    return NextResponse.json({
      success: false,
      status: "missing_url",
      latencyMs: Date.now() - started,
      errorCode: "AI_CONFIGURATION_INVALID",
      testedAt: new Date().toISOString(),
    });
  }

  if (!isPlausibleApiKey(config.apiKey)) {
    return NextResponse.json({
      success: false,
      status: "missing_key",
      latencyMs: Date.now() - started,
      errorCode: "AI_PROVIDER_CREDENTIAL_MISSING",
      testedAt: new Date().toISOString(),
    });
  }

  if (!body.confirmPaidTest) {
    return NextResponse.json(
      {
        success: false,
        status: "confirm_required",
        latencyMs: Date.now() - started,
        errorCode: "PAID_TEST_CONFIRM_REQUIRED",
        testedAt: new Date().toISOString(),
        note: "HTTP 测试可能产生 Provider 费用，请显式确认",
      },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(config.apiUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal,
    });
    return NextResponse.json({
      success: res.status < 500,
      status: `http_${res.status}`,
      latencyMs: Date.now() - started,
      errorCode: res.status >= 500 ? "PROVIDER_HTTP_ERROR" : null,
      testedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      success: false,
      status: "network_error",
      latencyMs: Date.now() - started,
      errorCode: "NETWORK_ERROR",
      testedAt: new Date().toISOString(),
    });
  } finally {
    clearTimeout(timer);
  }
}
