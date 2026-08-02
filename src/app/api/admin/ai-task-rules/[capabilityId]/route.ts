import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import {
  getEffectivePublishedRule,
  getRuleRecord,
} from "@/ai-config/task-rules-store";
import { getBuiltinTaskRule } from "@/ai-config/builtin-task-rules";
import {
  aiConfigErrorResponse,
  parseCapabilityId,
} from "@/app/api/admin/ai-admin-helpers";

type RouteContext = { params: Promise<{ capabilityId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;
  const { capabilityId: raw } = await context.params;
  const capabilityId = parseCapabilityId(raw);
  if (!capabilityId) {
    return NextResponse.json({ error: "无效的 capabilityId" }, { status: 400 });
  }
  try {
    const record = await getRuleRecord(capabilityId);
    const effective = await getEffectivePublishedRule(capabilityId);
    const published =
      record.publishedVersion !== null
        ? record.versions.find((v) => v.version === record.publishedVersion) ??
          null
        : null;
    return NextResponse.json({
      capabilityId,
      draft: record.draft,
      published,
      effective,
      builtinRule: getBuiltinTaskRule(capabilityId),
      publishedVersion: record.publishedVersion,
    });
  } catch (err) {
    return aiConfigErrorResponse(err);
  }
}
