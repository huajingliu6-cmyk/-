export type GlassSelectOption = {
  id: string;
  label: string;
  description?: string;
};

export type GlassSelectGroup = {
  id: string;
  label: string;
  options: GlassSelectOption[];
  /** Shown when the group has no options */
  emptyHint?: string;
};
