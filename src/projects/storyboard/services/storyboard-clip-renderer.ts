/**
 * @deprecated Not used by SHOT_ID_PROMPT_V1 generation — model videoPrompt is saved as-is.
 * Kept for legacy tests that still exercise structured clip rendering.
 */
import type { StoryboardStructuredClip } from "@/projects/storyboard/services/storyboard-clip-types";
import type { StoryboardShot } from "@/projects/storyboard/types";

function formatSegmentLine(
  seg: StoryboardStructuredClip["segments"][number],
  index: number,
): string {
  const start = Number.isInteger(seg.start) ? seg.start : seg.start;
  const end = Number.isInteger(seg.end) ? seg.end : seg.end;
  const dialoguePart = seg.dialogue?.trim()
    ? seg.speaker?.trim()
      ? `对白：${seg.speaker}在画口型「${seg.dialogue}」`
      : `对白：${seg.dialogue}`
    : "对白：无";
  return [
    `${start}–${end}秒｜镜${String(index + 1).padStart(3, "0")}：`,
    `【${seg.shotSize}】`,
    `〖${seg.cameraMovement}·${seg.cameraAngle}〗`,
    seg.visualAction || "画面推进。",
    dialoguePart,
  ].join("");
}

/** Render V5 PromptClip body from validated structured clip + server mount line. */
export function renderStoryboardClipPrompt(input: {
  clip: StoryboardStructuredClip;
  shot: StoryboardShot;
  sceneTitle: string;
  aspectRatio?: string;
  /** Server-built mount line only; never from model mountLine. */
  canonicalMountLine?: string | null;
  /** When true, insert a non-blocking material hint (no fake @图片). */
  includeMaterialHint?: boolean;
}): string {
  const { clip, shot, sceneTitle } = input;
  const aspect = input.aspectRatio?.trim() || "9:16";
  const shotLabel = String(shot.shotNumber).padStart(3, "0");
  const rhythm = clip.rhythmLabel?.trim() || "叙事推进";
  const mount = input.canonicalMountLine?.trim() || "";
  const blockingRaw = clip.characterBlocking?.trim() || "";
  const blocking = blockingRaw
    ? blockingRaw.startsWith("【")
      ? blockingRaw
      : `【位置结构】${blockingRaw.replace(/^人物站位\s*[：:]\s*/, "")}`
    : "";
  const materialHint = input.includeMaterialHint
    ? "【素材提示】本镜人物暂无可用参考图，使用文字描述保持人物外观、服装和动作一致。"
    : "";

  const lines = [
    `【Clip ${shotLabel}｜场景：${sceneTitle || clip.sceneTitle || "场景"}｜镜头：${shotLabel}｜总时长：${clip.durationSeconds}秒｜节奏：${rhythm}】`,
    mount,
    materialHint,
    blocking,
    `【总时长】${clip.durationSeconds}秒`,
    `【画幅】${aspect}`,
    "【时间轴·强制映射】",
    ...clip.segments.map((seg, index) => formatSegmentLine(seg, index)),
    `【连续性锁定】${clip.continuity.trim() || "保持服装、发型与空间关系一致。"}`,
    `【声音设计】${clip.sound.trim() || "环境声与对白清晰。"}`,
  ];

  const negative =
    clip.negative?.trim() ||
    "禁止人物变脸、换装、额外人物、口型错配、字幕、Logo、水印。";
  lines.push(`【负面约束】${negative}`);

  return lines.filter(Boolean).join("\n");
}
