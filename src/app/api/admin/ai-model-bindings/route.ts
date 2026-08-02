import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import {
  bindSlot,
  listSlotBindings,
} from "@/ai-config/model-connections";
import {
  GENERATION_API_DEFS,
  isGenerationApiId,
  type GenerationApiId,
} from "@/auth/api-config";
import { aiConfigErrorResponse } from "@/app/api/admin/ai-admin-helpers";

export async function GET() {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;
  const bindings = await listSlotBindings();
  return NextResponse.json({
    bindings,
    slots: GENERATION_API_DEFS.map((d) => ({
      profileSlot: d.id,
      label: d.label,
    })),
  });
}

export async function PUT(request: Request) {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as {
      profileSlot?: string;
      modelConnectionId?: string | null;
    };
    if (!body.profileSlot || !isGenerationApiId(body.profileSlot)) {
      return NextResponse.json({ error: "无效的 profileSlot" }, { status: 400 });
    }
    const binding = await bindSlot(
      body.profileSlot as GenerationApiId,
      body.modelConnectionId ?? null,
      auth.user.id,
    );
    return NextResponse.json({ binding });
  } catch (err) {
    return aiConfigErrorResponse(err, "绑定失败");
  }
}
