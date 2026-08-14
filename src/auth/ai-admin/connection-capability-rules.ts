import type {
  AiModelBinding,
  CapabilityDiag,
  CapabilityRuleSummary,
} from "@/auth/ai-admin/types";

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
): CapabilityRuleSummary[] {
  const targetId = connectionId?.trim() ?? "";
  if (!targetId) return [];

  const diagByCapability = new Map(
    diagnostics.map((item) => [item.capabilityId, item] as const),
  );
  const connectionBySlot = new Map(
    bindings.map((item) => [item.profileSlot, item.modelConnectionId] as const),
  );

  return capabilities.filter((summary) => {
    const slot = resolveCapabilityProfileSlot(
      summary,
      diagByCapability.get(summary.capabilityId),
    );
    if (!slot) return false;
    return connectionBySlot.get(slot) === targetId;
  });
}
