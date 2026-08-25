import type {
  StoryboardClipSegment,
  StoryboardClipsModelResponse,
  StoryboardStructuredClip,
} from "@/projects/storyboard/services/storyboard-clip-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function parseSegment(raw: unknown): StoryboardClipSegment | null {
  if (!isRecord(raw)) return null;
  const start = asNumber(raw.start);
  const end = asNumber(raw.end);
  if (start == null || end == null || end <= start) return null;
  return {
    start,
    end,
    shotSize: asString(raw.shotSize, "中景"),
    cameraAngle: asString(raw.cameraAngle, "平视"),
    cameraMovement: asString(raw.cameraMovement, "固定"),
    visualAction: asString(raw.visualAction),
    dialogue: asString(raw.dialogue),
    speaker: asString(raw.speaker),
  };
}

function parseClip(raw: unknown): StoryboardStructuredClip | null {
  if (!isRecord(raw)) return null;
  const shotId = asString(raw.shotId);
  const duration = asNumber(raw.durationSeconds);
  if (!shotId || duration == null) return null;
  const segmentsRaw = raw.segments;
  if (!Array.isArray(segmentsRaw)) return null;
  const segments = segmentsRaw
    .map((item) => parseSegment(item))
    .filter((item): item is StoryboardClipSegment => item !== null);
  if (segments.length === 0) return null;
  const characterNames = Array.isArray(raw.characterNames)
    ? raw.characterNames
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;
  const propNames = Array.isArray(raw.propNames)
    ? raw.propNames
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;

  return {
    shotId,
    durationSeconds: Math.round(duration) as 13 | 14 | 15,
    rhythmLabel: asString(raw.rhythmLabel) || undefined,
    sceneTitle: asString(raw.sceneTitle) || undefined,
    shotNumber:
      asNumber(raw.shotNumber) != null
        ? Math.round(asNumber(raw.shotNumber)!)
        : undefined,
    characterNames:
      characterNames && characterNames.length > 0 ? characterNames : undefined,
    sceneName: asString(raw.sceneName) || undefined,
    propNames: propNames && propNames.length > 0 ? propNames : undefined,
    // Accepted for backward compat then discarded by pipeline; never trusted.
    mountLine: asString(raw.mountLine) || undefined,
    characterBlocking: asString(raw.characterBlocking) || undefined,
    segments,
    continuity: asString(raw.continuity),
    sound: asString(raw.sound),
    negative: asString(raw.negative) || undefined,
  };
}

function extractJsonObject(raw: string): unknown | null {
  const text = raw.replace(/^\uFEFF/, "").trim();
  const fenced =
    /^```(?:json)?\s*([\s\S]*?)```$/i.exec(text) ??
    /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1]?.trim() ?? text;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as unknown;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function parseStoryboardClipsModelResponse(
  raw: string,
): StoryboardClipsModelResponse | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) return null;

  let clipsRaw: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    clipsRaw = parsed;
  } else if (isRecord(parsed)) {
    if (Array.isArray(parsed.clips)) clipsRaw = parsed.clips;
    else if (Array.isArray(parsed.shots)) clipsRaw = parsed.shots;
  }
  if (!clipsRaw) return null;

  const clips = clipsRaw
    .map((item) => parseClip(item))
    .filter((item): item is StoryboardStructuredClip => item !== null);
  if (clips.length === 0) return null;
  return { clips };
}
