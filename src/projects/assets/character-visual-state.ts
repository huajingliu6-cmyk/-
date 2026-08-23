/** Left preview: which image is shown (display only). */
export type ActiveCharacterVisual =
  | { scope: "primary"; mediaId: string | null }
  | { scope: "appearance"; appearanceId: string; mediaId: string | null }
  | { scope: "none" };

export type PreviewState = {
  mediaId: string | null;
  interactive: false;
  lightboxOpen: boolean;
};

/** Right panel: prompt + voice editing scope (independent from preview history picks). */
export type PromptVoiceScope =
  | { scope: "primary"; appearanceId: null }
  | { scope: "appearance"; appearanceId: string };

export function promptVoiceAppearanceId(
  scope: PromptVoiceScope,
): string | null {
  return scope.scope === "appearance" ? scope.appearanceId : null;
}

export function isPrimaryPromptScope(scope: PromptVoiceScope): boolean {
  return scope.scope === "primary";
}
