import type {
  AiModelBinding,
  CapabilityDiag,
  ModelConnectionPublic,
  ModelProviderMode,
} from "@/auth/ai-admin/types";
import {
  legacySlotConnectionId,
  type AdminSlotId,
} from "@/admin/slot-catalog";

export function connectionForSlot(
  slotId: AdminSlotId,
  connections: ModelConnectionPublic[],
  bindings: AiModelBinding[],
): ModelConnectionPublic | undefined {
  const boundId = bindings.find((item) => item.profileSlot === slotId)
    ?.modelConnectionId;
  if (boundId) {
    return connections.find((item) => item.id === boundId);
  }
  return connections.find((item) => item.id === legacySlotConnectionId(slotId));
}

export type SlotRowStatus =
  | "live"
  | "mock"
  | "missing_key"
  | "failed"
  | "untested"
  | "disabled"
  | "unconfigured";

export function slotRowStatus(
  connection: ModelConnectionPublic | undefined,
): SlotRowStatus {
  if (!connection) return "unconfigured";
  if (!connection.enabled) return "disabled";
  if (connection.providerMode === "mock") return "mock";
  if (!connection.apiKeyConfigured) return "missing_key";
  if (connection.lastTestStatus === "failed") return "failed";
  if (connection.lastTestStatus === "success") return "live";
  return "untested";
}

export function slotStatusLabel(status: SlotRowStatus): string {
  switch (status) {
    case "live":
      return "可运行";
    case "mock":
      return "仅演示";
    case "missing_key":
      return "缺密钥";
    case "failed":
      return "测试失败";
    case "untested":
      return "未测试";
    case "disabled":
      return "已停用";
    default:
      return "未配置";
  }
}

export function providerModeLabel(mode: ModelProviderMode): string {
  switch (mode) {
    case "mock":
      return "本地演示";
    case "aliyun-wan27":
      return "万相";
    default:
      return "真实接口";
  }
}

export type OverviewHealthKind = "live" | "mock" | "blocked" | "planned";

export function classifyCapabilityHealth(
  diag: Pick<CapabilityDiag, "health" | "runnable" | "status">,
): OverviewHealthKind {
  if (diag.status === "planned" || diag.health === "功能尚未接线") {
    return "planned";
  }
  if (diag.health.includes("mock")) return "mock";
  if (diag.runnable && diag.health.startsWith("已配置")) return "live";
  return "blocked";
}

export function isAttentionHealth(diag: CapabilityDiag): boolean {
  const kind = classifyCapabilityHealth(diag);
  return kind === "blocked";
}
