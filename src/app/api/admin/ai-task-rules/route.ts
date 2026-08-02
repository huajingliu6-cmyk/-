import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import { AI_CAPABILITIES } from "@/ai-config/capabilities";
import {
  getEffectivePublishedRule,
  listAllRuleSummaries,
} from "@/ai-config/task-rules-store";
import { getBuiltinTaskRule } from "@/ai-config/builtin-task-rules";

export async function GET() {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;
  const summaries = await listAllRuleSummaries();
  const capabilities = await Promise.all(
    AI_CAPABILITIES.filter((cap) => cap.status !== "deprecated").map(
      async (cap) => {
        const summary = summaries.find((s) => s.capabilityId === cap.id);
        const effective = await getEffectivePublishedRule(cap.id);
        return {
          capabilityId: cap.id,
          label: cap.label,
          modality: cap.modality,
          status: cap.status,
          defaultProfileSlot: cap.defaultProfileSlot,
          hasDraft: summary?.hasDraft ?? false,
          draftRevision: summary?.draftRevision ?? null,
          publishedVersion: summary?.publishedVersion ?? null,
          publishedSource: summary?.publishedSource ?? "builtin",
          versionCount: summary?.versionCount ?? 0,
          effectiveRulePreview: effective.content.slice(0, 200),
          builtinRuleLength: getBuiltinTaskRule(cap.id).length,
        };
      },
    ),
  );
  return NextResponse.json({ capabilities });
}
