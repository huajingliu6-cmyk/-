import {
  STY_ASSET_DETAIL_EXTRACT_TASK_RULE,
  STY_ASSET_ROSTER_EXTRACT_TASK_RULE,
} from "@/ai-config/sty-platform-asset-extract-task-rules";
import {
  checkRule,
  getEffectivePublishedRule,
  hashRuleContent,
  publishRule,
  saveDraft,
} from "@/ai-config/task-rules-store";

const CAPABILITIES = [
  {
    capabilityId: "asset.roster.extract" as const,
    content: STY_ASSET_ROSTER_EXTRACT_TASK_RULE,
    sourceFileName: "sty平台资产提取skill.md（阶段一）",
  },
  {
    capabilityId: "asset.detail.extract" as const,
    content: STY_ASSET_DETAIL_EXTRACT_TASK_RULE,
    sourceFileName: "sty平台资产提取skill.md（阶段二）",
  },
];

export type StyPlatformAssetExtractTaskRuleMigrationResult = {
  ran: boolean;
  published: string[];
  skipped: string[];
  adminHint: string | null;
};

async function seedOne(
  input: (typeof CAPABILITIES)[number],
  userId: string,
): Promise<"published" | "skipped"> {
  const expectedHash = hashRuleContent(input.content);
  const effective = await getEffectivePublishedRule(input.capabilityId);
  if (
    effective.source === "custom" &&
    effective.contentHash === expectedHash
  ) {
    return "skipped";
  }

  const check = checkRule(input.content, input.capabilityId);
  if (check.errors.length > 0) {
    throw new Error(
      `${input.capabilityId}: ${check.errors.map((e) => e.message).join("；")}`,
    );
  }

  await saveDraft(
    input.capabilityId,
    input.content,
    "markdown",
    input.sourceFileName,
    null,
    userId,
  );
  await publishRule(
    input.capabilityId,
    null,
    `sty-platform-asset-extract:${input.capabilityId}:${expectedHash.slice(0, 16)}`,
    userId,
  );
  return "published";
}

/** Publish STY roster/detail task rules from the bundled skill pack when missing or outdated. */
export async function migrateStyPlatformAssetExtractTaskRules(
  userId = "system:sty-platform-asset-extract-rules",
): Promise<StyPlatformAssetExtractTaskRuleMigrationResult> {
  const published: string[] = [];
  const skipped: string[] = [];

  for (const item of CAPABILITIES) {
    const outcome = await seedOne(item, userId);
    if (outcome === "published") published.push(item.capabilityId);
    else skipped.push(item.capabilityId);
  }

  if (published.length === 0) {
    return { ran: false, published, skipped, adminHint: null };
  }

  return {
    ran: true,
    published,
    skipped,
    adminHint: `已自动发布 STY 资产提取任务规则：${published
      .map((id) => (id === "asset.roster.extract" ? "名单阶段" : "详情阶段"))
      .join("、")}。可在连接详情或能力规则页查看与微调。`,
  };
}
