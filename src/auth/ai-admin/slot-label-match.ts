import {
  ADMIN_SLOT_CATALOG,
  type AdminSlotId,
} from "@/admin/slot-catalog";

export function normalizeSlotBindingLabel(value: string): string {
  return value
    .replace(/[（(][^)）]*[)）]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

export function profileSlotForConnectionDisplayName(
  displayName: string,
): AdminSlotId | null {
  const normalized = normalizeSlotBindingLabel(displayName);
  if (!normalized) return null;

  const exact = ADMIN_SLOT_CATALOG.find((slot) => {
    const label = normalizeSlotBindingLabel(slot.label);
    const withTextModel = normalizeSlotBindingLabel(`${slot.label}文本模型`);
    return normalized === label || normalized === withTextModel;
  });
  if (exact) return exact.id;

  const partial = ADMIN_SLOT_CATALOG.find((slot) => {
    const label = normalizeSlotBindingLabel(slot.label);
    return normalized.includes(label) || label.includes(normalized);
  });
  return partial?.id ?? null;
}
