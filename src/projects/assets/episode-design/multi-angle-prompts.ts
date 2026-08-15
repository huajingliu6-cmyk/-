export const DESIGN_MULTI_ANGLE_MODES = [
  {
    id: "reverse_180",
    label: "180° 正反打",
  },
  {
    id: "side_reverse_45",
    label: "45° 侧反打",
  },
  {
    id: "high_reverse",
    label: "俯反打",
  },
] as const;

export type DesignMultiAngleMode =
  (typeof DESIGN_MULTI_ANGLE_MODES)[number]["id"];

const MULTI_ANGLE_TEMPLATES: Record<DesignMultiAngleMode, string> = {
  reverse_180:
    "@scene image, same location as the reference. Keep the exact same environment, art style, color palette and lighting direction. Move the virtual camera to the direct opposite of the original camera position (horizontally rotated 180 degrees) — as if standing where the original camera stood, facing back into the scene. The frame shows what was behind the original camera: [describe elements behind, e.g. the entrance, a corridor, the opposite wall]. Perspective and vanishing points shift correctly for the new camera position. No people, no text",
  side_reverse_45:
    "@scene image, same location as the reference, identical style, lighting and time of day. Rotate the camera around the center of the scene by 135 degrees horizontally from the original position, shooting the same space from the side-rear angle. The [main subject] from the original image now sits deep in the background of the frame. Correct perspective relationship. No people",
  high_reverse:
    "@scene image, same location as the reference, consistent environment, materials and lighting direction. Move the camera to the opposite side and raise it to a 15-degree high angle (or lower it to a low angle), looking back across the entire space from above (or below). Perspective distortion matches the new camera position. No people",
};

export function isDesignMultiAngleMode(
  value: unknown,
): value is DesignMultiAngleMode {
  return DESIGN_MULTI_ANGLE_MODES.some((mode) => mode.id === value);
}

export function getMultiAngleTemplate(
  mode: DesignMultiAngleMode,
): string {
  return MULTI_ANGLE_TEMPLATES[mode];
}

/**
 * Server-only final prompt for scene multi-angle edits.
 * Clients must not send or override templates.
 */
export function buildMultiAngleEditPrompt(
  mode: DesignMultiAngleMode,
  userInstruction: string,
): string {
  const extra = userInstruction.trim();
  return [
    "The first uploaded reference image is @scene image.",
    getMultiAngleTemplate(mode),
    `Additional user instruction: ${extra}`,
  ].join("\n");
}
