"use client";

/**
 * Story-domain adapter over the global shell GlassSelect.
 * Adds form spacing; new non-story call sites should import `@/shell/glass-select`.
 */
import {
  GlassSelect as ShellGlassSelect,
  type GlassSelectGroup,
  type GlassSelectOption,
} from "@/shell/glass-select";

export type { GlassSelectGroup, GlassSelectOption };

type Props = {
  options?: GlassSelectOption[];
  groups?: GlassSelectGroup[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  id?: string;
  label: string;
  hideLabel?: boolean;
  placeholder?: string;
  allowClear?: boolean;
  clearLabel?: string;
};

export function GlassSelect(props: Props) {
  return <ShellGlassSelect spaced {...props} />;
}
