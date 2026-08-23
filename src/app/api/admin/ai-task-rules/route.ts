import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import { AI_CAPABILITIES } from "@/ai-config/capabilities";
import {
  checkRule,
  getEffectivePublishedRule,
  listAllRuleSummaries,
} from "@/ai-config/task-rules-store";
import { getBuiltinTaskRule } from "@/ai-config/builtin-task-rules";
import {
  listTaskRuleMigrationNotices,
  migrateMisboundEpisodeDesignTaskRules,
} from "@/ai-config/migrate-misbound-episode-design-rules";
import { migrateAssetExtractionSlotBindings } from "@/ai-config/migrate-asset-extraction-slot-bindings";
import { migrateStyPlatformAssetExtractTaskRules } from "@/ai-config/migrate-sty-platform-asset-extract-task-rules";

export async function GET() {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;

  const migrationHints: string[] = [];
  try {
    const migrated = await migrateMisboundEpisodeDesignTaskRules();
    if (migrated.ran && migrated.adminHint) {
      migrationHints.push(migrated.adminHint);
    }
  } catch {
    /* non-fatal */
  }
  try {
    const slotMigrated = await migrateAssetExtractionSlotBindings();
    if (slotMigrated.ran && slotMigrated.adminHint) {
      migrationHints.push(slotMigrated.adminHint);
    }
  } catch {
    /* non-fatal */
  }
  try {
    const styRules = await migrateStyPlatformAssetExtractTaskRules();
    if (styRules.ran && styRules.adminHint) {
      migrationHints.push(styRules.adminHint);
    }
  } catch {
    /* non-fatal */
  }

  const migrationHint = migrationHints.length > 0 ? migrationHints.join("\n") : null;

  const notices = await listTaskRuleMigrationNotices();
  const latestNotice = notices[0] ?? null;

  const summaries = await listAllRuleSummaries();
  const capabilities = await Promise.all(
    AI_CAPABILITIES.filter((cap) => cap.status !== "deprecated").map(
      async (cap) => {
        const summary = summaries.find((s) => s.capabilityId === cap.id);
        const effective = await getEffectivePublishedRule(cap.id);
        const contractCheck = checkRule(effective.content, cap.id);
        const contractConflicts = contractCheck.errors.filter(
          (e) => e.code === "OUTPUT_CONTRACT_CONFLICT",
        );
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
          outputContractConflict: contractConflicts.length > 0,
          outputContractConflictMessage:
            contractConflicts[0]?.message ?? null,
        };
      },
    ),
  );
  return NextResponse.json({
    capabilities,
    migrationHint:
      migrationHint ??
      (latestNotice?.designPromptAction === "skipped_existing_different"
        ? latestNotice.adminHint
        : null),
    migrationNotice: latestNotice,
  });
}
