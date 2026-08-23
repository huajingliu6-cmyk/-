import {
  GENERATION_API_DEFS,
  type GenerationApiId,
} from "@/auth/api-config";
import {
  bindSlot,
  listConnectionsPublic,
  listSlotBindings,
} from "@/ai-config/model-connections";
import type { AiModelProfileSlotId } from "@/ai-config/capabilities";

const EXTRACTION_SLOTS: AiModelProfileSlotId[] = [
  "asset-roster-extract-text",
  "asset-detail-extract-text",
];

const DEPRECATED_SHARED_LEGACY_CONNECTION = "legacy-slot-episode-asset-design-text";

function defaultLegacySlotConnectionId(
  slotId: AiModelProfileSlotId,
): string {
  return `legacy-slot-${slotId}`;
}

function normalizeBindingLabel(value: string): string {
  return value
    .replace(/[（(][^)）]*[)）]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function slotLabel(slotId: GenerationApiId): string {
  return GENERATION_API_DEFS.find((def) => def.id === slotId)?.label ?? slotId;
}

function findConnectionForSlot(
  slotId: GenerationApiId,
  connections: Awaited<ReturnType<typeof listConnectionsPublic>>,
): string | null {
  const realConnections = connections.filter((conn) => !conn.legacyVirtual);
  const label = normalizeBindingLabel(slotLabel(slotId));
  if (!label) return null;
  const exact = realConnections.find(
    (conn) => normalizeBindingLabel(conn.displayName) === label,
  );
  if (exact) return exact.id;
  const partial = realConnections.find((conn) => {
    const name = normalizeBindingLabel(conn.displayName);
    return name.includes(label) || label.includes(name);
  });
  return partial?.id ?? null;
}

export type AssetExtractionSlotBindingMigrationResult = {
  ran: boolean;
  boundSlots: AiModelProfileSlotId[];
  adminHint: string | null;
};

/**
 * Bind new roster/detail profile slots to matching model connections.
 * Matches connection displayName to GENERATION_API_DEFS slot labels, then
 * falls back to each slot's own legacy-slot-* connection.
 */
export async function migrateAssetExtractionSlotBindings(
  userId = "system:asset-extraction-slot-bindings",
): Promise<AssetExtractionSlotBindingMigrationResult> {
  const [bindings, connections] = await Promise.all([
    listSlotBindings(),
    listConnectionsPublic(),
  ]);

  const boundSlots: AiModelProfileSlotId[] = [];

  for (const slotId of EXTRACTION_SLOTS) {
    const current =
      bindings.find((item) => item.profileSlot === slotId)?.modelConnectionId ??
      null;
    const preferred =
      findConnectionForSlot(slotId, connections) ??
      defaultLegacySlotConnectionId(slotId);

    if (current === preferred) continue;

    const autoFix =
      !current || current === DEPRECATED_SHARED_LEGACY_CONNECTION;
    if (!autoFix) continue;

    await bindSlot(slotId, preferred, userId);
    boundSlots.push(slotId);
  }

  if (boundSlots.length === 0) {
    return { ran: false, boundSlots, adminHint: null };
  }

  return {
    ran: true,
    boundSlots,
    adminHint: `已自动绑定资产提取槽位：${boundSlots
      .map((slot) => slotLabel(slot))
      .join("、")}。现在可以在连接详情中编辑对应任务规则。`,
  };
}
