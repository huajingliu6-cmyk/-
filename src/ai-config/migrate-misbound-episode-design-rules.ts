import { promises as fs } from "fs";
import {
  getAiCapability,
  type AiCapabilityId,
} from "@/ai-config/capabilities";
import {
  findEpisodeDesignTaskRuleContractConflicts,
  looksLikeDesignPromptExtractionRule,
} from "@/ai-config/task-rule-contract-guard";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { resolveAppDataPath } from "@/persistence/data-root";
import {
  getEffectivePublishedRule,
  getRuleRecord,
  hashRuleContent,
  loadStore,
  publishRule,
  revertCapabilityToBuiltin,
  saveDraft,
} from "@/ai-config/task-rules-store";

function contentHash(content: string): string {
  return hashRuleContent(content);
}

export type EpisodeDesignRuleMigrationResult = {
  ran: boolean;
  episodeDesignReverted: boolean;
  designPromptAction:
    | "none"
    | "copied"
    | "skipped_identical"
    | "skipped_existing_different"
    | "already_migrated";
  contentHash: string | null;
  message: string | null;
  adminHint: string | null;
};

export type TaskRuleMigrationNotice = {
  id: string;
  at: string;
  fromCapability: AiCapabilityId;
  toCapability: AiCapabilityId;
  designPromptAction: EpisodeDesignRuleMigrationResult["designPromptAction"];
  message: string;
  adminHint: string;
};

type MigrationLog = {
  schemaVersion: 1;
  notices: TaskRuleMigrationNotice[];
};

const EPISODE_DESIGN: AiCapabilityId = "asset.episode-design.generate";
const DESIGN_PROMPT: AiCapabilityId = "asset.design-prompt.generate";
const MIGRATION_USER = "system:task-rule-migration";

let inFlight: Promise<EpisodeDesignRuleMigrationResult> | null = null;

function migrationLogPath(): string {
  return resolveAppDataPath("ai-task-rule-migrations.json");
}

async function readMigrationLog(): Promise<MigrationLog> {
  try {
    const raw = await fs.readFile(migrationLogPath(), "utf-8");
    const parsed = JSON.parse(raw) as MigrationLog;
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.notices)) {
      return { schemaVersion: 1, notices: [] };
    }
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { schemaVersion: 1, notices: [] };
    return { schemaVersion: 1, notices: [] };
  }
}

async function appendMigrationNotice(
  notice: TaskRuleMigrationNotice,
): Promise<void> {
  if (isRemoteDataOnly()) return;
  const log = await readMigrationLog();
  if (log.notices.some((n) => n.id === notice.id)) return;
  log.notices.push(notice);
  await fs.mkdir(resolveAppDataPath(), { recursive: true });
  const file = migrationLogPath();
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(log, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

export async function listTaskRuleMigrationNotices(): Promise<
  TaskRuleMigrationNotice[]
> {
  if (isRemoteDataOnly()) return [];
  const log = await readMigrationLog();
  return [...log.notices].sort((a, b) => (a.at < b.at ? 1 : -1));
}

/**
 * Idempotent repair: move mis-bound design-prompt rules off episode-design.
 * Never overwrites a different custom rule already published on design-prompt.
 */
export async function migrateMisboundEpisodeDesignTaskRules(): Promise<EpisodeDesignRuleMigrationResult> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      return await runMigration();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function runMigration(): Promise<EpisodeDesignRuleMigrationResult> {
  if (!getAiCapability(EPISODE_DESIGN) || !getAiCapability(DESIGN_PROMPT)) {
    return {
      ran: false,
      episodeDesignReverted: false,
      designPromptAction: "none",
      contentHash: null,
      message: null,
      adminHint: null,
    };
  }

  const episodeEffective = await getEffectivePublishedRule(EPISODE_DESIGN);
  if (episodeEffective.source !== "custom") {
    return {
      ran: false,
      episodeDesignReverted: false,
      designPromptAction: "none",
      contentHash: null,
      message: null,
      adminHint: null,
    };
  }

  const conflict = findEpisodeDesignTaskRuleContractConflicts(
    episodeEffective.content,
  );
  const looksLikePrompt = looksLikeDesignPromptExtractionRule(
    episodeEffective.content,
  );
  if (!conflict && !looksLikePrompt) {
    return {
      ran: false,
      episodeDesignReverted: false,
      designPromptAction: "none",
      contentHash: null,
      message: null,
      adminHint: null,
    };
  }

  const hash = contentHash(episodeEffective.content);
  const log = await readMigrationLog();
  if (log.notices.some((n) => n.id === hash)) {
    // Already migrated this content once; if episode-design is still custom+conflict, revert again.
    if (conflict) {
      await revertCapabilityToBuiltin(EPISODE_DESIGN, MIGRATION_USER);
      return {
        ran: true,
        episodeDesignReverted: true,
        designPromptAction: "already_migrated",
        contentHash: hash,
        message: "已再次将冲突的资产提取规则恢复为内置。",
        adminHint:
          "资产提取能力已恢复内置规则。请在「素材提示词生成」核对任务规则归属。",
      };
    }
    return {
      ran: false,
      episodeDesignReverted: false,
      designPromptAction: "already_migrated",
      contentHash: hash,
      message: null,
      adminHint: null,
    };
  }

  const designEffective = await getEffectivePublishedRule(DESIGN_PROMPT);
  let designPromptAction: EpisodeDesignRuleMigrationResult["designPromptAction"] =
    "none";

  if (designEffective.source === "builtin") {
    await saveDraft(
      DESIGN_PROMPT,
      episodeEffective.content,
      "manual",
      null,
      null,
      MIGRATION_USER,
    );
    const designRecord = await getRuleRecord(DESIGN_PROMPT);
    await publishRule(
      DESIGN_PROMPT,
      designRecord.draft?.revision ?? null,
      `migrate-design-prompt-${hash.slice(0, 16)}`,
      MIGRATION_USER,
    );
    designPromptAction = "copied";
  } else if (designEffective.contentHash === hash) {
    designPromptAction = "skipped_identical";
  } else {
    designPromptAction = "skipped_existing_different";
  }

  await revertCapabilityToBuiltin(EPISODE_DESIGN, MIGRATION_USER);

  const adminHint =
    designPromptAction === "copied"
      ? "已将误绑在「剧集资产设计」上的「剧本出图/提示词」规则迁移到「素材提示词生成」，并恢复资产提取为内置规则。"
      : designPromptAction === "skipped_identical"
        ? "资产提取上的冲突规则与「素材提示词生成」已发布内容相同，已恢复资产提取为内置规则（未覆盖提示词能力）。"
        : "资产提取上的冲突规则已恢复为内置；「素材提示词生成」已有不同的已发布规则，未自动覆盖。请管理员核对两边规则，必要时手动粘贴正确内容。";

  const message =
    designPromptAction === "skipped_existing_different"
      ? "检测到资产提取能力误绑定提示词类任务规则，已恢复内置；因提示词能力已有不同发布版本，未自动迁移内容。"
      : "已修复资产提取能力的误绑定任务规则。";

  await appendMigrationNotice({
    id: hash,
    at: new Date().toISOString(),
    fromCapability: EPISODE_DESIGN,
    toCapability: DESIGN_PROMPT,
    designPromptAction,
    message,
    adminHint,
  });

  // Touch store in non-remote mode so file exists after mutation paths.
  if (!isRemoteDataOnly()) {
    await loadStore();
  }

  return {
    ran: true,
    episodeDesignReverted: true,
    designPromptAction,
    contentHash: hash,
    message,
    adminHint,
  };
}
