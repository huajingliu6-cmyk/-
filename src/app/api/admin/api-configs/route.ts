import { NextResponse } from "next/server";
import {
  isGenerationApiId,
  listCapabilityBindings,
  listGenerationApiConfigs,
  toPublicConfig,
  updateCapabilityBinding,
  updateGenerationApiConfig,
  type GenerationApiId,
  type GenerationApiProvider,
} from "@/auth/api-config";
import { requireSystemAdmin } from "@/auth/require-access";
import { getAiCapability, type AiCapabilityId } from "@/ai-config/capabilities";
import { listAdminCapabilityDiagnostics } from "@/ai-config/resolve";

export async function GET() {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;
  const configs = await listGenerationApiConfigs();
  const bindings = await listCapabilityBindings();
  const diagnostics = await listAdminCapabilityDiagnostics();
  return NextResponse.json({
    configs: configs.map(toPublicConfig),
    bindings,
    capabilities: diagnostics,
  });
}

export async function PUT(request: Request) {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as {
      action?: string;
      id?: string;
      provider?: GenerationApiProvider;
      apiUrl?: string;
      apiKey?: string | null;
      model?: string;
      enabled?: boolean;
      clearApiKey?: boolean;
      capabilityId?: string;
      profileSlotId?: string | null;
      bindingEnabled?: boolean;
    };

    if (body.action === "update_binding") {
      const capabilityId = body.capabilityId as AiCapabilityId | undefined;
      if (!capabilityId || !getAiCapability(capabilityId)) {
        return NextResponse.json({ error: "无效的 capabilityId" }, { status: 400 });
      }
      const profileSlotId =
        body.profileSlotId === null
          ? null
          : body.profileSlotId === undefined
            ? undefined
            : isGenerationApiId(body.profileSlotId)
              ? body.profileSlotId
              : null;
      if (
        body.profileSlotId !== undefined &&
        body.profileSlotId !== null &&
        !isGenerationApiId(body.profileSlotId)
      ) {
        return NextResponse.json({ error: "无效的模型配置槽位" }, { status: 400 });
      }
      const binding = await updateCapabilityBinding(
        capabilityId,
        {
          profileSlotId,
          enabled: body.bindingEnabled,
        },
        auth.user.id,
      );
      const diagnostics = await listAdminCapabilityDiagnostics();
      return NextResponse.json({ binding, capabilities: diagnostics });
    }

    const id = body.id as GenerationApiId | undefined;
    if (!id || !isGenerationApiId(id)) {
      return NextResponse.json({ error: "无效的生成能力 ID" }, { status: 400 });
    }

    const updated = await updateGenerationApiConfig(
      id,
      {
        provider: body.provider,
        apiUrl: body.apiUrl,
        apiKey: body.clearApiKey ? null : body.apiKey,
        model: body.model,
        enabled: body.enabled,
      },
      auth.user.id,
    );

    return NextResponse.json({
      config: toPublicConfig(updated),
      capabilities: await listAdminCapabilityDiagnostics(),
      bindings: await listCapabilityBindings(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "保存 API 配置失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
