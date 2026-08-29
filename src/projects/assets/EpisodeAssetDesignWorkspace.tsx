"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Clapperboard,
  MapPinned,
  Package,
  UserRound,
  X,
} from "lucide-react";
import {
  GlassSelect,
  type GlassSelectGroup,
  type GlassSelectOption,
} from "@/shell/glass-select";
import { useGenerationBusy } from "@/shell/GenerationBusyGuard";
import {
  projectManagementPath,
  workspaceProjectStoryboardPath,
} from "@/shell/nav";
import { safeRandomUUID } from "@/lib/safe-random-id";
import {
  DesignGenerationOverlay,
  type AssetGenerationProgress,
} from "@/projects/assets/DesignGenerationOverlay";
import {
  ACTIVE_ENTERPRISE_EVENT,
  readActiveSpace,
  type ActiveSpace,
} from "@/enterprise/client-space";
import {
  notifyCreditsRefresh,
} from "@/projects/story/story-generation-client";
import type {
  AssetExtractionTask,
  PublicAssetExtractionTask,
  PublicAssetRosterItem,
} from "@/projects/assets/extraction/types";
import {
  isAwaitingRosterSelectionStatus,
  isLiveExtractionStatus,
} from "@/projects/assets/extraction/types";
import { RosterSelectionDialog } from "@/projects/assets/extraction/RosterSelectionDialog";
import {
  designCardApprovalUi,
  isApprovedEpisodeDesignItem,
  resolveDesignItemPreviewUrl,
} from "@/projects/assets/episode-design/approved-item";
import { createEpisodeAssetDesignIdempotencyKey } from "@/projects/assets/episode-design/prompts";
import { mergeGeneratedMediaState } from "@/projects/assets/episode-design/generated-media-history";
import {
  autoGenerateMissingFormalDesignPrompts,
  itemNeedsFormalDesignPrompt,
} from "@/projects/assets/episode-design/auto-generate-design-prompts";
import { DEFAULT_DESIGN_PROMPT_MODEL_ID } from "@/projects/assets/episode-design/design-prompt-models";
import {
  characterNeedsUnboundVoiceConfirm,
  getDesignMediaVoiceBinding,
  isMediaVoiceBound,
} from "@/projects/assets/episode-design/design-media-voice";
import { characterNeedsUncheckedVideoRefBlock } from "@/projects/assets/episode-design/design-media-video-ref-labels";
import {
  itemFromCharacterDraft,
  mergePatchedDesignItem,
} from "@/projects/assets/episode-design/character-design-item";
import { shouldApplySavedDesignRecord } from "@/projects/assets/episode-design/update-media-voice";
import {
  EPISODE_ASSET_DESIGN_STATUS_LABELS,
  type CharacterDesignItem,
  type EpisodeAssetActiveGeneration,
  type EpisodeAssetDesignAssetType,
  type EpisodeAssetDesignItem,
  type EpisodeAssetDesignRecord,
  type EpisodeAssetDesignStatus,
  type PropDesignItem,
  type SceneDesignItem,
} from "@/projects/assets/episode-design/types";
const CharacterCreateDialog = dynamic(
  () => import("@/projects/assets/CharacterCreateDialog").then((m) => m.CharacterCreateDialog),
);
const SceneCreateDialog = dynamic(
  () => import("@/projects/assets/SceneCreateDialog").then((m) => m.SceneCreateDialog),
);
const PropCreateDialog = dynamic(
  () => import("@/projects/assets/PropCreateDialog").then((m) => m.PropCreateDialog),
);
const SubmitApprovalModal = dynamic(
  () => import("@/projects/assets/approvals/SubmitApprovalModal").then((m) => m.SubmitApprovalModal),
);
const OwnerApproveModal = dynamic(
  () => import("@/projects/assets/approvals/OwnerApproveModal").then((m) => m.OwnerApproveModal),
);
const DesignAssetModal = dynamic(
  () => import("@/projects/assets/DesignAssetModal").then((m) => m.DesignAssetModal),
);
const DesignImageLightbox = dynamic(
  () => import("@/projects/assets/DesignImageLightbox").then((m) => m.DesignImageLightbox),
);
import { voiceOptionsFromAudios } from "@/projects/assets/voice-catalog";
import { VoiceSelector } from "@/projects/assets/VoiceSelector";
import { VoicePreviewButton } from "@/projects/assets/VoicePreviewButton";
import { uploadProjectAssetImage } from "@/projects/assets/upload-asset-image";
import { uploadProjectAssetAudio } from "@/projects/assets/upload-asset-audio";
import type {
  AudioAsset,
  CharacterDraftInput,
  PropDraftInput,
  ProjectAssetBundle,
  SceneDraftInput,
  VoiceOption,
} from "@/projects/assets/types";
import "./asset-workspace.css";

function designFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return fetch(url, { credentials: "include", ...init });
  }
  return fetch(url, { credentials: "include", ...init });
}

export type AssetExtractionEpisode = {
  episodeId: string;
  episodeNumber: number;
  title: string;
  designStatus: EpisodeAssetDesignStatus;
  itemCount: number;
};

type EpisodeListItem = AssetExtractionEpisode;

export type AssetExtractionRequest =
  | { id: number; mode: "full-script"; idempotencyKey: string }
  | {
      id: number;
      mode: "selected-episode";
      episodeId: string;
      idempotencyKey: string;
    };

export type AssetExtractionProgress = {
  percent: number;
  title: string;
  label: string;
};

export type ExtractionReviewReadyPayload = {
  episodeId: string;
  episodeNumber: number;
  episodeTitle: string;
  items: EpisodeAssetDesignItem[];
  revision: number;
  fingerprint: string;
};

type PendingMediaEntry = {
  kind: "image" | "audio";
  file: File;
  objectUrl: string;
};

type EpisodeDetailPayload = {
  episode: {
    id: string;
    episodeNumber: number;
    title: string;
    content?: string;
  };
  record: EpisodeAssetDesignRecord;
  currentFingerprint: string;
  designStatus: EpisodeAssetDesignStatus;
};

type Props = {
  projectId: string;
  /** Hide approval-only controls while the shared collaboration flow is active. */
  showApprovalUi?: boolean;
  /** Reuse the design workspace inline without duplicating the library toolbar. */
  embeddedInLibrary?: boolean;
  /** Increment to request a full-script extraction from the parent toolbar. */
  extractRequestId?: number;
  extractionModel?: string;
  /** Run extraction logic without rendering the legacy design workspace. */
  headless?: boolean;
  /** Parent-controlled episode selection for the unified asset library. */
  controlledEpisodeId?: string | null;
  extractionRequest?: AssetExtractionRequest | null;
  approvalEnabled?: boolean;
  /** Open the workspace approval picker from the unified asset toolbar. */
  submitApprovalRequestId?: number;
  onEpisodesChange?: (episodes: AssetExtractionEpisode[]) => void;
  /** Expose the currently loaded extraction items to the unified asset library. */
  onItemsChange?: (items: EpisodeAssetDesignItem[], episodeId: string) => void;
  onExtractionBusyChange?: (busy: boolean) => void;
  onExtractionProgressChange?: (
    progress: AssetExtractionProgress | null,
  ) => void;
  onExtractionComplete?: () => void | Promise<void>;
  /** Extraction finished and items are ready for user selection before library promote. */
  onExtractionReviewReady?: (payload: ExtractionReviewReadyPayload) => void;
  onExtractionNote?: (message: string) => void;
  /** Parent clears the request after headless consumption so remounts cannot replay it. */
  onExtractionRequestConsumed?: (requestId: number) => void;
};

const GROUPS: Array<{
  type: EpisodeAssetDesignAssetType;
  label: string;
}> = [
  { type: "character", label: "角色" },
  { type: "scene", label: "场景" },
  { type: "prop", label: "道具" },
];
/** Skip titles that only repeat「第N集」so the list/detail don't look duplicated. */
function meaningfulEpisodeTitle(
  episodeNumber: number,
  title?: string | null,
): string | null {
  const raw = (title ?? "").trim();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, "");
  if (
    compact === `第${episodeNumber}集` ||
    compact === `EP${episodeNumber}` ||
    compact === `Ep${episodeNumber}` ||
    compact === `ep${episodeNumber}`
  ) {
    return null;
  }
  return raw;
}

function newItemId(): string {
  return `item_${safeRandomUUID()}`;
}

function itemFromSceneDraft(
  draft: SceneDraftInput,
  options: { id: string; previous?: SceneDesignItem | null },
): SceneDesignItem {
  const previous = options.previous;
  return {
    id: options.id,
    name: draft.name.trim(),
    resolution: previous?.resolution ?? "create_new",
    existingAssetId: previous?.existingAssetId ?? null,
    libraryAssetId: previous?.libraryAssetId ?? null,
    source: previous?.source ?? "manual",
    note: previous?.note ?? "",
    assetType: "scene",
    draft: {
      description: draft.description,
      timeOfDay: draft.timeOfDay,
      location: previous?.draft.location ?? "",
      style: previous?.draft.style ?? "",
      usageInEpisode: previous?.draft.usageInEpisode ?? "",
      evidence: previous?.draft.evidence ?? "",
    },
  };
}

function itemFromPropDraft(
  draft: PropDraftInput,
  options: { id: string; previous?: PropDesignItem | null },
): PropDesignItem {
  const previous = options.previous;
  return {
    id: options.id,
    name: draft.name.trim(),
    resolution: previous?.resolution ?? "create_new",
    existingAssetId: previous?.existingAssetId ?? null,
    libraryAssetId: previous?.libraryAssetId ?? null,
    source: previous?.source ?? "manual",
    note: previous?.note ?? "",
    assetType: "prop",
    draft: {
      description: draft.description,
      propType: previous?.draft.propType ?? "",
      usage: previous?.draft.usage ?? "",
      usageInEpisode: previous?.draft.usageInEpisode ?? "",
      evidence: previous?.draft.evidence ?? "",
    },
  };
}

function characterDraftFromItem(
  item: CharacterDesignItem,
  pending: PendingMediaEntry | null | undefined,
): CharacterDraftInput {
  const imagePending = pending?.kind === "image" ? pending : null;
  const dialogUrl = imagePending
    ? URL.createObjectURL(imagePending.file)
    : null;
  return {
    name: item.name,
    role: item.draft.role,
    description: item.draft.description,
    clothing: item.draft.clothing,
    age: item.draft.age,
    voiceId: item.draft.voiceId,
    imageFileName: imagePending?.file.name ?? null,
    imageObjectUrl: dialogUrl,
    imageMimeType: imagePending?.file.type || null,
    pendingImageFile: imagePending?.file ?? null,
  };
}

function sceneDraftFromItem(
  item: SceneDesignItem,
  pending: PendingMediaEntry | null | undefined,
): SceneDraftInput {
  const imagePending = pending?.kind === "image" ? pending : null;
  const dialogUrl = imagePending
    ? URL.createObjectURL(imagePending.file)
    : null;
  return {
    name: item.name,
    description: item.draft.description,
    timeOfDay: item.draft.timeOfDay,
    imageFileName: imagePending?.file.name ?? null,
    imageObjectUrl: dialogUrl,
    imageMimeType: imagePending?.file.type || null,
    pendingImageFile: imagePending?.file ?? null,
  };
}

function propDraftFromItem(
  item: PropDesignItem,
  pending: PendingMediaEntry | null | undefined,
): PropDraftInput {
  const imagePending = pending?.kind === "image" ? pending : null;
  const dialogUrl = imagePending
    ? URL.createObjectURL(imagePending.file)
    : null;
  return {
    name: item.name,
    description: item.draft.description,
    imageFileName: imagePending?.file.name ?? null,
    imageObjectUrl: dialogUrl,
    imageMimeType: imagePending?.file.type || null,
    pendingImageFile: imagePending?.file ?? null,
  };
}

function formatMetaTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("zh-CN");
}

function formatFullScriptExtractionError(
  code: string,
  fallbackMessage: string,
): string {
  switch (code) {
    case "AI_TASK_RULE_CONTRACT_CONFLICT":
      return "当前资产提取任务规则与固定输出格式冲突，请联系管理员修正任务规则后重试。";
    case "MODEL_TIMEOUT":
      return "全剧本资产提取模型生成超时，请稍后重试或更换模型。已调用模型但未在时限内完成；可点击下方按钮重试。";
    case "EMPTY_MODEL_OUTPUT":
      return "模型未返回任何内容，请重试提取。";
    case "EPISODE_ASSET_DESIGN_CONTENT_EMPTY":
      return fallbackMessage.includes("空")
        ? fallbackMessage
        : "模型输出为空，未能提取资产。";
    case "EPISODE_ASSET_DESIGN_OUTPUT_INVALID":
    case "PARSE_FAILED":
      if (/合法 JSON|JSON 对象|代码围栏/i.test(fallbackMessage)) {
        return `模型返回内容不是合法的资产 JSON：${fallbackMessage}`;
      }
      return `模型返回的 JSON 不符合资产结构：${fallbackMessage}`;
    default:
      return fallbackMessage || "全剧本资产提取失败，请重试。";
  }
}

const ASSET_EXTRACTION_MODEL_OPTIONS: GlassSelectOption[] = [
  {
    id: "deepseek-v4-pro",
    label: "Deepseek V4 Pro",
  },
];

type AssetSummaryPanel = "extracted" | "library" | "generated" | null;

function AssetSummaryButton({
  label,
  count,
  active,
  testId,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`ead-summary-button${active ? " is-active" : ""}`}
      data-testid={testId}
      aria-expanded={active}
      onClick={onClick}
    >
      <strong>{count}</strong>
      <span>{label}</span>
    </button>
  );
}

function statusBadgeClass(status: EpisodeAssetDesignStatus): string {
  if (status === "confirmed") return "ead-badge is-ok";
  if (status === "stale" || status === "failed") return "ead-badge is-warn";
  if (status === "generating") return "ead-badge is-busy";
  return "ead-badge";
}

export function EpisodeAssetDesignWorkspace({
  projectId,
  showApprovalUi = true,
  embeddedInLibrary = false,
  extractRequestId = 0,
  extractionModel,
  headless = false,
  controlledEpisodeId = null,
  extractionRequest = null,
  approvalEnabled = true,
  submitApprovalRequestId = 0,
  onEpisodesChange,
  onItemsChange,
  onExtractionBusyChange,
  onExtractionProgressChange,
  onExtractionComplete,
  onExtractionReviewReady,
  onExtractionNote,
  onExtractionRequestConsumed,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const surface: "project_management" | "workspace" = pathname.includes(
    "/workspace/",
  )
    ? "workspace"
    : "project_management";
  const apiRoot =
    surface === "workspace"
      ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
      : `/api/projects/${encodeURIComponent(projectId)}`;
  const queryEpisodeId = searchParams.get("episodeId")?.trim() || null;
  const [activeSpace, setActiveSpace] = useState<ActiveSpace>(() =>
    readActiveSpace(),
  );
  const [episodes, setEpisodes] = useState<EpisodeListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>(
    () => queryEpisodeId || "",
  );
  const [detail, setDetail] = useState<EpisodeDetailPayload | null>(null);
  const [items, setItems] = useState<EpisodeAssetDesignItem[]>([]);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const [revision, setRevision] = useState(0);
  const revisionRef = useRef(revision);
  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);
  const [fingerprint, setFingerprint] = useState("");
  const [designStatus, setDesignStatus] =
    useState<EpisodeAssetDesignStatus>("not_started");
  const [contentLength, setContentLength] = useState<number | null>(null);
  const [episodeContent, setEpisodeContent] = useState("");
  const [scriptViewerOpen, setScriptViewerOpen] = useState(false);
  const [activeGroup, setActiveGroup] =
    useState<EpisodeAssetDesignAssetType>("character");
  const [bundle, setBundle] = useState<
    Pick<ProjectAssetBundle, "characters" | "scenes" | "props" | "audios">
  >({ characters: [], scenes: [], props: [], audios: [] });
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [batchExtracting, setBatchExtracting] = useState(false);
  const [extractingEpisodeIds, setExtractingEpisodeIds] = useState<
    Set<string>
  >(() => new Set());
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmingItemId, setConfirmingItemId] = useState<string | null>(null);
  const [pendingUnboundVoiceConfirmItem, setPendingUnboundVoiceConfirmItem] =
    useState<{ id: string; name: string } | null>(null);
  const [pendingUncheckedVideoRefItem, setPendingUncheckedVideoRefItem] =
    useState<{ id: string; name: string } | null>(null);
  const [savingVoiceItemIds, setSavingVoiceItemIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [pageNote, setPageNote] = useState("");
  const [extractionError, setExtractionError] = useState<{
    code: string;
    message: string;
    generationId?: string | null;
    canReapply?: boolean;
    canRetryChunks?: boolean;
  } | null>(null);
  const [rosterSelectionTask, setRosterSelectionTask] =
    useState<PublicAssetExtractionTask | null>(null);
  const [rosterDialogOpen, setRosterDialogOpen] = useState(false);
  const [rosterSubmitting, setRosterSubmitting] = useState(false);
  const [rosterSubmitError, setRosterSubmitError] = useState<string | null>(
    null,
  );
  const [extractDiagnostics, setExtractDiagnostics] = useState<{
    extracted: number;
    repaired: number;
    rejected: number;
    rejectedItems: Array<{ index: number; name?: string; reason: string }>;
  } | null>(null);
  const [confirmSummary, setConfirmSummary] = useState<string | null>(null);
  const [assetExtractionModel, setAssetExtractionModel] = useState(
    extractionModel ?? "deepseek-v4-pro",
  );
  const activeAssetExtractionModel =
    headless && extractionModel ? extractionModel : assetExtractionModel;
  const handledExtractRequestIdRef = useRef(0);
  const handledExternalRequestIdRef = useRef(0);
  const handledSubmitApprovalRequestIdRef = useRef(0);
  const pendingEpisodeRequestRef = useRef<AssetExtractionRequest | null>(null);
  const reviewReadyKeyRef = useRef("");
  const [assetSummaryPanel, setAssetSummaryPanel] =
    useState<AssetSummaryPanel>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const [createDialogType, setCreateDialogType] =
    useState<EpisodeAssetDesignAssetType | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [pendingMedia, setPendingMedia] = useState<
    Record<string, PendingMediaEntry>
  >({});
  const [designModalItem, setDesignModalItem] =
    useState<EpisodeAssetDesignItem | null>(null);
  const [generatingAssetIds, setGeneratingAssetIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [generatingPromptIds, setGeneratingPromptIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [promptBatchProgress, setPromptBatchProgress] = useState<{
    episodeId: string;
    active: boolean;
    total: number;
    processed: number;
    completed: number;
    failed: number;
    batchSize: number;
    assetTotal: number;
  } | null>(null);
  const [extractionProgress, setExtractionProgress] = useState<{
    episodeId: string;
    percent: number;
  } | null>(null);
  const updateExtractionProgress = useCallback(
    (episodeId: string, percent: number) => {
      const nextPercent = Math.min(25, Math.max(0, Math.round(percent)));
      setExtractionProgress((previous) => {
        if (
          previous?.episodeId === episodeId &&
          previous.percent >= nextPercent
        ) {
          return previous;
        }
        return { episodeId, percent: nextPercent };
      });
    },
    [],
  );
  const autoPromptBatchKeysRef = useRef(new Set<string>());
  const activePromptEpisodesRef = useRef(new Set<string>());
  const [assetGenerationProgress, setAssetGenerationProgress] = useState<
    Record<string, AssetGenerationProgress>
  >({});
  const [pendingApprovalMediaIds, setPendingApprovalMediaIds] = useState<
    Set<string>
  >(() => new Set());
  const [approvedApprovalMediaIds, setApprovedApprovalMediaIds] = useState<
    Set<string>
  >(() => new Set());
  const [submitApprovalOpen, setSubmitApprovalOpen] = useState(false);
  const [projectName, setProjectName] = useState(projectId);
  const selectedIdRef = useRef(selectedId);
  const confirmingRef = useRef(false);
  const isPersonalSpace = activeSpace.kind === "personal";

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    onEpisodesChange?.(episodes);
  }, [episodes, onEpisodesChange]);

  useEffect(() => {
    if (controlledEpisodeId == null) return;
    queueMicrotask(() => {
      setSelectedId((prev) =>
        prev === controlledEpisodeId ? prev : controlledEpisodeId,
      );
    });
  }, [controlledEpisodeId]);

  useEffect(() => {
    onItemsChange?.(items, selectedId);
  }, [items, onItemsChange, selectedId]);

  const markEpisodeExtracting = useCallback((episodeId: string, on: boolean) => {
    setExtractingEpisodeIds((prev) => {
      const has = prev.has(episodeId);
      if (on && has) return prev;
      if (!on && !has) return prev;
      const next = new Set(prev);
      if (on) next.add(episodeId);
      else next.delete(episodeId);
      return next;
    });
  }, []);

  const applyExtractionTask = useCallback(
    (task: AssetExtractionTask | PublicAssetExtractionTask | null) => {
      if (!task) {
        setBatchExtracting(false);
        setExtractingEpisodeIds(new Set());
        setExtractionProgress(null);
        return;
      }

      if (isAwaitingRosterSelectionStatus(task.status)) {
        setBatchExtracting(false);
        setExtractionProgress(null);
        if (task.scope === "episode" && task.episodeId) {
          setExtractingEpisodeIds(new Set([task.episodeId]));
          if (selectedIdRef.current === task.episodeId) {
            setDesignStatus("generating");
          }
        }
        return;
      }

      const live = isLiveExtractionStatus(task.status);
      if (!live) {
        setBatchExtracting(false);
        setExtractingEpisodeIds(new Set());
        setExtractionProgress(null);
        return;
      }
      setBatchExtracting(task.scope === "all");
      setExtractingEpisodeIds(
        task.scope === "episode" && task.episodeId
          ? new Set([task.episodeId])
          : new Set(),
      );
      if (task.scope === "episode" && task.episodeId) {
        if (selectedIdRef.current === task.episodeId) {
          setDesignStatus("generating");
        }
      }
      setExtractionProgress({
        episodeId: task.episodeId ?? "",
        percent: Math.min(99, task.estimatedProgress),
      });
    },
    [],
  );

  const currentEpisodeExtracting =
    selectedId != null &&
    (extractingEpisodeIds.has(selectedId) ||
      (!detailLoading && designStatus === "generating"));

  const extractionBusy =
    batchExtracting ||
    designStatus === "generating" ||
    currentEpisodeExtracting;

  useEffect(() => {
    onExtractionBusyChange?.(extractionBusy);
  }, [extractionBusy, onExtractionBusyChange]);

  useEffect(() => {
    const onSpaceChanged = (event: Event) => {
      const detail = (event as CustomEvent<ActiveSpace>).detail;
      setActiveSpace(detail ?? readActiveSpace());
    };
    window.addEventListener(ACTIVE_ENTERPRISE_EVENT, onSpaceChanged);
    return () =>
      window.removeEventListener(ACTIVE_ENTERPRISE_EVENT, onSpaceChanged);
  }, []);

  // Modal open state is driven only by the URL so closing (strip query) and
  // re-clicking the unread notification (push query again) both work.
  const ownerApprovalSubmissionId =
    !isPersonalSpace && surface === "project_management"
      ? searchParams.get("approvalSubmissionId")?.trim() || null
      : null;
  const ownerApprovalOpen = Boolean(ownerApprovalSubmissionId);
  useGenerationBusy(
    generatingAssetIds.size > 0,
    `asset-image-generation-${projectId}`,
    "资产图片生成",
  );

  useEffect(() => {
    if (!ownerApprovalSubmissionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await designFetch(
          surface === "workspace"
            ? `/api/workspace/projects`
            : `/api/projects`,
        );
        if (!res.ok) return;
        const payload = (await res.json()) as {
          projects?: Array<{ projectId: string; name: string }>;
        };
        const found = payload.projects?.find((p) => p.projectId === projectId);
        if (!cancelled && found?.name) setProjectName(found.name);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerApprovalSubmissionId, projectId, surface]);

  useEffect(() => {
    if (!queryEpisodeId) return;
    queueMicrotask(() => setSelectedId(queryEpisodeId));
  }, [queryEpisodeId]);

  const projectVoices = useMemo(
    () => voiceOptionsFromAudios(bundle.audios),
    [bundle.audios],
  );

  const pendingEpisodes = useMemo(
    () =>
      episodes.filter(
        (episode) =>
          episode.designStatus === "not_started" ||
          episode.designStatus === "failed" ||
          episode.designStatus === "stale",
      ),
    [episodes],
  );
  const extractedEpisodes = useMemo(
    () =>
      episodes.filter(
        (episode) =>
          episode.itemCount > 0 &&
          (episode.designStatus === "review" ||
            episode.designStatus === "confirmed" ||
            episode.designStatus === "stale"),
      ),
    [episodes],
  );
  const episodeSelectGroups = useMemo((): GlassSelectGroup[] => {
    const groups: GlassSelectGroup[] = [];
    if (pendingEpisodes.length > 0) {
      groups.push({
        id: "pending",
        label: "待补提取 / 已过期",
        options: pendingEpisodes.map((episode) => ({
          id: episode.episodeId,
          label: `第${episode.episodeNumber}集 · ${EPISODE_ASSET_DESIGN_STATUS_LABELS[episode.designStatus]}`,
        })),
      });
    }
    const readyEpisodes = episodes.filter(
      (episode) => !pendingEpisodes.includes(episode),
    );
    groups.push({
      id: "ready",
      label: isPersonalSpace ? "已提取，可确认" : "已提取，可复核或审批",
      emptyHint: "暂无可复核剧集",
      options: readyEpisodes.map((episode) => ({
        id: episode.episodeId,
        label: `第${episode.episodeNumber}集 · ${EPISODE_ASSET_DESIGN_STATUS_LABELS[episode.designStatus]}`,
      })),
    });
    return groups;
  }, [episodes, isPersonalSpace, pendingEpisodes]);
  const episodeSelectPlaceholder = listLoading
    ? "加载剧集…"
    : pendingEpisodes.length > 0
      ? `待补提取（${pendingEpisodes.length}）`
      : isPersonalSpace
        ? "选择剧集确认"
        : "选择剧集复核";
  const extractedAssets = items;
  const ungeneratedAssets = useMemo(
    () =>
      items.filter(
        (item) =>
          item.assetType !== "audio" &&
          !item.generatedMedia?.currentId?.trim(),
      ),
    [items],
  );
  const libraryAssets = useMemo(
    () => items.filter((item) => isApprovedEpisodeDesignItem(item)),
    [items],
  );
  const generatedAssets = useMemo(
    () =>
      items.filter(
        (item) =>
          item.assetType !== "audio" &&
          Boolean(item.generatedMedia?.currentId?.trim()),
      ),
    [items],
  );
  const summaryItems =
    assetSummaryPanel === "extracted"
      ? ungeneratedAssets
      : assetSummaryPanel === "library"
        ? libraryAssets
        : generatedAssets;
  const summaryTitle =
    assetSummaryPanel === "extracted"
      ? "待生成图片"
      : assetSummaryPanel === "library"
        ? "已入库资产"
        : "已提取资产";

  useEffect(() => {
    if (!assetSummaryPanel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAssetSummaryPanel(null);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!summaryRef.current?.contains(event.target as Node)) {
        setAssetSummaryPanel(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [assetSummaryPanel]);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await designFetch(
        `${apiRoot}/asset-designs`,
      );
      if (!res.ok) throw new Error("无法加载剧集列表");
      const data = (await res.json()) as { items: EpisodeListItem[] };
      setEpisodes(data.items ?? []);
      setExtractingEpisodeIds((prev) => {
        const next = new Set(prev);
        for (const ep of data.items ?? []) {
          if (ep.designStatus === "generating") {
            next.add(ep.episodeId);
          } else {
            next.delete(ep.episodeId);
          }
        }
        return next;
      });
      setSelectedId((prev) => {
        if (prev === "") return prev;
        if (prev && data.items.some((ep) => ep.episodeId === prev)) return prev;
        return "";
      });
    } catch (error) {
      setPageNote(
        error instanceof Error ? error.message : "无法加载剧集列表",
      );
    } finally {
      setListLoading(false);
    }
  }, [apiRoot]);

  const loadBundle = useCallback(async () => {
    try {
      const res = await designFetch(
        `${apiRoot}/assets-draft`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { draft?: ProjectAssetBundle | null };
      if (data.draft) {
        setBundle({
          characters: data.draft.characters ?? [],
          scenes: data.draft.scenes ?? [],
          props: data.draft.props ?? [],
          audios: data.draft.audios ?? [],
        });
      }
    } catch {
      /* ignore */
    }
  }, [apiRoot]);

  const loadApprovalMediaFlags = useCallback(
    async (episodeId: string) => {
      if (isPersonalSpace) {
        setPendingApprovalMediaIds(new Set());
        setApprovedApprovalMediaIds(new Set());
        return;
      }
      try {
        const url =
          surface === "workspace"
            ? `${apiRoot}/asset-approvals?episodeId=${encodeURIComponent(episodeId)}`
            : `/api/projects/${encodeURIComponent(projectId)}/asset-approvals?episodeId=${encodeURIComponent(episodeId)}`;
        const res = await designFetch(url);
        if (!res.ok) {
          setPendingApprovalMediaIds(new Set());
          setApprovedApprovalMediaIds(new Set());
          return;
        }
        const payload = (await res.json()) as {
          submissions?: Array<{
            items: Array<{ generatedMediaId: string; status: string }>;
          }>;
          candidates?: Array<{
            generatedMediaId: string;
            status: string;
          }>;
        };
        const pending = new Set<string>();
        const approved = new Set<string>();
        for (const sub of payload.submissions ?? []) {
          for (const row of sub.items) {
            const id = row.generatedMediaId?.trim();
            if (!id) continue;
            if (row.status === "pending") pending.add(id);
            if (row.status === "approved") approved.add(id);
          }
        }
        for (const c of payload.candidates ?? []) {
          const id = c.generatedMediaId?.trim();
          if (!id) continue;
          if (c.status === "pending_approval") pending.add(id);
          if (c.status === "approved" || c.status === "in_library") {
            approved.add(id);
          }
        }
        setPendingApprovalMediaIds(pending);
        setApprovedApprovalMediaIds(approved);
      } catch {
        setPendingApprovalMediaIds(new Set());
        setApprovedApprovalMediaIds(new Set());
      }
    },
    [apiRoot, isPersonalSpace, projectId, surface],
  );

  const loadDetail = useCallback(
    async (episodeId: string) => {
      if (!episodeId) {
        setDetail(null);
        setItems([]);
        setDetailLoading(false);
        return;
      }
      setDetailLoading(true);
      setConfirmSummary(null);
      try {
        const detailRes = await designFetch(
          `${apiRoot}/asset-designs/episodes/${encodeURIComponent(episodeId)}`,
        );
        if (!detailRes.ok) throw new Error("无法加载剧集资产设计");
        const payload = (await detailRes.json()) as EpisodeDetailPayload;
        setDetail(payload);
        setItems((prevItems) =>
          payload.record.items.map((incoming) => {
            const local = prevItems.find((p) => p.id === incoming.id);
            const mergedMedia = mergeGeneratedMediaState(
              local?.generatedMedia,
              incoming.generatedMedia,
            );
            return mergedMedia
              ? { ...incoming, generatedMedia: mergedMedia }
              : incoming;
          }),
        );
        setDesignModalItem((prev) => {
          if (!prev) return prev;
          const next = payload.record.items.find((i) => i.id === prev.id);
          if (!next) return prev;
          const mergedMedia = mergeGeneratedMediaState(
            prev.generatedMedia,
            next.generatedMedia,
          );
          return mergedMedia ? { ...next, generatedMedia: mergedMedia } : next;
        });
        setRevision(payload.record.revision);
        revisionRef.current = payload.record.revision;
        setFingerprint(payload.currentFingerprint);
        if (payload.designStatus === "generating") {
          setDesignStatus("generating");
          markEpisodeExtracting(episodeId, true);
        } else {
          setDesignStatus(payload.designStatus);
          markEpisodeExtracting(episodeId, false);
        }

        let content = payload.episode.content?.replace(/\r\n/g, "\n") ?? "";
        if (!content) {
          const scriptUrl =
            surface === "workspace"
              ? `${apiRoot}/script-draft`
              : `/api/projects/${encodeURIComponent(projectId)}/script-draft`;
          const scriptRes = await designFetch(scriptUrl);
          if (scriptRes.ok) {
            const script = (await scriptRes.json()) as {
              draft?: {
                sourceText?: string | null;
                episodes?: Array<{ id: string; content?: string }>;
              };
            };
            const ep = script.draft?.episodes?.find((e) => e.id === episodeId);
            content = ep?.content?.replace(/\r\n/g, "\n") ?? "";
          }
        }
        setEpisodeContent(content);
        setContentLength(content.trim().length);
        void loadApprovalMediaFlags(episodeId);
        if (
          (headless || embeddedInLibrary) &&
          payload.designStatus === "review" &&
          payload.record.items.length > 0
        ) {
          const reviewKey = `${episodeId}:${payload.record.revision}:${payload.record.updatedAt ?? ""}`;
          if (reviewReadyKeyRef.current !== reviewKey) {
            reviewReadyKeyRef.current = reviewKey;
            onExtractionReviewReady?.({
              episodeId,
              episodeNumber: payload.episode.episodeNumber,
              episodeTitle: payload.episode.title ?? "",
              items: payload.record.items,
              revision: payload.record.revision,
              fingerprint: payload.currentFingerprint,
            });
          }
        }
      } catch (error) {
        setPageNote(
          error instanceof Error ? error.message : "无法加载剧集资产设计",
        );
      } finally {
        setDetailLoading(false);
      }
    },
    [
      apiRoot,
      embeddedInLibrary,
      headless,
      loadApprovalMediaFlags,
      markEpisodeExtracting,
      onExtractionReviewReady,
      projectId,
      surface,
    ],
  );

  useEffect(() => {
    if (!controlledEpisodeId) return;
    void loadDetail(controlledEpisodeId);
  }, [controlledEpisodeId, loadDetail]);

  useEffect(() => {
    let cancelled = false;
    let sawBlocking = false;
    const tick = async () => {
      try {
        const res = await fetch(`${apiRoot}/asset-extraction`, {
          credentials: "include",
        });
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as {
          task?: PublicAssetExtractionTask | null;
        };
        const task = payload.task ?? null;
        applyExtractionTask(task);

        if (
          task &&
          isAwaitingRosterSelectionStatus(task.status) &&
          task.scope === "episode" &&
          Array.isArray(task.roster) &&
          task.roster.length > 0
        ) {
          sawBlocking = true;
          setRosterSelectionTask(task);
          // Auto-open for the episode that owns this roster (or current selection).
          if (
            !task.episodeId ||
            task.episodeId === selectedIdRef.current ||
            !selectedIdRef.current
          ) {
            setRosterDialogOpen(true);
          }
          return;
        }

        if (task && isLiveExtractionStatus(task.status)) {
          sawBlocking = true;
          if (!isAwaitingRosterSelectionStatus(task.status)) {
            setRosterDialogOpen(false);
          }
          return;
        }

        if (sawBlocking) {
          sawBlocking = false;
          setRosterSelectionTask(null);
          setRosterDialogOpen(false);
          const selected = selectedIdRef.current;
          if (selected) void loadDetail(selected);
          void loadList();
          void loadBundle();
          void onExtractionComplete?.();
        }
      } catch {
        /* keep polling */
      }
    };
    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [apiRoot, applyExtractionTask, loadBundle, loadDetail, loadList, onExtractionComplete]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setListLoading(true);
      try {
        const [listRes] = await Promise.all([
          fetch(`${apiRoot}/asset-designs`),
        ]);
        if (cancelled) return;

        if (listRes.ok) {
          const data = (await listRes.json()) as { items: EpisodeListItem[] };
          if (cancelled) return;
          const listItems = data.items ?? [];
          setEpisodes(listItems);
          setSelectedId((prev) => {
            if (prev === "") return prev;
            if (prev && listItems.some((ep) => ep.episodeId === prev)) return prev;
            return "";
          });
        } else {
          setPageNote("无法加载剧集列表");
        }

      } catch {
        if (!cancelled) setPageNote("无法加载剧集列表");
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiRoot]);

  useEffect(() => {
    let cancelled = false;
    const loadDeferred = async () => {
      const [bundleRes] = await Promise.all([
        fetch(`${apiRoot}/assets-draft`),
      ]);
      if (cancelled) return;
      if (bundleRes.ok) {
        const data = (await bundleRes.json()) as {
          draft?: ProjectAssetBundle | null;
        };
        if (data.draft) {
          setBundle({
            characters: data.draft.characters ?? [],
            scenes: data.draft.scenes ?? [],
            props: data.draft.props ?? [],
            audios: data.draft.audios ?? [],
          });
        }
      }
    };
    const schedule =
      "requestIdleCallback" in window
        ? window.requestIdleCallback(loadDeferred, { timeout: 1200 })
        : globalThis.setTimeout(loadDeferred, 0);
    return () => {
      cancelled = true;
      if (typeof schedule === "number" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(schedule);
      } else {
        globalThis.clearTimeout(schedule as number);
      }
    };
  }, [apiRoot]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDetail(selectedId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDetail, selectedId]);

  const applyRecord = useCallback((record: EpisodeAssetDesignRecord) => {
    if (record.revision < revisionRef.current) return;

    setItems(record.items);
    itemsRef.current = record.items;
    setRevision(record.revision);
    revisionRef.current = record.revision;
    setDesignStatus(record.status);
    setGeneratingPromptIds(
      new Set(
        record.items
          .filter((item) => item.designPrompt?.status === "generating")
          .map((item) => item.id),
      ),
    );
    const progress = record.items.reduce(
      (acc, item) => {
        const status = item.designPrompt?.status;
        const text = item.designPrompt?.text?.trim() ?? "";
        if (status === "ready" && text) acc.ready += 1;
        else if (status === "failed") acc.failed += 1;
        else if (status === "generating") acc.generating += 1;
        else if (!text) acc.missing += 1;
        return acc;
      },
      { ready: 0, failed: 0, generating: 0, missing: 0 },
    );
    if (progress.generating > 0 || (progress.failed > 0 && progress.ready > 0)) {
      setPageNote(
        `素材提示词：已完成 ${progress.ready} / 总数 ${record.items.length}，失败 ${progress.failed}` +
          (progress.generating > 0 ? `（进行中 ${progress.generating}）` : ""),
      );
    }
  }, []);

  const kickOffFormalDesignPrompts = useCallback(
    async (record: EpisodeAssetDesignRecord, episodeId: string) => {
      const batchKey = `${episodeId}|r${record.revision}|${record.items
        .map((item) => item.id)
        .join(",")}`;
      if (
        autoPromptBatchKeysRef.current.has(batchKey) ||
        activePromptEpisodesRef.current.has(episodeId)
      ) {
        return;
      }

      const targetCount = record.items.filter(
        itemNeedsFormalDesignPrompt,
      ).length;
      if (targetCount === 0) return;
      autoPromptBatchKeysRef.current.add(batchKey);
      activePromptEpisodesRef.current.add(episodeId);

      try {
        setPromptBatchProgress({
          episodeId,
          active: true,
          total: targetCount,
          processed: 0,
          completed: 0,
          failed: 0,
          batchSize: 5,
          assetTotal: record.items.length,
        });
        updateExtractionProgress(episodeId, 25);

        const { ok, failed, started } =
          await autoGenerateMissingFormalDesignPrompts({
        surface,
        projectId,
        episodeId,
        items: record.items,
        promptModelId: DEFAULT_DESIGN_PROMPT_MODEL_ID,
        onProgress: (progress) => {
          setPromptBatchProgress({
            episodeId,
            active: progress.completed + progress.failed < progress.total,
            total: progress.total,
            processed: progress.processed,
            completed: progress.completed,
            failed: progress.failed,
            batchSize: progress.batchSize ?? 5,
            assetTotal: record.items.length,
          });
          setPageNote(
            `素材提示词生成中：已完成 ${progress.completed} / 总数 ${progress.total}，失败 ${progress.failed}`,
          );
        },
        onItemStart: (item) => {
          setGeneratingPromptIds((prev) => {
            const next = new Set(prev);
            next.add(item.id);
            return next;
          });
          setItems((prev) => {
            const next = prev.map((row) =>
              row.id === item.id
                ? {
                    ...row,
                    designPrompt: {
                      status: "generating" as const,
                      text: "",
                      generationId: row.designPrompt?.generationId ?? null,
                      sourceFingerprint:
                        row.designPrompt?.sourceFingerprint ?? null,
                      generatedAt: row.designPrompt?.generatedAt ?? null,
                      updatedAt: new Date().toISOString(),
                      errorMessage: null,
                      history: row.designPrompt?.history ?? [],
                    },
                  }
                : row,
            );
            itemsRef.current = next;
            return next;
          });
        },
        onItemSuccess: (item, result) => {
          setGeneratingPromptIds((prev) => {
            const next = new Set(prev);
            next.delete(item.id);
            return next;
          });
          const now = new Date().toISOString();
          setItems((prev) => {
            const next = prev.map((row) =>
              row.id === item.id
                ? {
                    ...row,
                    designPrompt: {
                      status: "ready" as const,
                      text: result.text,
                      generationId: result.generationId,
                      sourceFingerprint:
                        row.designPrompt?.sourceFingerprint ?? null,
                      generatedAt: now,
                      updatedAt: now,
                      errorMessage: null,
                      history: result.history,
                    },
                  }
                : row,
            );
            itemsRef.current = next;
            return next;
          });
          setDesignModalItem((prev) =>
            prev && prev.id === item.id
              ? {
                  ...prev,
                  designPrompt: {
                    status: "ready" as const,
                    text: result.text,
                    generationId: result.generationId,
                    sourceFingerprint:
                      prev.designPrompt?.sourceFingerprint ?? null,
                    generatedAt: now,
                    updatedAt: now,
                    errorMessage: null,
                    history: result.history,
                  },
                }
              : prev,
          );
        },
        onItemError: (item, error) => {
          setGeneratingPromptIds((prev) => {
            const next = new Set(prev);
            next.delete(item.id);
            return next;
          });
          setItems((prev) => {
            const next = prev.map((row) =>
              row.id === item.id
                ? {
                    ...row,
                    designPrompt: {
                      status: "failed" as const,
                      text: "",
                      generationId: row.designPrompt?.generationId ?? null,
                      sourceFingerprint:
                        row.designPrompt?.sourceFingerprint ?? null,
                      generatedAt: row.designPrompt?.generatedAt ?? null,
                      updatedAt: new Date().toISOString(),
                      errorMessage: error.message,
                      history: row.designPrompt?.history ?? [],
                    },
                  }
                : row,
            );
            itemsRef.current = next;
            return next;
          });
        },
      });

      if (started > 0) {
        setPromptBatchProgress({
          episodeId,
          active: false,
          total: started,
          processed: started,
          completed: ok,
          failed,
          batchSize: 5,
          assetTotal: record.items.length,
        });
        setPageNote(
          `素材提示词：已完成 ${ok} / 总数 ${started}，失败 ${failed}` +
            (failed > 0 ? "（可在设计弹窗重试）" : "。"),
        );
      }
      } finally {
        activePromptEpisodesRef.current.delete(episodeId);
      }
    },
    [projectId, surface, updateExtractionProgress],
  );

  const saveItems = useCallback(
    async (
      nextItems: EpisodeAssetDesignItem[],
      options?: {
        status?: EpisodeAssetDesignStatus;
        /** Override optimistic concurrency token. */
        expectedRevision?: number;
        /** Skip the “保存中…” chrome (used while marking extract status). */
        silent?: boolean;
        /** Skip list refresh after save. */
        skipReloadList?: boolean;
      },
    ): Promise<EpisodeAssetDesignRecord | null> => {
      if (!selectedId || !fingerprint) return null;
      if (!options?.silent) {
        setSaving(true);
        setPageNote("");
      }
      try {
        const res = await designFetch(
          `${apiRoot}/asset-designs/episodes/${encodeURIComponent(selectedId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision:
                options?.expectedRevision ?? revisionRef.current,
              fingerprint,
              items: nextItems.map((item) => ({
                ...item,
                note: typeof item.note === "string" ? item.note : "",
                resolution:
                  item.resolution === "pending"
                    ? "create_new"
                    : item.resolution,
              })),
              ...(options?.status ? { status: options.status } : {}),
            }),
          },
        );
        const payload = (await res.json()) as {
          record?: EpisodeAssetDesignRecord;
          error?: string;
        };
        if (!res.ok) throw new Error(payload.error ?? "保存失败");
        if (
          payload.record &&
          shouldApplySavedDesignRecord(
            payload.record.revision,
            revisionRef.current,
          )
        ) {
          applyRecord(payload.record);
        }
        if (!options?.silent) {
          setPageNote("已保存本集资产。");
        }
        if (!options?.skipReloadList) {
          await loadList();
        }
        return payload.record ?? null;
      } catch (error) {
        setPageNote(error instanceof Error ? error.message : "保存失败");
        return null;
      } finally {
        if (!options?.silent) {
          setSaving(false);
        }
      }
    },
    [apiRoot, applyRecord, fingerprint, loadList, selectedId],
  );

  const bindMediaVoice = useCallback(
    async (input: {
      itemId: string;
      mediaId: string;
      voiceId: string;
      voiceName: string | null;
    }): Promise<boolean> => {
      if (!selectedId) return false;

      setSavingVoiceItemIds((prev) => new Set(prev).add(input.itemId));

      try {
        const res = await designFetch(
          `${apiRoot}/asset-designs/episodes/${encodeURIComponent(
            selectedId,
          )}/items/${encodeURIComponent(input.itemId)}/media-voice`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mediaId: input.mediaId,
              voiceId: input.voiceId,
              voiceName: input.voiceName,
              voiceBound: true,
            }),
          },
        );

        const payload = (await res.json()) as {
          record?: EpisodeAssetDesignRecord;
          item?: EpisodeAssetDesignItem;
          error?: string;
        };
        if (!res.ok || !payload.record) {
          throw new Error(payload.error ?? "音色绑定失败");
        }

        applyRecord(payload.record);

        setDesignModalItem((current) =>
          current?.id === input.itemId
            ? payload.record!.items.find((row) => row.id === input.itemId) ??
              current
            : current,
        );

        return true;
      } catch (error) {
        setPageNote(
          error instanceof Error ? error.message : "音色绑定失败",
        );
        return false;
      } finally {
        setSavingVoiceItemIds((prev) => {
          const next = new Set(prev);
          next.delete(input.itemId);
          return next;
        });
      }
    },
    [apiRoot, applyRecord, selectedId],
  );

  const markExtractStatusForEpisode = useCallback(
    async (input: {
      episodeId: string;
      status: "generating" | "failed";
      fingerprint: string;
      expectedRevision: number;
      items: EpisodeAssetDesignItem[];
      activeGeneration?: EpisodeAssetActiveGeneration | null;
    }): Promise<EpisodeAssetDesignRecord | null> => {
      try {
        const res = await designFetch(
          `${apiRoot}/asset-designs/episodes/${encodeURIComponent(input.episodeId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: input.expectedRevision,
              fingerprint: input.fingerprint,
              items: input.items.map((item) => ({
                ...item,
                note: typeof item.note === "string" ? item.note : "",
                resolution:
                  item.resolution === "pending"
                    ? "create_new"
                    : item.resolution,
              })),
              status: input.status,
              ...(input.activeGeneration !== undefined
                ? { activeGeneration: input.activeGeneration }
                : input.status === "failed"
                  ? { activeGeneration: null }
                  : {}),
            }),
          },
        );
        const payload = (await res.json()) as {
          record?: EpisodeAssetDesignRecord;
          error?: string;
        };
        if (!res.ok) throw new Error(payload.error ?? "无法更新提取状态");
        return payload.record ?? null;
      } catch (error) {
        if (selectedIdRef.current === input.episodeId) {
          setPageNote(
            error instanceof Error ? error.message : "无法更新提取状态",
          );
        }
        return null;
      }
    },
    [apiRoot],
  );

  const putEpisodeExtractStatus = markExtractStatusForEpisode;

  const markExtractFailedWithRetry = useCallback(
    async (input: {
      episodeId: string;
      fingerprint: string;
      expectedRevision: number;
      items: EpisodeAssetDesignItem[];
    }): Promise<boolean> => {
      const first = await markExtractStatusForEpisode({
        episodeId: input.episodeId,
        status: "failed",
        fingerprint: input.fingerprint,
        expectedRevision: input.expectedRevision,
        items: input.items,
        activeGeneration: null,
      });
      if (first) return true;

      try {
        const detailRes = await designFetch(
          `${apiRoot}/asset-designs/episodes/${encodeURIComponent(input.episodeId)}`,
        );
        if (!detailRes.ok) return false;
        const detailPayload = (await detailRes.json()) as EpisodeDetailPayload;
        const retry = await markExtractStatusForEpisode({
          episodeId: input.episodeId,
          status: "failed",
          fingerprint: detailPayload.currentFingerprint,
          expectedRevision: detailPayload.record.revision,
          items: detailPayload.record.items,
          activeGeneration: null,
        });
        return retry !== null;
      } catch {
        return false;
      }
    },
    [apiRoot, markExtractStatusForEpisode],
  );

  const finalizeExtraction = useCallback(
    async (input: {
      episodeId: string;
      record: EpisodeAssetDesignRecord;
      fingerprint: string;
    }): Promise<boolean> => {
      if (!approvalEnabled) {
        const detailResponse = await designFetch(
          `${apiRoot}/asset-designs/episodes/${encodeURIComponent(input.episodeId)}`,
        );
        const detailPayload = (await detailResponse.json()) as EpisodeDetailPayload & {
          error?: string;
        };
        if (!detailResponse.ok) {
          setPageNote(detailPayload.error ?? "无法读取最新资产提取结果");
          return false;
        }
        const response = await designFetch(
          `${apiRoot}/asset-designs/episodes/${encodeURIComponent(input.episodeId)}/confirm`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: detailPayload.record.revision,
              fingerprint: input.fingerprint,
            }),
          },
        );
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          setPageNote(payload.error ?? "提取结果同步失败");
          return false;
        }
        await loadBundle();
      }
      await onExtractionComplete?.();
      return true;
    },
    [apiRoot, approvalEnabled, loadBundle, onExtractionComplete],
  );

  // A refresh may observe an extract that server reconciliation already
  // applied, or a previous prompt batch that only partially completed.
  // Resume the existing 3 x 5 prompt route before personal-space sync.
  useEffect(() => {
    const record = detail?.record;
    if (!record || record.episodeId !== selectedId) return;
    if (record.status !== "review" || currentEpisodeExtracting) return;
    const needsFormalPrompts = record.items.some(itemNeedsFormalDesignPrompt);
    if (!needsFormalPrompts && approvalEnabled) return;
    queueMicrotask(() => {
      void (async () => {
        if (needsFormalPrompts) {
          await kickOffFormalDesignPrompts(record, record.episodeId);
        }
        if (!approvalEnabled && !headless && !embeddedInLibrary) {
          const synced = await finalizeExtraction({
            episodeId: record.episodeId,
            record,
            fingerprint: detail.currentFingerprint,
          });
          if (synced) await loadDetail(record.episodeId);
        }
      })();
    });
  }, [
    approvalEnabled,
    currentEpisodeExtracting,
    detail,
    embeddedInLibrary,
    finalizeExtraction,
    headless,
    kickOffFormalDesignPrompts,
    loadDetail,
    selectedId,
  ]);

  const runExtract = useCallback(async () => {
    if (!selectedId || extractionBusy) return;
    const res = await fetch(`${apiRoot}/asset-extraction/tasks`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "episode",
        episodeId: selectedId,
        modelKey: activeAssetExtractionModel,
      }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setExtractionError({
        code: "EXTRACT_FAILED",
        message: payload.error ?? "无法开始提取本集资产",
      });
      return;
    }
    markEpisodeExtracting(selectedId, true);
    setDesignStatus("generating");
    setExtractionError(null);
    setRosterSubmitError(null);
  }, [
    activeAssetExtractionModel,
    apiRoot,
    extractionBusy,
    markEpisodeExtracting,
    selectedId,
  ]);

  const confirmRosterSelection = useCallback(
    async (selectedAssetKeys: string[]) => {
      const task = rosterSelectionTask;
      if (!task?.id) return;
      setRosterSubmitting(true);
      setRosterSubmitError(null);
      try {
        const res = await fetch(
          `${apiRoot}/asset-extraction/tasks/${encodeURIComponent(task.id)}/roster-selection`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ selectedAssetKeys }),
          },
        );
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          task?: PublicAssetExtractionTask;
        };
        if (!res.ok) {
          setRosterSubmitError(payload.error ?? "无法确认资产选择");
          return;
        }
        setRosterDialogOpen(false);
        setRosterSelectionTask(null);
        if (payload.task) applyExtractionTask(payload.task);
        else if (task.episodeId) markEpisodeExtracting(task.episodeId, true);
        setDesignStatus("generating");
      } catch {
        setRosterSubmitError("无法确认资产选择");
      } finally {
        setRosterSubmitting(false);
      }
    },
    [apiRoot, applyExtractionTask, markEpisodeExtracting, rosterSelectionTask],
  );

  const runExtractRef = useRef(runExtract);
  useEffect(() => {
    runExtractRef.current = runExtract;
  }, [runExtract]);

  const handleConfirm = useCallback(async () => {
    if (!selectedId || !fingerprint) return;
    const latestItems = itemsRef.current;
    const missingImages = latestItems.filter(
      (item) =>
        (item.resolution === "create_new" || item.resolution === "pending") &&
        item.assetType !== "audio" &&
        !item.generatedMedia?.currentId?.trim(),
    );
    if (missingImages.length > 0) {
      setPageNote(
        `无法确认：${missingImages.map((item) => item.name).join("、")}尚未生成图片。`,
      );
      return;
    }
    const unboundVoices = latestItems.filter((item) => {
      if (item.resolution !== "create_new" || item.assetType !== "character") {
        return false;
      }
      const mediaId = item.generatedMedia?.currentId?.trim();
      return !mediaId || !isMediaVoiceBound(getDesignMediaVoiceBinding(item, mediaId));
    });
    setConfirming(true);
    setPageNote("");
    try {
      const savedRecord = await saveItems(latestItems);
      if (!savedRecord) return;

      const res = await designFetch(
        `${apiRoot}/asset-designs/episodes/${encodeURIComponent(selectedId)}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: savedRecord.revision,
            fingerprint,
          }),
        },
      );
      const payload = (await res.json()) as {
        counts?: { created: number; linked: number; ignored: number };
        record?: EpisodeAssetDesignRecord;
        createdAssets?: Array<{
          itemId: string;
          assetId: string;
          assetType: EpisodeAssetDesignAssetType;
        }>;
        promoted?: Array<{
          itemId: string;
          assetId: string;
          assetType: EpisodeAssetDesignAssetType;
        }>;
        skipped?: Array<{ itemId: string; code: string; message: string }>;
        failed?: Array<{ itemId: string; code: string; message: string }>;
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error ?? "确认失败");
      if (payload.record) applyRecord(payload.record);
      const counts = payload.counts ?? { created: 0, linked: 0, ignored: 0 };
      const promoted = payload.promoted ?? payload.createdAssets ?? [];
      const skipped = payload.skipped ?? [];
      const failed = payload.failed ?? [];
      const nameOf = (itemId: string) =>
        latestItems.find((item) => item.id === itemId)?.name ?? itemId;

      const hasPendingConfirm = skipped.length > 0 || failed.length > 0;
      setConfirmSummary(
        hasPendingConfirm
          ? "部分入库，仍待处理。"
          : "本集资产已确认并自动加入资产库。",
      );
      let note =
        counts.created || counts.linked || counts.ignored
          ? `新增 ${counts.created} 项，关联已有 ${counts.linked} 项，忽略 ${counts.ignored} 项。`
          : "";

      if (promoted.length || skipped.length || failed.length) {
        const parts: string[] = [];
        if (promoted.length > 0) {
          parts.push(
            `已入库 ${promoted.length} 项：${promoted.map((entry) => nameOf(entry.itemId)).join("、")}`,
          );
        }
        if (skipped.length > 0) {
          parts.push(
            `已跳过 ${skipped.length} 项：${skipped
              .map((entry) => `${nameOf(entry.itemId)}（${entry.message}）`)
              .join("；")}`,
          );
        }
        if (failed.length > 0) {
          parts.push(
            `失败 ${failed.length} 项：${failed
              .map((entry) => `${nameOf(entry.itemId)}（${entry.message}）`)
              .join("；")}`,
          );
        }
        const partialNote = parts.join("。") + "。";
        note = note ? `${note} ${partialNote}` : partialNote;
      }

      const createdAssets = payload.createdAssets ?? promoted;
      if (createdAssets.length > 0) {
        let mediaFailed = false;
        const clearedIds: string[] = [];
        for (const entry of createdAssets) {
          const pending = pendingMedia[entry.itemId];
          if (!pending) continue;
          try {
            if (pending.kind === "image") {
              await uploadProjectAssetImage(
                projectId,
                entry.assetId,
                pending.file,
                {
                  context:
                    surface === "workspace" ? "workspace" : "management",
                },
              );
            } else {
              await uploadProjectAssetAudio(
                projectId,
                entry.assetId,
                pending.file,
              );
            }
            if (pending.objectUrl.startsWith("blob:")) {
              URL.revokeObjectURL(pending.objectUrl);
            }
            clearedIds.push(entry.itemId);
          } catch {
            mediaFailed = true;
          }
        }
        if (clearedIds.length > 0) {
          setPendingMedia((prev) => {
            const next = { ...prev };
            for (const id of clearedIds) delete next[id];
            return next;
          });
        }
        if (mediaFailed) {
          note = note
            ? `${note} 资产已入库，媒体上传失败，可在资产库补传`
            : "资产已入库，媒体上传失败，可在资产库补传";
        }
      }
      if (note) setPageNote(note);
      if (unboundVoices.length > 0) {
        const voiceReminder = `${unboundVoices.length} 个角色尚未绑定音色，可在资产库中继续补充。`;
        setPageNote((current) =>
          current ? `${current} ${voiceReminder}` : voiceReminder,
        );
      }
      await loadList();
      await loadBundle();
    } catch (error) {
      setPageNote(error instanceof Error ? error.message : "确认失败");
    } finally {
      setConfirming(false);
    }
  }, [
    apiRoot,
    applyRecord,
    fingerprint,
    loadBundle,
    loadList,
    pendingMedia,
    projectId,
    saveItems,
    selectedId,
    surface,
  ]);

  const confirmItemToLibrary = useCallback(
    async (itemId: string) => {
      if (!isPersonalSpace || !selectedId || !fingerprint) return;
      if (confirmingRef.current) return;
      const latestItems = itemsRef.current;
      const item = latestItems.find((candidate) => candidate.id === itemId);
      if (!item) return;
      if (item.libraryAssetId?.trim()) return;
      if (
        (item.resolution === "create_new" || item.resolution === "pending") &&
        item.assetType !== "audio" &&
        !item.generatedMedia?.currentId?.trim()
      ) {
        setPageNote(`无法确认：「${item.name}」尚未生成图片。`);
        return;
      }

      confirmingRef.current = true;
      setConfirming(true);
      setConfirmingItemId(itemId);
      setPageNote("");
      try {
        const savedRecord = await saveItems(latestItems, {
          skipReloadList: true,
        });
        if (!savedRecord) return;
        const res = await designFetch(
          `${apiRoot}/asset-designs/episodes/${encodeURIComponent(selectedId)}/confirm`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: savedRecord.revision,
              fingerprint,
              itemId,
            }),
          },
        );
        const payload = (await res.json()) as {
          record?: EpisodeAssetDesignRecord;
          createdAssets?: Array<{
            itemId: string;
            assetId: string;
            assetType: EpisodeAssetDesignAssetType;
          }>;
          promoted?: Array<{
            itemId: string;
            assetId: string;
            assetType: EpisodeAssetDesignAssetType;
          }>;
          skipped?: Array<{ itemId: string; code: string; message: string }>;
          failed?: Array<{ itemId: string; code: string; message: string }>;
          error?: string;
        };
        if (!res.ok) throw new Error(payload.error ?? "确认入库失败");
        if (payload.record) applyRecord(payload.record);

        const skipped = payload.skipped ?? [];
        const failed = payload.failed ?? [];
        const skipForItem = skipped.find((entry) => entry.itemId === itemId);
        const failForItem = failed.find((entry) => entry.itemId === itemId);
        if (skipForItem || failForItem) {
          const detail = skipForItem ?? failForItem!;
          setPageNote(`「${item.name}」未入库：${detail.message}`);
          await Promise.all([loadList(), loadBundle()]);
          return;
        }

        const created = (payload.createdAssets ?? payload.promoted)?.find(
          (entry) => entry.itemId === itemId,
        );
        const pending = pendingMedia[itemId];
        let mediaUploadFailed = false;
        if (created && pending) {
          try {
            if (pending.kind === "image") {
              await uploadProjectAssetImage(
                projectId,
                created.assetId,
                pending.file,
                {
                  context:
                    surface === "workspace" ? "workspace" : "management",
                },
              );
            } else {
              await uploadProjectAssetAudio(
                projectId,
                created.assetId,
                pending.file,
              );
            }
            if (pending.objectUrl.startsWith("blob:")) {
              URL.revokeObjectURL(pending.objectUrl);
            }
            setPendingMedia((previous) => {
              const next = { ...previous };
              delete next[itemId];
              return next;
            });
          } catch {
            mediaUploadFailed = true;
          }
        }

        setPageNote(
          mediaUploadFailed
            ? `「${item.name}」已入库，但媒体上传失败，可在资产库补传。`
            : `「${item.name}」已确认入库。`,
        );
        if (payload.record?.status === "review") {
          setConfirmSummary("部分入库，仍待处理。");
        }
        await Promise.all([loadList(), loadBundle()]);
      } catch (error) {
        setPageNote(error instanceof Error ? error.message : "确认入库失败");
      } finally {
        confirmingRef.current = false;
        setConfirming(false);
        setConfirmingItemId(null);
        setPendingUnboundVoiceConfirmItem(null);
        setPendingUncheckedVideoRefItem(null);
      }
    },
    [
      apiRoot,
      applyRecord,
      fingerprint,
      isPersonalSpace,
      loadBundle,
      loadList,
      pendingMedia,
      projectId,
      saveItems,
      selectedId,
      surface,
    ],
  );

  useEffect(() => {
    if (!embeddedInLibrary || extractRequestId <= 0) return;
    if (handledExtractRequestIdRef.current === extractRequestId) return;
    handledExtractRequestIdRef.current = extractRequestId;
  }, [embeddedInLibrary, extractRequestId, projectId]);

  useEffect(() => {
    if (!headless || !extractionRequest) return;
    if (handledExternalRequestIdRef.current === extractionRequest.id) return;
    if (extractionRequest.mode !== "selected-episode") return;

    pendingEpisodeRequestRef.current = extractionRequest;
    if (selectedId !== extractionRequest.episodeId) {
      setSelectedId(extractionRequest.episodeId);
      void loadDetail(extractionRequest.episodeId);
      return;
    }
    if (
      detailLoading ||
      detail?.record.episodeId !== extractionRequest.episodeId
    ) {
      return;
    }

    const contentLength =
      detail?.episode.content?.trim().length ??
      episodeContent.trim().length;
    if (contentLength <= 0) {
      handledExternalRequestIdRef.current = extractionRequest.id;
      pendingEpisodeRequestRef.current = null;
      onExtractionRequestConsumed?.(extractionRequest.id);
      onExtractionNote?.("当前剧集没有有效剧本内容，无法提取资产。");
      void onExtractionComplete?.();
      return;
    }

    pendingEpisodeRequestRef.current = null;
    handledExternalRequestIdRef.current = extractionRequest.id;
    onExtractionRequestConsumed?.(extractionRequest.id);
    queueMicrotask(() => void runExtractRef.current());
  }, [
    detail,
    detailLoading,
    episodeContent,
    extractionRequest,
    headless,
    loadDetail,
    onExtractionComplete,
    onExtractionNote,
    onExtractionRequestConsumed,
    selectedId,
  ]);

  useEffect(() => {
    if (
      !headless ||
      !showApprovalUi ||
      surface !== "workspace" ||
      submitApprovalRequestId <= 0 ||
      handledSubmitApprovalRequestIdRef.current === submitApprovalRequestId
    ) {
      return;
    }
    handledSubmitApprovalRequestIdRef.current = submitApprovalRequestId;
    queueMicrotask(() => setSubmitApprovalOpen(true));
  }, [headless, showApprovalUi, submitApprovalRequestId, surface]);

  const handleConfirmItem = useCallback(
    (itemId: string) => {
      if (!isPersonalSpace || !selectedId || !fingerprint) return;
      if (saving || confirmingRef.current || confirming || confirmingItemId) {
        return;
      }
      const latestItems = itemsRef.current;
      const item = latestItems.find((candidate) => candidate.id === itemId);
      if (!item) return;
      if (item.libraryAssetId?.trim()) return;
      if (
        (item.resolution === "create_new" || item.resolution === "pending") &&
        item.assetType !== "audio" &&
        !item.generatedMedia?.currentId?.trim()
      ) {
        setPageNote(`无法确认：「${item.name}」尚未生成图片。`);
        return;
      }

      // Characters: current-image person verification must pass before voice/入库.
      if (characterNeedsUncheckedVideoRefBlock(item)) {
        setPendingUncheckedVideoRefItem({ id: item.id, name: item.name });
        return;
      }

      if (characterNeedsUnboundVoiceConfirm(item)) {
        setPendingUnboundVoiceConfirmItem({ id: item.id, name: item.name });
        return;
      }

      void confirmItemToLibrary(itemId);
    },
    [
      confirmItemToLibrary,
      confirming,
      confirmingItemId,
      fingerprint,
      isPersonalSpace,
      saving,
      selectedId,
    ],
  );

  const dismissUncheckedVideoRefBlock = useCallback(() => {
    setPendingUncheckedVideoRefItem(null);
  }, []);

  const dismissUnboundVoiceConfirm = useCallback(() => {
    if (confirmingRef.current || confirming || confirmingItemId) return;
    setPendingUnboundVoiceConfirmItem(null);
  }, [confirming, confirmingItemId]);

  const updateItem = useCallback(
    (id: string, patch: Partial<EpisodeAssetDesignItem>) => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? ({ ...item, ...patch } as EpisodeAssetDesignItem) : item,
        ),
      );
    },
    [],
  );

  const revokePendingForItem = useCallback((id: string) => {
    setPendingMedia((prev) => {
      const entry = prev[id];
      if (!entry) return prev;
      if (entry.objectUrl.startsWith("blob:")) {
        URL.revokeObjectURL(entry.objectUrl);
      }
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const deleteItem = useCallback(
    (id: string) => {
      const target = items.find((item) => item.id === id);
      if (
        surface === "workspace" &&
        target &&
        isApprovedEpisodeDesignItem(target)
      ) {
        setPageNote(
          "工作台无法删除已审批入库的资产，请联系主理人在项目管理中删除",
        );
        return;
      }
      revokePendingForItem(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
    },
    [items, revokePendingForItem, surface],
  );

  const openCreateDialog = useCallback(
    (assetType: EpisodeAssetDesignAssetType) => {
      setCreateDialogType(assetType);
      setEditingItemId(null);
    },
    [],
  );

  const closeCreateDialog = useCallback(() => {
    setCreateDialogType(null);
    setEditingItemId(null);
  }, []);

  const upsertPendingMedia = useCallback(
    (
      itemId: string,
      kind: "image" | "audio",
      file: File | null | undefined,
      objectUrl: string | null | undefined,
    ) => {
      setPendingMedia((prev) => {
        const old = prev[itemId];
        if (file) {
          const url =
            objectUrl?.startsWith("blob:") && objectUrl
              ? objectUrl
              : URL.createObjectURL(file);
          if (
            old &&
            old.objectUrl !== url &&
            old.objectUrl.startsWith("blob:")
          ) {
            URL.revokeObjectURL(old.objectUrl);
          }
          return { ...prev, [itemId]: { kind, file, objectUrl: url } };
        }
        if (!objectUrl && old) {
          if (old.objectUrl.startsWith("blob:")) {
            URL.revokeObjectURL(old.objectUrl);
          }
          const next = { ...prev };
          delete next[itemId];
          return next;
        }
        return prev;
      });
    },
    [],
  );

  const handleCharacterDialogSubmit = useCallback(
    (draft: CharacterDraftInput) => {
      const previous =
        editingItemId != null
          ? (itemsRef.current.find(
              (item) =>
                item.id === editingItemId && item.assetType === "character",
            ) as CharacterDesignItem | undefined) ?? null
          : null;
      const id = previous?.id ?? newItemId();
      const nextItem = itemFromCharacterDraft(draft, {
        id,
        projectVoices,
        previous,
      });
      if (previous) {
        setItems((prev) =>
          prev.map((item) => (item.id === id ? nextItem : item)),
        );
      } else {
        setItems((prev) => [...prev, nextItem]);
      }
      upsertPendingMedia(
        id,
        "image",
        draft.pendingImageFile,
        draft.imageObjectUrl,
      );
      closeCreateDialog();
    },
    [closeCreateDialog, editingItemId, projectVoices, upsertPendingMedia],
  );

  const handleSceneDialogSubmit = useCallback(
    (draft: SceneDraftInput) => {
      const previous =
        editingItemId != null
          ? (items.find(
              (item) =>
                item.id === editingItemId && item.assetType === "scene",
            ) as SceneDesignItem | undefined) ?? null
          : null;
      const id = previous?.id ?? newItemId();
      const nextItem = itemFromSceneDraft(draft, { id, previous });
      if (previous) {
        setItems((prev) =>
          prev.map((item) => (item.id === id ? nextItem : item)),
        );
      } else {
        setItems((prev) => [...prev, nextItem]);
      }
      upsertPendingMedia(
        id,
        "image",
        draft.pendingImageFile,
        draft.imageObjectUrl,
      );
      closeCreateDialog();
    },
    [closeCreateDialog, editingItemId, items, upsertPendingMedia],
  );

  const handlePropDialogSubmit = useCallback(
    (draft: PropDraftInput) => {
      const previous =
        editingItemId != null
          ? (items.find(
              (item) =>
                item.id === editingItemId && item.assetType === "prop",
            ) as PropDesignItem | undefined) ?? null
          : null;
      const id = previous?.id ?? newItemId();
      const nextItem = itemFromPropDraft(draft, { id, previous });
      if (previous) {
        setItems((prev) =>
          prev.map((item) => (item.id === id ? nextItem : item)),
        );
      } else {
        setItems((prev) => [...prev, nextItem]);
      }
      upsertPendingMedia(
        id,
        "image",
        draft.pendingImageFile,
        draft.imageObjectUrl,
      );
      closeCreateDialog();
    },
    [closeCreateDialog, editingItemId, items, upsertPendingMedia],
  );

  const editingItem = useMemo(() => {
    if (!editingItemId) return null;
    return items.find((item) => item.id === editingItemId) ?? null;
  }, [editingItemId, items]);

  const characterInitialDraft = useMemo(() => {
    if (createDialogType !== "character" || !editingItem) return null;
    if (editingItem.assetType !== "character") return null;
    return characterDraftFromItem(editingItem, pendingMedia[editingItem.id]);
  }, [createDialogType, editingItem, pendingMedia]);

  const sceneInitialDraft = useMemo(() => {
    if (createDialogType !== "scene" || !editingItem) return null;
    if (editingItem.assetType !== "scene") return null;
    return sceneDraftFromItem(editingItem, pendingMedia[editingItem.id]);
  }, [createDialogType, editingItem, pendingMedia]);

  const propInitialDraft = useMemo(() => {
    if (createDialogType !== "prop" || !editingItem) return null;
    if (editingItem.assetType !== "prop") return null;
    return propDraftFromItem(editingItem, pendingMedia[editingItem.id]);
  }, [createDialogType, editingItem, pendingMedia]);

  const staleWarning =
    detail &&
    detail.record.contentFingerprint &&
    detail.currentFingerprint !== detail.record.contentFingerprint;

  const extractLabel =
    designStatus === "review" ||
    designStatus === "confirmed" ||
    designStatus === "stale"
      ? "重新提取"
      : "提取本集资产";

  const awaitingRosterForSelected =
    Boolean(rosterSelectionTask) &&
    isAwaitingRosterSelectionStatus(rosterSelectionTask?.status) &&
    (!rosterSelectionTask?.episodeId ||
      rosterSelectionTask.episodeId === selectedId);

  const extractButtonLabel = awaitingRosterForSelected
    ? "待选择资产"
    : extractionBusy
      ? "提取中…"
      : extractionError
        ? "重试提取本集资产"
        : extractLabel;

  const showEpisodeExtractButton = Boolean(selectedId);

  const updatedAtLabel = formatMetaTime(detail?.record.updatedAt);
  const confirmedAtLabel = formatMetaTime(detail?.record.confirmedAt);
  const selectedEpisodeTitle = detail
    ? meaningfulEpisodeTitle(
        detail.episode.episodeNumber,
        detail.episode.title,
      )
    : null;
  const isAwaitingEpisodeExtraction =
    Boolean(selectedId) &&
    designStatus === "not_started" &&
    items.length === 0;

  const canSubmitApproval =
    !extractionBusy && !saving && Boolean(selectedId);

  const canDesign =
    !extractionBusy &&
    !confirming &&
    (designStatus === "review" ||
      designStatus === "confirmed" ||
      designStatus === "stale");

  const visiblePromptBatchProgress = promptBatchProgress;
  const promptGenerationBusy =
    Boolean(visiblePromptBatchProgress?.active) || generatingPromptIds.size > 0;
  const assetPageLocked = promptGenerationBusy;
  const promptProcessed = visiblePromptBatchProgress
    ? visiblePromptBatchProgress.processed ??
      visiblePromptBatchProgress.completed + visiblePromptBatchProgress.failed
    : 0;
  const promptProgressPercent = visiblePromptBatchProgress?.total
    ? Math.min(
        100,
        25 +
          Math.round(
            (promptProcessed / visiblePromptBatchProgress.total) * 75,
          ),
      )
    : 0;
  const workflowProgressPercent = promptGenerationBusy
    ? promptProgressPercent
    : null;
  const workflowProgressLabel = promptGenerationBusy
    ? `共提取 ${visiblePromptBatchProgress?.assetTotal ?? 0} 个资产`
    : "正在提取资产…";
  const storyboardHref =
    surface === "workspace"
      ? workspaceProjectStoryboardPath(projectId)
      : `${projectManagementPath(projectId)}/storyboard`;
  const assetLockTitle = promptGenerationBusy
    ? "资产生成中"
    : extractionBusy
      ? "正在提取资产"
      : "正在生成资产图片";

  useEffect(() => {
    onExtractionProgressChange?.(
      assetPageLocked
        ? {
            percent: workflowProgressPercent ?? 0,
            title: assetLockTitle,
            label: workflowProgressLabel,
          }
        : null,
    );
  }, [
    assetLockTitle,
    assetPageLocked,
    onExtractionProgressChange,
    workflowProgressLabel,
    workflowProgressPercent,
  ]);

  useEffect(() => {
    if (!scriptViewerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setScriptViewerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scriptViewerOpen]);

  useEffect(() => {
    if (!pendingUncheckedVideoRefItem) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPendingUncheckedVideoRefItem(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingUncheckedVideoRefItem]);

  useEffect(() => {
    if (!pendingUnboundVoiceConfirmItem) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirming || confirmingItemId) return;
      setPendingUnboundVoiceConfirmItem(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingUnboundVoiceConfirmItem, confirming, confirmingItemId]);

  const approvalModals = (
    <>
      {showApprovalUi && surface === "workspace" && selectedId ? (
        <SubmitApprovalModal
          open={submitApprovalOpen}
          projectId={projectId}
          projectName={projectName}
          episodeId={selectedId}
          episodeNumber={detail?.episode.episodeNumber ?? 0}
          onClose={() => setSubmitApprovalOpen(false)}
          onSubmitted={(message) => {
            setPageNote(message);
            setConfirmSummary(message);
            if (selectedId) void loadApprovalMediaFlags(selectedId);
          }}
        />
      ) : null}

      {showApprovalUi &&
      surface === "project_management" &&
      ownerApprovalSubmissionId ? (
        <OwnerApproveModal
          open={ownerApprovalOpen}
          projectId={projectId}
          projectName={projectName}
          submissionId={ownerApprovalSubmissionId}
          episodeNumber={detail?.episode.episodeNumber}
          onClose={() => {
            const next = new URLSearchParams(searchParams.toString());
            next.delete("approvalSubmissionId");
            const qs = next.toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname);
          }}
          onApproved={(message) => {
            setPageNote(message);
            if (selectedId) void loadDetail(selectedId);
            if (selectedId) void loadApprovalMediaFlags(selectedId);
            void loadBundle();
          }}
        />
      ) : null}
      <RosterSelectionDialog
        open={rosterDialogOpen}
        episodeLabel={
          rosterSelectionTask?.episodeId
            ? episodes.find((ep) => ep.episodeId === rosterSelectionTask.episodeId)
                ? `第${episodes.find((ep) => ep.episodeId === rosterSelectionTask.episodeId)!.episodeNumber}集`
                : undefined
            : selectedEpisodeTitle ?? undefined
        }
        roster={(rosterSelectionTask?.roster ?? []) as PublicAssetRosterItem[]}
        submitting={rosterSubmitting}
        error={rosterSubmitError}
        onCancel={() => {
          // Keep awaiting_roster_selection; only dismiss the dialog.
          setRosterDialogOpen(false);
          setRosterSubmitError(null);
        }}
        onConfirm={confirmRosterSelection}
      />
    </>
  );

  if (headless) return approvalModals;

  return (
    <div
      className={`ead${embeddedInLibrary ? " ead--library-embedded" : ""}`}
      data-testid="episode-asset-design-workspace"
    >
      <div className="ead-content-shell">
        <div
          className={`ead-layout${isAwaitingEpisodeExtraction ? " is-pending" : ""}`}
          inert={assetPageLocked ? true : undefined}
          aria-busy={assetPageLocked}
        >
        <section className="ead-overview amw-panel" aria-labelledby="ead-overview-title">
          <div className="ead-overview__main">
            <div className="ead-overview__copy">
              <div className="ead-overview__title-row">
                <h2 id="ead-overview-title">资产提取</h2>
              </div>
            </div>

            <div className="ead-overview__summary" ref={summaryRef}>
              <div className="ead-overview__summary-actions">
                <AssetSummaryButton
                  label="提取到的资产"
                  count={extractedAssets.length}
                  active={assetSummaryPanel === "extracted"}
                  testId="ead-summary-extracted"
                  onClick={() =>
                    setAssetSummaryPanel((prev) =>
                      prev === "extracted" ? null : "extracted",
                    )
                  }
                />
                <AssetSummaryButton
                  label="已入库"
                  count={libraryAssets.length}
                  active={assetSummaryPanel === "library"}
                  testId="ead-summary-library"
                  onClick={() =>
                    setAssetSummaryPanel((prev) =>
                      prev === "library" ? null : "library",
                    )
                  }
                />
                <AssetSummaryButton
                  label="已提取"
                  count={generatedAssets.length}
                  active={assetSummaryPanel === "generated"}
                  testId="ead-summary-generated"
                  onClick={() =>
                    setAssetSummaryPanel((prev) =>
                      prev === "generated" ? null : "generated",
                    )
                  }
                />
              </div>

              {assetSummaryPanel ? (
                <div
                  className="ead-summary-popover"
                  role="dialog"
                  aria-label="资产统计"
                  data-testid="ead-summary-popover"
                >
                  <div className="ead-summary-popover__head">
                    <strong>{summaryTitle}</strong>
                    <button
                      type="button"
                      className="ead-summary-popover__close"
                      aria-label="关闭"
                      title="关闭"
                      onClick={() => setAssetSummaryPanel(null)}
                    >
                      <X size={15} aria-hidden />
                    </button>
                  </div>

                  <div className="ead-summary-popover__list">
                    {summaryItems.length === 0 ? (
                      <p className="ead-muted">暂无资产</p>
                    ) : (
                      summaryItems.map((item) => {
                        const disabled = assetSummaryPanel === "library";
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className="ead-summary-popover__item"
                            disabled={disabled}
                            onClick={() => {
                              if (disabled) return;
                              setDesignModalItem(item);
                              setAssetSummaryPanel(null);
                            }}
                          >
                            {item.name}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="ead-episode-tool">
            {awaitingRosterForSelected && !rosterDialogOpen ? (
              <div
                className="roster-selection-banner"
                data-testid="roster-selection-banner"
              >
                <span>本集已发现新资产名单，请选择后再继续设计。</span>
                <button
                  type="button"
                  className="amw-btn amw-btn--primary"
                  onClick={() => setRosterDialogOpen(true)}
                  data-testid="roster-selection-reopen"
                >
                  选择资产
                </button>
              </div>
            ) : null}
            <div className="ead-episode-tool__controls">
              {showEpisodeExtractButton ? (
                <button
                  type="button"
                  className="amw-btn amw-btn-primary ead-extract-btn"
                  disabled={extractionBusy || saving || confirming}
                  aria-busy={extractionBusy}
                  onClick={() => {
                    if (awaitingRosterForSelected) {
                      setRosterDialogOpen(true);
                      return;
                    }
                    void runExtract();
                  }}
                  data-testid="ead-extract-episode"
                >
                  {extractButtonLabel}
                </button>
              ) : null}
              <div className="ead-episode-select-wrap" data-testid="ead-episode-select">
                <GlassSelect
                  className="ead-episode-glass-select"
                  label="选择剧集"
                  hideLabel
                  value={selectedId}
                  disabled={
                    listLoading ||
                    episodes.length === 0 ||
                    extractionBusy ||
                    generatingAssetIds.size > 0
                  }
                  placeholder={episodeSelectPlaceholder}
                  groups={episodeSelectGroups}
                  menuPortal
                  menuSideOffset={6}
                  menuCollisionPadding={12}
                  onChange={(id) => setSelectedId(id || "")}
                />
              </div>
            </div>
          </div>
          {extractionBusy ? (
            <p
              className="ead-background-task-note"
              role="status"
              data-testid="ead-extract-background-note"
            >
              正在提取本集资产…
            </p>
          ) : null}
          {episodes.length === 0 && !listLoading ? (
            <p className="ead-error">暂无剧集，请先在剧本阶段完成分集。</p>
          ) : null}
        </section>

        <section className={`ead-detail amw-panel${isAwaitingEpisodeExtraction ? " ead-detail--pending" : ""}`}>
          {!selectedId ? (
            <div className="amw-empty">请选择剧集后提取本集资产。</div>
          ) : detailLoading || !detail ? (
            <div className="amw-empty">加载资产设计…</div>
          ) : isAwaitingEpisodeExtraction ? (
            <div className="ead-pending-assets" data-testid="ead-pending-assets">
              <h2>尚未提取资产</h2>
              {extractionError ? (
                <div
                  className="ead-pending-assets__error"
                  role="alert"
                  data-testid="ead-extraction-error"
                >
                  <p className="ead-pending-assets__error-title">资产提取失败</p>
                  <p>{extractionError.message}</p>
                  {extractDiagnostics && extractDiagnostics.rejectedItems.length > 0 ? (
                    <ul data-testid="ead-rejected-items">
                      {extractDiagnostics.rejectedItems.slice(0, 12).map((item) => (
                        <li key={`${item.index}-${item.name ?? ""}`}>
                          #{item.index}
                          {item.name ? ` ${item.name}` : ""}：{item.reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {extractedEpisodes.length > 0 ? (
                <div className="ead-pending-assets__recover">
                  <p>
                    当前已有 {extractedEpisodes.length}{" "}
                    集完成按集提取（合计{" "}
                    {extractedEpisodes.reduce(
                      (sum, episode) => sum + episode.itemCount,
                      0,
                    )}{" "}
                    项），可从上方剧集选择器打开查看。
                  </p>
                  <button
                    type="button"
                    className="amw-btn amw-btn-primary"
                    data-testid="ead-open-extracted-episode"
                    onClick={() => {
                      const first = extractedEpisodes[0];
                      if (first) setSelectedId(first.episodeId);
                    }}
                  >
                    查看第{extractedEpisodes[0]?.episodeNumber}集提取结果
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="ead-detail__inner amw-detail">
              <div className="ead-detail__head">
                <div className="ead-detail__titles">
                  <div className="ead-detail__title-row">
                    <h2>本集资产设计</h2>
                    <span className={statusBadgeClass(designStatus)}>
                      {EPISODE_ASSET_DESIGN_STATUS_LABELS[designStatus]}
                    </span>
                  </div>
                  <p className="ead-detail__subtitle">
                    {`第${detail.episode.episodeNumber}集${
                          selectedEpisodeTitle ? ` · ${selectedEpisodeTitle}` : ""
                        }`}
                  </p>
                  <p className="ead-muted ead-detail__meta-line">
                    正文 {contentLength ?? "—"} 字
                    {updatedAtLabel ? ` · 上次保存 ${updatedAtLabel}` : ""}
                    {confirmedAtLabel ? ` · 上次确认 ${confirmedAtLabel}` : ""}
                  </p>
                  {staleWarning ? (
                    <p className="ead-warn">
                      本集剧本已发生变化，请重新提取或重新核对资产设计。
                    </p>
                  ) : null}
                </div>
                <div className="ead-detail__head-actions">
                  <button
                    type="button"
                    className="amw-btn ead-script-btn"
                    disabled={!selectedId || !detail}
                    onClick={() => setScriptViewerOpen(true)}
                    data-testid="ead-view-script"
                  >
                    查看本集剧本
                  </button>
                </div>
              </div>

              <div className="ead-actions amw-actions">
                {visiblePromptBatchProgress ? (
                  <span
                    className={`ead-prompt-progress${visiblePromptBatchProgress.active ? " is-active" : " is-complete"}`}
                    role="status"
                    aria-live="polite"
                    data-testid="ead-prompt-progress"
                  >
                    总进度 {promptProgressPercent}% · 共{" "}
                    {visiblePromptBatchProgress.assetTotal} 个资产
                  </span>
                ) : null}
                <button
                    type="button"
                    className="amw-btn"
                    disabled={
                      !selectedId ||
                      extractionBusy ||
                      saving ||
                      confirming
                    }
                    onClick={() => void saveItems(items)}
                    data-testid="ead-save"
                  >
                    {saving ? "保存中…" : "保存本集资产"}
                  </button>
                {showApprovalUi && surface === "workspace" ? (
                  <button
                    type="button"
                    className={`amw-btn${canSubmitApproval ? " amw-btn-primary" : ""}`}
                    disabled={!canSubmitApproval}
                    onClick={() => setSubmitApprovalOpen(true)}
                    data-testid="ead-submit-approval"
                  >
                    提交审批素材
                  </button>
                ) : null}
              </div>

              {pageNote ? <p className="amw-note">{pageNote}</p> : null}
              {confirmSummary ? (
                <div className="ead-confirm-note" data-testid="ead-confirm-summary">
                  <p>{confirmSummary}</p>
                </div>
              ) : null}

              <div
                className="amw-tabs asset-type-tabs"
                role="tablist"
                aria-label="资产分类"
              >
                {GROUPS.map((group) => (
                  <button
                    key={group.type}
                    type="button"
                    role="tab"
                    aria-selected={activeGroup === group.type}
                    className={`amw-tab asset-type-tab${
                      activeGroup === group.type ? " is-active" : ""
                    }`}
                    onClick={() => setActiveGroup(group.type)}
                  >
                    {group.label}
                  </button>
                ))}
              </div>

              {GROUPS.filter((group) => group.type === activeGroup).map(
                (group) => {
                  const groupItems = items.filter(
                    (item) => item.assetType === group.type,
                  );
                  return (
                    <section key={group.type} className="ead-group amw-section">
                      <div className="ead-group__head">
                        <h3>{group.label}</h3>
                        <button
                          type="button"
                          className="amw-btn"
                          disabled={confirming || extractionBusy}
                          onClick={() => openCreateDialog(group.type)}
                        >
                          手动添加
                        </button>
                      </div>
                      {groupItems.length === 0 ? (
                        <div className="amw-empty ead-empty-compact">
                          {items.length === 0
                            ? "本集无新增资产。可直接确认，或手动添加资产项。"
                            : `暂无${group.label}项`}
                        </div>
                      ) : (
                        <div className="ead-cards">
                          {groupItems.map((item) => (
                            <DesignItemCard
                              key={item.id}
                              item={item}
                              projectId={projectId}
                              projectVoices={projectVoices}
                              audios={bundle.audios}
                              libraryAssets={bundle}
                              generationProgress={
                                assetGenerationProgress[item.id]
                              }
                              disabled={
                                confirming ||
                                extractionBusy ||
                                savingVoiceItemIds.has(item.id)
                              }
                              designDisabled={!canDesign}
                               deleteLocked={
                                 showApprovalUi &&
                                 surface === "workspace" &&
                                 isApprovedEpisodeDesignItem(item)
                               }
                               approvalUi={
                                 !showApprovalUi || isPersonalSpace
                                   ? "none"
                                   : designCardApprovalUi(
                                      item,
                                      pendingApprovalMediaIds,
                                      approvedApprovalMediaIds,
                                    )
                              }
                               showPersonalConfirm={
                                 showApprovalUi &&
                                 isPersonalSpace &&
                                 surface === "project_management"
                               }
                              confirming={confirmingItemId === item.id}
                              onConfirm={() => void handleConfirmItem(item.id)}
                              onChange={(patch) => updateItem(item.id, patch)}
                              onBindVoice={(binding) => {
                                void (async () => {
                                  const ok = await bindMediaVoice({
                                    itemId: item.id,
                                    mediaId: binding.mediaId,
                                    voiceId: binding.voiceId,
                                    voiceName: binding.voiceName,
                                  });
                                  if (ok) {
                                    setPageNote(
                                      `已为「${item.name}」当前图绑定音色${
                                        binding.voiceName
                                          ? `：${binding.voiceName}`
                                          : ""
                                      }`,
                                    );
                                  }
                                })();
                              }}
                              onPersistNote={(note) => {
                                if (savingVoiceItemIds.has(item.id)) return;
                                const latest = itemsRef.current;
                                const next = latest.map((row) =>
                                  row.id === item.id
                                    ? ({ ...row, note } as EpisodeAssetDesignItem)
                                    : row,
                                );
                                itemsRef.current = next;
                                setItems(next);
                                void saveItems(next, { silent: true });
                              }}
                              onDelete={() => deleteItem(item.id)}
                              onDesign={() => setDesignModalItem(item)}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  );
                },
              )}
            </div>
          )}
        </section>
      </div>

        {assetPageLocked ? (
          <div
            className="ead-page-lock"
            role="region"
            aria-label={assetLockTitle}
            data-testid="ead-page-lock"
          >
            <div className="ead-page-lock__panel">
              <strong>{assetLockTitle}</strong>
              {workflowProgressPercent != null ? (
                <div
                  className="ead-page-lock__progress"
                  role="progressbar"
                  aria-label="资产生成总进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={workflowProgressPercent}
                >
                  <span
                    className="ead-page-lock__percentage"
                    data-testid="ead-workflow-progress-percent"
                  >
                    {workflowProgressPercent}%
                  </span>
                  <span className="ead-page-lock__track" aria-hidden>
                    <span style={{ width: `${workflowProgressPercent}%` }} />
                  </span>
                  <span className="ead-page-lock__progress-label">
                    {workflowProgressLabel}
                  </span>
                </div>
              ) : (
                <span role="status" aria-live="polite">
                  资产图片正在生成，任务会在后台继续。
                </span>
              )}
              <div className="ead-page-lock__actions">
                {!extractionBusy ? (
                <Link
                  href={storyboardHref}
                  target="_blank"
                  rel="noreferrer"
                  className="amw-btn amw-btn-primary ead-storyboard-link"
                  data-testid="ead-open-storyboard-while-generating"
                >
                  <Clapperboard size={16} aria-hidden />
                  进入分镜创作
                </Link>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {scriptViewerOpen && detail ? (
        <div
          className="amw-overlay"
          role="presentation"
          onClick={() => setScriptViewerOpen(false)}
        >
          <div
            className="amw-dialog ead-script-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ead-script-dialog-title"
            data-testid="ead-script-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="ead-script-dialog__head">
              <div className="ead-script-dialog__titles">
                <h3 id="ead-script-dialog-title">
                  {`第${detail.episode.episodeNumber}集剧本`}
                </h3>
                <p className="ead-muted ead-script-dialog__meta">
                  {selectedEpisodeTitle ?? "只读预览"}
                  {" · "}
                  正文 {contentLength ?? 0} 字
                </p>
              </div>
              <button
                type="button"
                className="ead-script-dialog__close"
                aria-label="关闭"
                title="关闭"
                onClick={() => setScriptViewerOpen(false)}
              >
                <X size={16} strokeWidth={2.25} aria-hidden />
              </button>
            </div>
            <pre
              className={`ead-script-body${episodeContent.trim() ? "" : " is-empty"}`}
              data-testid="ead-script-body"
            >
              {episodeContent.trim()
                ? episodeContent
                : "本集暂无正文"}
            </pre>
          </div>
        </div>
      ) : null}

      {pendingUncheckedVideoRefItem ? (
        <div
          className="amw-overlay amw-overlay--stacked"
          role="presentation"
          data-testid="ead-unchecked-video-ref-block-backdrop"
          onClick={dismissUncheckedVideoRefBlock}
        >
          <div
            className="amw-dialog ead-unchecked-video-ref-block-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ead-unchecked-video-ref-block-title"
            data-testid="ead-unchecked-video-ref-block"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="ead-unchecked-video-ref-block-title">人物未进行校验</h3>
            <p className="amw-dialog-desc">人物未进行校验无法入库</p>
            <div className="amw-dialog-actions ead-unchecked-video-ref-block-actions">
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                data-testid="ead-unchecked-video-ref-block-dismiss"
                onClick={dismissUncheckedVideoRefBlock}
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingUnboundVoiceConfirmItem ? (
        <div
          className="amw-overlay amw-overlay--stacked"
          role="presentation"
          data-testid="ead-unbound-voice-confirm-backdrop"
          onClick={dismissUnboundVoiceConfirm}
        >
          <div
            className="amw-dialog ead-unbound-voice-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ead-unbound-voice-confirm-title"
            data-testid="ead-unbound-voice-confirm"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="ead-unbound-voice-confirm-title">角色未绑定音色</h3>
            <p className="amw-dialog-desc">
              此角色未进行音色绑定，是否继续入库？
            </p>
            <div className="amw-dialog-actions ead-unbound-voice-confirm-actions">
              <button
                type="button"
                className="amw-btn"
                data-testid="ead-unbound-voice-confirm-cancel"
                disabled={Boolean(confirming || confirmingItemId)}
                onClick={dismissUnboundVoiceConfirm}
              >
                否，取消
              </button>
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                data-testid="ead-unbound-voice-confirm-continue"
                disabled={Boolean(confirming || confirmingItemId)}
                onClick={() => {
                  const itemId = pendingUnboundVoiceConfirmItem.id;
                  void confirmItemToLibrary(itemId);
                }}
              >
                {confirming &&
                confirmingItemId === pendingUnboundVoiceConfirmItem.id
                  ? "入库中…"
                  : "是，继续入库"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <CharacterCreateDialog
        key={`character-${createDialogType}-${editingItemId ?? "new"}`}
        open={createDialogType === "character"}
        onClose={closeCreateDialog}
        onSubmit={handleCharacterDialogSubmit}
        projectVoices={projectVoices}
        initialDraft={characterInitialDraft}
        submitLabel={editingItemId ? "保存角色" : "添加角色"}
      />
      <SceneCreateDialog
        key={`scene-${createDialogType}-${editingItemId ?? "new"}`}
        open={createDialogType === "scene"}
        onClose={closeCreateDialog}
        onSubmit={handleSceneDialogSubmit}
        initialDraft={sceneInitialDraft}
        submitLabel={editingItemId ? "保存场景" : "添加场景"}
      />
      <PropCreateDialog
        key={`prop-${createDialogType}-${editingItemId ?? "new"}`}
        open={createDialogType === "prop"}
        onClose={closeCreateDialog}
        onSubmit={handlePropDialogSubmit}
        initialDraft={propInitialDraft}
        submitLabel={editingItemId ? "保存道具" : "添加道具"}
      />

      <DesignAssetModal
        open={
          designModalItem != null &&
          (canDesign || generatingAssetIds.has(designModalItem.id))
        }
        item={designModalItem}
        projectId={projectId}
        episodeId={selectedId ?? ""}
        surface={surface}
        isGeneratingAsset={
          designModalItem
            ? generatingAssetIds.has(designModalItem.id)
            : false
        }
        onGeneratingAssetChange={(itemId, generating) => {
          setGeneratingAssetIds((prev) => {
            const next = new Set(prev);
            if (generating) next.add(itemId);
            else next.delete(itemId);
            return next;
          });
        }}
        onGenerationProgress={(itemId, progress) => {
          setAssetGenerationProgress((prev) => {
            if (!progress || progress.stage === "failed") {
              const next = { ...prev };
              delete next[itemId];
              return next;
            }
            return { ...prev, [itemId]: progress };
          });
        }}
        onClose={() => setDesignModalItem(null)}
        onItemPatched={(itemId, incomingItem) => {
          setItems((prev) => {
            const next = prev.map((row) =>
              row.id === itemId
                ? mergePatchedDesignItem(row, incomingItem)
                : row,
            );
            itemsRef.current = next;
            void saveItems(next, { silent: true });
            return next;
          });

          setDesignModalItem((prev) =>
            prev && prev.id === itemId
              ? mergePatchedDesignItem(prev, incomingItem)
              : prev,
          );
        }}
        onPromptUpdated={(itemId, promptText, meta) => {
          setItems((prev) =>
            prev.map((row) =>
              row.id === itemId
                ? {
                    ...row,
                    designPrompt: {
                      status: "ready" as const,
                      text: promptText,
                      generationId:
                        meta?.generationId ??
                        row.designPrompt?.generationId ??
                        null,
                      sourceFingerprint:
                        row.designPrompt?.sourceFingerprint ?? null,
                      generatedAt:
                        row.designPrompt?.generatedAt ??
                        new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                      errorMessage: null,
                      history:
                        meta?.history ?? row.designPrompt?.history ?? [],
                    },
                  }
                : row,
            ),
          );
          setDesignModalItem((prev) =>
            prev && prev.id === itemId
              ? {
                  ...prev,
                  designPrompt: {
                    status: "ready" as const,
                    text: promptText,
                    generationId:
                      meta?.generationId ??
                      prev.designPrompt?.generationId ??
                      null,
                    sourceFingerprint:
                      prev.designPrompt?.sourceFingerprint ?? null,
                    generatedAt:
                      prev.designPrompt?.generatedAt ??
                      new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    errorMessage: null,
                    history: meta?.history ?? prev.designPrompt?.history ?? [],
                  },
                }
              : prev,
          );
        }}
        onAssetGenerated={(itemId, media) => {
          if (media) {
            setItems((prev) =>
              prev.map((row) => {
                if (row.id !== itemId) return row;
                const merged = mergeGeneratedMediaState(
                  row.generatedMedia,
                  media,
                );
                return merged ? { ...row, generatedMedia: merged } : row;
              }),
            );
            setDesignModalItem((prev) => {
              if (!prev || prev.id !== itemId) return prev;
              const merged = mergeGeneratedMediaState(
                prev.generatedMedia,
                media,
              );
              return merged ? { ...prev, generatedMedia: merged } : prev;
            });
          }
          // Avoid full loadDetail refresh here — it caused UI stutter and could
          // thrash the open modal while generation progress is still visible.
        }}
      />

      {approvalModals}
    </div>
  );
}

function DesignItemCard({
  item,
  projectId,
  projectVoices,
  audios,
  libraryAssets,
  generationProgress,
  disabled,
  designDisabled,
  deleteLocked,
  approvalUi,
  showPersonalConfirm,
  confirming,
  onConfirm,
  onChange,
  onBindVoice,
  onPersistNote,
  onDelete,
  onDesign,
}: {
  item: EpisodeAssetDesignItem;
  projectId: string;
  projectVoices: VoiceOption[];
  audios: AudioAsset[];
  libraryAssets: Pick<
    ProjectAssetBundle,
    "characters" | "scenes" | "props"
  >;
  generationProgress?: AssetGenerationProgress;
  disabled: boolean;
  designDisabled: boolean;
  deleteLocked: boolean;
  approvalUi: "none" | "pending" | "approved";
  showPersonalConfirm: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onChange: (patch: Partial<EpisodeAssetDesignItem>) => void;
  onBindVoice: (binding: {
    mediaId: string;
    voiceId: string;
    voiceName: string | null;
  }) => void;
  onPersistNote: (note: string) => void;
  onDelete: () => void;
  onDesign: () => void;
}) {
  const [cardLightbox, setCardLightbox] = useState(false);
  const [voiceNote, setVoiceNote] = useState("");
  const [voiceDraft, setVoiceDraft] = useState<{
    mediaId: string;
    voiceId: string | null;
    voiceName: string | null;
  } | null>(null);

  if (item.assetType === "audio") {
    return null;
  }

  const isVisualAsset =
    item.assetType === "scene" || item.assetType === "prop";
  const previewUrl = resolveDesignItemPreviewUrl(
    projectId,
    item,
    libraryAssets,
  );
  const currentMediaId = item.generatedMedia?.currentId?.trim() ?? "";
  const persistedVoice =
    item.assetType === "character"
      ? getDesignMediaVoiceBinding(item, currentMediaId)
      : null;

  const pendingVoiceDraft =
    voiceDraft?.mediaId === currentMediaId &&
    !(
      persistedVoice &&
      isMediaVoiceBound(persistedVoice) &&
      persistedVoice.voiceId === voiceDraft.voiceId
    )
      ? voiceDraft
      : null;

  const mediaVoice =
    item.assetType === "character"
      ? pendingVoiceDraft
        ? {
            voiceId: pendingVoiceDraft.voiceId,
            voiceName: pendingVoiceDraft.voiceName,
            voiceBound: false,
          }
        : persistedVoice
      : null;
  const libraryCharacter =
    item.assetType === "character" && item.libraryAssetId
      ? libraryAssets.characters.find((c) => c.id === item.libraryAssetId) ??
        null
      : null;
  const libraryMediaVoice =
    currentMediaId && libraryCharacter?.mediaVoices?.[currentMediaId]
      ? libraryCharacter.mediaVoices[currentMediaId]
      : null;
  const voiceLocked = approvalUi === "approved";
  /** Prefer per-media design binding; library fallback only when voice is locked (approved). */
  const characterVoiceId =
    item.assetType === "character"
      ? mediaVoice?.voiceId ||
        (voiceLocked
          ? libraryMediaVoice?.voiceId ||
            libraryCharacter?.voiceId ||
            null
          : null)
      : null;
  const characterVoiceLabel =
    item.assetType === "character"
      ? mediaVoice?.voiceName ||
        (voiceLocked
          ? libraryMediaVoice?.voiceName ||
            libraryCharacter?.voiceName ||
            null
          : null) ||
        (characterVoiceId ? "已绑定音色" : "未绑定音色")
      : "";
  const hasBoundVoice =
    (mediaVoice != null && isMediaVoiceBound(mediaVoice)) ||
    (voiceLocked && Boolean(characterVoiceId));
  const voiceBoundLabel = hasBoundVoice;
  const isInLibrary = Boolean(item.libraryAssetId?.trim());
  const isImageMissing =
    (item.resolution === "create_new" || item.resolution === "pending") &&
    !currentMediaId;
  const confirmDisabledReason = isInLibrary
    ? "该资产已入库"
    : isImageMissing
      ? "请先生成图片"
      : item.resolution === "ignore"
        ? "已设为本集忽略，无需入库"
        : undefined;

  const statusLabel = isInLibrary
    ? "已入库"
    : approvalUi === "approved"
      ? "已入库"
      : approvalUi === "pending"
        ? "审批中"
        : "设计中";
  const statusClass =
    statusLabel === "已入库"
      ? " is-ok"
      : statusLabel === "审批中"
        ? " is-pending"
        : " is-draft";

  const mediaBlock = previewUrl ? (
    <button
      type="button"
      className={
        [
          approvalUi === "pending"
            ? "ead-card__preview-btn ead-card__preview-btn--pending"
            : "ead-card__preview-btn",
          generationProgress ? "is-generating" : "",
        ]
          .filter(Boolean)
          .join(" ")
      }
      title={approvalUi === "pending" ? "审批中" : "点击放大预览"}
      onClick={() => setCardLightbox(true)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- project binary preview URL */}
      <img
        className={
          approvalUi === "pending"
            ? "ead-card__preview ead-card__preview--blur"
            : "ead-card__preview"
        }
        src={previewUrl}
        alt={item.name ? `${item.name} preview` : "asset preview"}
      />
      {approvalUi === "pending" ? (
        <span
          className="ead-card__approval-overlay"
          data-testid={`ead-pending-${item.id}`}
        >
          审批中
        </span>
      ) : null}
    </button>
  ) : (
    <div
      className={
        generationProgress
          ? "ead-card__icon-wrap asset-card__empty is-generating"
          : "ead-card__icon-wrap asset-card__empty"
      }
      aria-hidden
    >
      {item.assetType === "character" ? (
        <UserRound className="ead-card__icon" size={28} strokeWidth={1.5} />
      ) : item.assetType === "scene" ? (
        <MapPinned className="ead-card__icon" size={28} strokeWidth={1.5} />
      ) : (
        <Package className="ead-card__icon" size={28} strokeWidth={1.5} />
      )}
      <span className="asset-card__empty-label">暂无图片</span>
    </div>
  );

  const editButton = (
    <button
      type="button"
      className="amw-btn amw-btn-primary ead-card__design-btn"
      data-testid={`ead-design-${item.id}`}
      disabled={disabled || designDisabled}
      title={designDisabled ? "请先提取本集资产后再进行设计" : undefined}
      onClick={onDesign}
    >
      编辑
    </button>
  );

  const deleteButton = (
    <button
      type="button"
      className="amw-btn ead-card__delete-btn"
      data-testid={`ead-delete-${item.id}`}
      disabled={disabled || deleteLocked}
      title={
        deleteLocked
          ? "已审批入库的资产仅主理人可在项目管理中删除"
          : undefined
      }
      onClick={onDelete}
    >
      删除
    </button>
  );

  const actionsBlock = (
    <div className="asset-card__actions ead-card__actions">
      {showPersonalConfirm ? (
        <button
          type="button"
          className="amw-btn amw-btn-primary ead-card__confirm-btn"
          data-testid={`ead-confirm-item-${item.id}`}
          disabled={
            disabled ||
            isInLibrary ||
            isImageMissing ||
            item.resolution === "ignore"
          }
          title={confirmDisabledReason}
          onClick={onConfirm}
        >
          {confirming ? "入库中…" : isInLibrary ? "已入库" : "确认入库"}
        </button>
      ) : null}
    </div>
  );

  const characterVoiceBlock =
    item.assetType === "character" ? (
      <div className="ead-card__voice-panel">
        <div className="ead-card__voice-row">
          <div className="ead-card__voice-select">
            {voiceLocked ? (
              <div className="ead-card__voice-readonly">
                <span className="ead-card__voice-readonly-label">音色</span>
                <span
                  className="ead-card__voice-readonly-value"
                  data-testid={`ead-voice-readonly-${item.id}`}
                >
                  {characterVoiceLabel}
                </span>
              </div>
            ) : (
              <VoiceSelector
                label="当前图音色"
                value={characterVoiceId}
                disabled={disabled || !currentMediaId}
                projectVoices={projectVoices}
                onChange={(voice) => {
                  if (!currentMediaId) {
                    setVoiceNote("请先生成图片，再为当前历史图选择音色");
                    return;
                  }
                  setVoiceDraft({
                    mediaId: currentMediaId,
                    voiceId: voice?.id ?? null,
                    voiceName: voice?.name ?? null,
                  });
                }}
              />
            )}
          </div>
          <div className="ead-card__voice-actions">
            <VoicePreviewButton
              projectId={projectId}
              voiceId={characterVoiceId}
              audios={audios}
              className="amw-btn ead-card__voice-preview"
              testId={`ead-voice-preview-${item.id}`}
              onStatus={setVoiceNote}
            />
          </div>
        </div>
        <div className="ead-card__voice-bind-row">
          <button
            type="button"
            className={`amw-btn ead-card__voice-bind${
              voiceBoundLabel ? " is-bound" : ""
            }${voiceLocked && !hasBoundVoice ? " is-missing" : ""}`}
            data-testid={`ead-voice-bind-${item.id}`}
            disabled={
              disabled ||
              voiceLocked ||
              !currentMediaId ||
              !characterVoiceId ||
              (mediaVoice != null && isMediaVoiceBound(mediaVoice))
            }
            title={
              !currentMediaId
                ? "请先生成图片，再为当前历史图绑定音色"
                : voiceLocked && !hasBoundVoice
                  ? "审批入库时未绑定音色；请主理人在项目管理中为该角色补绑"
                  : voiceLocked
                    ? "已审批入库，音色仅主理人可在项目管理中更改"
                    : mediaVoice != null && isMediaVoiceBound(mediaVoice)
                      ? "当前历史图音色已绑定"
                      : "将当前选择的音色绑定到当前历史图"
            }
            onClick={() => {
              if (!currentMediaId || !characterVoiceId) {
                setVoiceNote("请先选择音色再绑定");
                return;
              }
              onBindVoice({
                mediaId: currentMediaId,
                voiceId: characterVoiceId,
                voiceName: mediaVoice?.voiceName ?? null,
              });
            }}
          >
            {voiceLocked && !hasBoundVoice
              ? "未绑定"
              : voiceBoundLabel
                ? "已绑定"
                : "绑定音色"}
          </button>
        </div>
        {voiceNote ? (
          <p className="ead-muted ead-card__voice-note">{voiceNote}</p>
        ) : null}
      </div>
    ) : null;

  const noteBlock = (
    <div className="amw-field ead-card__note">
      <label>备注</label>
      <textarea
        className="amw-textarea asset-card__note"
        value={item.note ?? ""}
        disabled={disabled}
        placeholder="项目内成员均可编辑，失焦后自动同步"
        data-testid={`ead-note-${item.id}`}
        onChange={(e) => onChange({ note: e.target.value })}
        onBlur={(e) => onPersistNote(e.target.value)}
      />
    </div>
  );

  const lightbox = (
    <DesignImageLightbox
      src={cardLightbox ? previewUrl : null}
      alt={`${item.name || "资产"} 放大预览`}
      onClose={() => setCardLightbox(false)}
    />
  );

  const nameTitle = item.name || "未命名资产";
  const characterSummary =
    item.assetType === "character"
      ? [item.draft.role, item.draft.age]
          .filter((part) => part.trim())
          .join(" · ")
      : "";
  const characterDescription =
    item.assetType === "character" ? item.draft.description : "";

  if (isVisualAsset) {
    return (
      <article className="ead-card ead-card--visual-asset">
        <div className="ead-card__media">
          {mediaBlock}
          {generationProgress ? (
            <DesignGenerationOverlay progress={generationProgress} />
          ) : null}
          {!generationProgress ? editButton : null}
          <div className="ead-card__media-delete">{deleteButton}</div>
        </div>
        <div className="ead-card__content">
          <div className="ead-card__header">
            <h3 className="ead-card__name" title={nameTitle}>
              {nameTitle}
            </h3>
            <span className={`ead-card__status asset-card__status${statusClass}`}>
              {statusLabel}
            </span>
          </div>
          {approvalUi === "approved" ? (
            <span
              className="ead-card__approval-badge is-approved"
              data-testid={`ead-approved-${item.id}`}
            >
              已审批
            </span>
          ) : null}
          {actionsBlock}
          {noteBlock}
        </div>
        {lightbox}
      </article>
    );
  }

  // Character: previous side-by-side layout (do not share visual-asset styles)
  return (
    <article
      className="ead-card ead-card--character"
      data-testid={`ead-character-card-${item.id}`}
    >
      <div className="ead-card__corner">
        {approvalUi === "approved" ? (
          <span
            className="ead-card__approval-badge is-approved"
            data-testid={`ead-approved-${item.id}`}
          >
            已审批
          </span>
        ) : null}
        {showPersonalConfirm ? (
          <button
            type="button"
            className="amw-btn amw-btn-primary ead-card__confirm-btn"
            data-testid={`ead-confirm-item-${item.id}`}
            disabled={
              disabled ||
              isInLibrary ||
              isImageMissing ||
              item.resolution === "ignore"
            }
            title={confirmDisabledReason}
            onClick={onConfirm}
          >
            {confirming ? "入库中…" : isInLibrary ? "已入库" : "确认入库"}
          </button>
        ) : null}
        {deleteButton}
      </div>
      <div className="ead-card__layout">
        <div className="ead-card__visual">
          <div className="ead-card__media-wrap">
            {mediaBlock}
            {generationProgress ? (
              <DesignGenerationOverlay progress={generationProgress} />
            ) : null}
            {!generationProgress ? editButton : null}
          </div>
          <p className="ead-card__name" title={nameTitle}>
            {nameTitle}
          </p>
          {characterVoiceBlock}
        </div>
        <div className="ead-card__body">
          {characterSummary ? (
            <p className="ead-muted ead-card__summary">{characterSummary}</p>
          ) : null}
          <div className="amw-field">
            <label>描述</label>
            <textarea
              className="amw-textarea"
              value={characterDescription}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  draft: { ...item.draft, description: e.target.value },
                } as Partial<EpisodeAssetDesignItem>)
              }
            />
          </div>
          {noteBlock}
        </div>
      </div>
      {lightbox}
    </article>
  );
}
