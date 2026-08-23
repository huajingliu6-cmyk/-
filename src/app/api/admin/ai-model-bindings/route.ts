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
import { migrateAssetExtractionSlotBindings } from "@/ai-config/migrate-asset-extraction-slot-bindings";
import { migrateStyPlatformAssetExtractTaskRules } from "@/ai-config/migrate-sty-platform-asset-extract-task-rules";

export async function GET() {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;

  let migrationHint: string | null = null;
  const hints: string[] = [];
  try {
    const migrated = await migrateAssetExtractionSlotBindings();
    if (migrated.ran && migrated.adminHint) {
      hints.push(migrated.adminHint);
    }
  } catch {
    /* non-fatal */
  }
  try {
    const styRules = await migrateStyPlatformAssetExtractTaskRules();
    if (styRules.ran && styRules.adminHint) {
      hints.push(styRules.adminHint);
    }
  } catch {
    /* non-fatal */
  }
  if (hints.length > 0) {
    migrationHint = [...new Set(hints)].join("\n");
  }

  const bindings = await listSlotBindings();
  return NextResponse.json({
    bindings,
    slots: GENERATION_API_DEFS.map((d) => ({
      profileSlot: d.id,
      label: d.label,
    })),
    migrationHint,
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
