import type {
  AiModelBinding,
  CapabilityDiag,
  CapabilityRuleSummary,
  ModelConnectionPublic,
} from "@/auth/ai-admin/types";
import { profileSlotForConnectionDisplayName } from "@/auth/ai-admin/slot-label-match";

const LEGACY_SLOT_CONNECTION_PREFIX = "legacy-slot-";

function legacySlotIdFromConnectionId(
  connectionId: string,
): string | null {
  if (!connectionId.startsWith(LEGACY_SLOT_CONNECTION_PREFIX)) return null;
  const slotId = connectionId.slice(LEGACY_SLOT_CONNECTION_PREFIX.length).trim();
  return slotId || null;
}

/** Resolve the profile slot a capability uses for model binding. */
export function resolveCapabilityProfileSlot(
  summary: CapabilityRuleSummary,
  diag?: CapabilityDiag | null,
): string | null {
  const fromDiag = diag?.profileSlotId?.trim();
  if (fromDiag) return fromDiag;
  const fromDefault = summary.defaultProfileSlot?.trim();
  return fromDefault || null;
}

/**
 * Capabilities whose profile slot is bound to the given model connection.
 * Match by binding.modelConnectionId — never by modality alone.
 */
export function filterCapabilityRulesForConnection(
  capabilities: readonly CapabilityRuleSummary[],
  diagnostics: readonly CapabilityDiag[],
  bindings: readonly AiModelBinding[],
  connectionId: string | null | undefined,
  connections: readonly ModelConnectionPublic[] = [],
): CapabilityRuleSummary[] {
  const targetId = connectionId?.trim() ?? "";
  if (!targetId) return [];

  const diagByCapability = new Map(
    diagnostics.map((item) => [item.capabilityId, item] as const),
  );
  const connectionBySlot = new Map(
    bindings.map((item) => [item.profileSlot, item.modelConnectionId] as const),
  );

  const matchBySlot = (slotId: string | null): CapabilityRuleSummary[] => {
    if (!slotId) return [];
    return capabilities.filter((summary) => {
      const slot = resolveCapabilityProfileSlot(
        summary,
        diagByCapability.get(summary.capabilityId),
      );
      return slot === slotId;
    });
  };

  const legacySlotId = legacySlotIdFromConnectionId(targetId);
  if (legacySlotId) {
    const matched = matchBySlot(legacySlotId);
    if (matched.length > 0) return matched;
  }

  const boundMatches = capabilities.filter((summary) => {
    const slot = resolveCapabilityProfileSlot(
      summary,
      diagByCapability.get(summary.capabilityId),
    );
    if (!slot) return false;
    return connectionBySlot.get(slot) === targetId;
  });
  if (boundMatches.length > 0) return boundMatches;

  const connection = connections.find((item) => item.id === targetId);
  const slotFromName = connection
    ? profileSlotForConnectionDisplayName(connection.displayName)
    : null;
  if (slotFromName) {
    return matchBySlot(slotFromName);
  }

  return [];
}
