import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import {
  updateConnection,
  isSupportedProviderMode,
  listConnectionsPublic,
} from "@/ai-config/model-connections";
import { aiConfigErrorResponse } from "@/app/api/admin/ai-admin-helpers";

type RouteContext = { params: Promise<{ connectionId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;
  const { connectionId } = await context.params;
  const connections = await listConnectionsPublic();
  const connection = connections.find((c) => c.id === connectionId);
  if (!connection) {
    return NextResponse.json({ error: "模型连接不存在" }, { status: 404 });
  }
  return NextResponse.json({ connection });
}

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;
  const { connectionId } = await context.params;
  try {
    const body = (await request.json()) as {
      displayName?: string;
      providerMode?: string;
      baseUrl?: string | null;
      endpointPath?: string | null;
      modelId?: string | null;
      endpointId?: string | null;
      enabled?: boolean;
      apiKey?: string;
      clearApiKey?: boolean;
      timeoutMs?: number | null;
    };
    if (body.providerMode && !isSupportedProviderMode(body.providerMode)) {
      return NextResponse.json({ error: "无效的 Provider 模式" }, { status: 400 });
    }
    const updated = await updateConnection(
      connectionId,
      {
        displayName: body.displayName,
        providerMode: body.providerMode as "mock" | "http" | "aliyun-wan27" | undefined,
        baseUrl: body.baseUrl,
        endpointPath: body.endpointPath,
        modelId: body.modelId,
        endpointId: body.endpointId,
        enabled: body.enabled,
        apiKey: body.apiKey,
        clearApiKey: body.clearApiKey,
        timeoutMs: body.timeoutMs,
      },
      auth.user.id,
    );
    return NextResponse.json({ connection: updated });
  } catch (err) {
    return aiConfigErrorResponse(err, "更新模型连接失败");
  }
}
