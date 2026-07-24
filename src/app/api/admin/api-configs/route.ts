import { NextResponse } from "next/server";
import {
  listGenerationApiConfigs,
  toPublicConfig,
  updateGenerationApiConfig,
  type GenerationApiId,
  type GenerationApiProvider,
} from "@/auth/api-config";
import { requireAdminUser } from "@/auth/require-user";

export async function GET() {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;
  const configs = await listGenerationApiConfigs();
  return NextResponse.json({
    configs: configs.map(toPublicConfig),
  });
}

export async function PUT(request: Request) {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as {
      id?: string;
      provider?: GenerationApiProvider;
      apiUrl?: string;
      apiKey?: string | null;
      clearApiKey?: boolean;
    };

    const id = body.id as GenerationApiId | undefined;
    if (
      id !== "character-image" &&
      id !== "character-voice" &&
      id !== "scene-image" &&
      id !== "video-shot"
    ) {
      return NextResponse.json({ error: "无效的生成能力 ID" }, { status: 400 });
    }

    const updated = await updateGenerationApiConfig(id, {
      provider: body.provider,
      apiUrl: body.apiUrl,
      apiKey: body.clearApiKey ? null : body.apiKey,
    });

    return NextResponse.json({ config: toPublicConfig(updated) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "保存 API 配置失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
