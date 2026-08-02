import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import {
  createConnection,
  listConnectionsPublic,
  type CreateConnectionInput,
  isSupportedProviderMode,
} from "@/ai-config/model-connections";
import { aiConfigErrorResponse } from "@/app/api/admin/ai-admin-helpers";
import type { AiModality } from "@/ai-config/capabilities";

export async function GET() {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;
  const connections = await listConnectionsPublic();
  return NextResponse.json({ connections });
}

export async function POST(request: Request) {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as Partial<CreateConnectionInput>;
    if (!body.displayName?.trim()) {
      return NextResponse.json({ error: "缺少配置名称" }, { status: 400 });
    }
    if (!body.modality || !["text", "image", "audio", "video"].includes(body.modality)) {
      return NextResponse.json({ error: "无效的模型类型" }, { status: 400 });
    }
    if (!body.providerMode || !isSupportedProviderMode(body.providerMode)) {
      return NextResponse.json({ error: "无效的 Provider 模式" }, { status: 400 });
    }
    const created = await createConnection(
      {
        displayName: body.displayName,
        modality: body.modality as AiModality,
        providerMode: body.providerMode,
        baseUrl: body.baseUrl,
        endpointPath: body.endpointPath,
        modelId: body.modelId,
        endpointId: body.endpointId,
        enabled: body.enabled,
        apiKey: body.apiKey,
        timeoutMs: body.timeoutMs,
      },
      auth.user.id,
    );
    return NextResponse.json({ connection: created });
  } catch (err) {
    return aiConfigErrorResponse(err, "创建模型连接失败");
  }
}
