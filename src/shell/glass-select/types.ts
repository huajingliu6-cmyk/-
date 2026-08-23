export type GlassSelectOption = {
  id: string;
  label: string;
  description?: string;
  /**
   * Action row: selecting fires `onAction` instead of `onChange`.
   * Never treated as the current value.
   */
  action?: boolean;
  /** Show a trailing remove (X) control; click fires `onRemove` and does not select. */
  removable?: boolean;
};

export type GlassSelectGroup = {
  id: string;
  label: string;
  options: GlassSelectOption[];
  /** Shown when the group has no options */
  emptyHint?: string;
};
