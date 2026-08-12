"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
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
  cancelStoryGeneration,
  notifyCreditsRefresh,
  streamStoryGeneration,
  StoryGenerationClientError,
} from "@/projects/story/story-generation-client";
import { STORY_TEXT_MODELS } from "@/projects/story/constants";
import {
  designCardApprovalUi,
  isApprovedEpisodeDesignItem,
  resolveDesignItemPreviewUrl,
} from "@/projects/assets/episode-design/approved-item";
import { createEpisodeAssetDesignIdempotencyKey } from "@/projects/assets/episode-design/prompts";
import { mergeGeneratedMediaState } from "@/projects/assets/episode-design/generated-media-history";
import {
  getDesignMediaVoiceBinding,
  isMediaVoiceBound,
} from "@/projects/assets/episode-design/design-media-voice";
import {
  itemFromCharacterDraft,
  mergePatchedDesignItem,
} from "@/projects/assets/episode-design/character-design-item";
import { shouldApplySavedDesignRecord } from "@/projects/assets/episode-design/update-media-voice";
import {
  EPISODE_ASSET_DESIGN_STATUS_LABELS,
  type CharacterDesignItem,
  type EpisodeAssetDesignAssetType,
  type EpisodeAssetDesignItem,
  type EpisodeAssetDesignRecord,
  type EpisodeAssetDesignStatus,
  type PropDesignItem,
  type SceneDesignItem,
  SCRIPT_ASSET_DESIGN_ID,
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

type EpisodeListItem = {
  episodeId: string;
  episodeNumber: number;
  title: string;
  designStatus: EpisodeAssetDesignStatus;
  itemCount: number;
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

export function EpisodeAssetDesignWorkspace({ projectId }: Props) {
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
    () => queryEpisodeId || SCRIPT_ASSET_DESIGN_ID,
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
  const [fullScriptPending, setFullScriptPending] = useState(false);
  const [fullScriptAssetCount, setFullScriptAssetCount] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [batchExtracting, setBatchExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmingItemId, setConfirmingItemId] = useState<string | null>(null);
  const [savingVoiceItemIds, setSavingVoiceItemIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [pageNote, setPageNote] = useState("");
  const [confirmSummary, setConfirmSummary] = useState<string | null>(null);
  const [reextractOpen, setReextractOpen] = useState(false);
  const [modelKey, setModelKey] = useState(
    STORY_TEXT_MODELS[0]?.id ?? "balanced-default",
  );
  const [assetExtractionModel, setAssetExtractionModel] = useState(
    "deepseek-v4-pro",
  );
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
  const abortRef = useRef<AbortController | null>(null);
  const generationIdRef = useRef<string | null>(null);
  const generatingRef = useRef(false);
  const isPersonalSpace = activeSpace.kind === "personal";

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
  useEffect(() => {
    generatingRef.current = generating;
  }, [generating]);

  useGenerationBusy(
    generating || batchExtracting || generatingAssetIds.size > 0,
    `asset-design-${projectId}`,
    generatingAssetIds.size > 0
      ? "资产图生成"
      : batchExtracting
        ? "全剧本资产提取"
        : "资产提取",
  );

  useEffect(() => {
    if (!ownerApprovalSubmissionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
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

  /** Keep the overview counter accurate even when viewing a single episode. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${apiRoot}/asset-designs/episodes/${encodeURIComponent(SCRIPT_ASSET_DESIGN_ID)}`,
        );
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as EpisodeDetailPayload;
        if (cancelled) return;
        setFullScriptAssetCount(payload.record.items.length);
        setFullScriptPending(
          payload.designStatus === "not_started" &&
            payload.record.items.length === 0,
        );
      } catch {
        /* ignore — detail load will refresh when opening full script */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiRoot]);

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
  const isFullScriptDesign = selectedId === SCRIPT_ASSET_DESIGN_ID;

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
      const res = await fetch(
        `${apiRoot}/asset-designs`,
      );
      if (!res.ok) throw new Error("无法加载剧集列表");
      const data = (await res.json()) as { items: EpisodeListItem[] };
      setEpisodes(data.items ?? []);
      setSelectedId((prev) => {
        if (prev === SCRIPT_ASSET_DESIGN_ID) return prev;
        if (prev && data.items.some((ep) => ep.episodeId === prev)) return prev;
        return SCRIPT_ASSET_DESIGN_ID;
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
      const res = await fetch(
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
        const res = await fetch(url);
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
      setDetailLoading(true);
      setConfirmSummary(null);
      try {
        const detailRes = await fetch(
          `${apiRoot}/asset-designs/episodes/${encodeURIComponent(episodeId)}`,
        );
        if (!detailRes.ok) throw new Error("无法加载剧集资产设计");
        const payload = (await detailRes.json()) as EpisodeDetailPayload;
        if (episodeId === SCRIPT_ASSET_DESIGN_ID) {
          setFullScriptAssetCount(payload.record.items.length);
          setFullScriptPending(
            payload.designStatus === "not_started" &&
              payload.record.items.length === 0,
          );
        }
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
        // Orphaned “提取中” after refresh / crashed stream — unlock the UI.
        if (payload.designStatus === "generating" && !generatingRef.current) {
          setDesignStatus("failed");
          try {
            const res = await fetch(
              `${apiRoot}/asset-designs/episodes/${encodeURIComponent(episodeId)}`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  expectedRevision: payload.record.revision,
                  fingerprint: payload.currentFingerprint,
                  items: payload.record.items,
                  status: "failed",
                }),
              },
            );
            if (res.ok) {
              const fixed = (await res.json()) as {
                record?: EpisodeAssetDesignRecord;
              };
              if (
                fixed.record &&
                fixed.record.revision >= revisionRef.current
              ) {
                setItems(fixed.record.items);
                itemsRef.current = fixed.record.items;
                setRevision(fixed.record.revision);
                revisionRef.current = fixed.record.revision;
                setDesignStatus(fixed.record.status);
              }
            }
          } catch {
            /* keep local failed unlock even if persist fails */
          }
        } else {
          setDesignStatus(payload.designStatus);
        }

        let content = payload.episode.content?.replace(/\r\n/g, "\n") ?? "";
        if (!content) {
          const scriptUrl =
            surface === "workspace"
              ? `${apiRoot}/script-draft`
              : `/api/projects/${encodeURIComponent(projectId)}/script-draft`;
          const scriptRes = await fetch(scriptUrl);
          if (scriptRes.ok) {
            const script = (await scriptRes.json()) as {
              draft?: {
                sourceText?: string | null;
                episodes?: Array<{ id: string; content?: string }>;
              };
            };
            if (episodeId === SCRIPT_ASSET_DESIGN_ID) {
              content = script.draft?.sourceText?.replace(/\r\n/g, "\n") ?? "";
            } else {
              const ep = script.draft?.episodes?.find((e) => e.id === episodeId);
              content = ep?.content?.replace(/\r\n/g, "\n") ?? "";
            }
          }
        }
        setEpisodeContent(content);
        setContentLength(content.trim().length);
        void loadApprovalMediaFlags(episodeId);
      } catch (error) {
        setPageNote(
          error instanceof Error ? error.message : "无法加载剧集资产设计",
        );
      } finally {
        setDetailLoading(false);
      }
    },
    [apiRoot, loadApprovalMediaFlags, projectId, surface],
  );

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
            if (prev === SCRIPT_ASSET_DESIGN_ID) return prev;
            if (prev && listItems.some((ep) => ep.episodeId === prev)) return prev;
            return SCRIPT_ASSET_DESIGN_ID;
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
      const [bundleRes, modelsRes] = await Promise.all([
        fetch(`${apiRoot}/assets-draft`),
        fetch("/api/text-models"),
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
      if (modelsRes.ok) {
        const data = (await modelsRes.json()) as { recommendedKey?: string };
        if (!cancelled && data.recommendedKey) setModelKey(data.recommendedKey);
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
  }, []);

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
        const res = await fetch(
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
        const res = await fetch(
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

  const markExtractStatus = useCallback(
    async (
      status: "generating" | "failed",
      expectedRevision?: number,
    ) => {
      if (!selectedId || !fingerprint) return null;
      return saveItems(items, {
        status,
        expectedRevision,
        silent: true,
        skipReloadList: true,
      });
    },
    [fingerprint, items, saveItems, selectedId],
  );

  const runExtract = useCallback(async () => {
    if (!selectedId || generating || saving) return;
    setReextractOpen(false);
    setGenerating(true);
    setSaving(false);
    setPageNote("");
    setConfirmSummary(null);
    const controller = new AbortController();
    abortRef.current = controller;
    generationIdRef.current = null;
    let statusRevision = revision;
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, 180_000);

    try {
      const generatingRecord = await markExtractStatus(
        "generating",
        statusRevision,
      );
      if (!generatingRecord) {
        throw new Error("无法开始提取，请刷新后重试");
      }
      statusRevision = generatingRecord.revision;

      const result = await streamStoryGeneration({
        projectId,
        brief: "",
        modelKey,
        targetChars: 1000,
        idempotencyKey: createEpisodeAssetDesignIdempotencyKey(),
        outputKind: "episode_asset_design",
        episodeId: selectedId,
        signal: controller.signal,
        onMeta: (meta) => {
          generationIdRef.current = meta.generationId;
        },
      });

      const applyRes = await fetch(
        `${apiRoot}/asset-designs/episodes/${encodeURIComponent(selectedId)}/apply-generation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generationId: result.generationId,
            rawText: result.text,
            expectedRevision: statusRevision,
            fingerprint,
          }),
          signal: controller.signal,
        },
      );
      const applyPayload = (await applyRes.json()) as {
        record?: EpisodeAssetDesignRecord;
        error?: string;
      };
      if (!applyRes.ok) {
        throw new Error(applyPayload.error ?? "应用生成结果失败");
      }
      if (applyPayload.record) {
        applyRecord(applyPayload.record);
      }
      notifyCreditsRefresh();
      setPageNote("本集资产提取完成，请确认设计项。");
      await loadList();
      await loadDetail(selectedId);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setPageNote("已取消生成。");
      } else if (error instanceof StoryGenerationClientError) {
        setPageNote(error.message);
      } else {
        setPageNote(
          error instanceof Error ? error.message : "提取失败，请稍后重试",
        );
      }
      await markExtractStatus("failed", statusRevision);
      await loadList();
    } finally {
      window.clearTimeout(timeoutId);
      setGenerating(false);
      setSaving(false);
      abortRef.current = null;
    }
  }, [
    apiRoot,
    applyRecord,
    fingerprint,
    generating,
    loadDetail,
    loadList,
    markExtractStatus,
    modelKey,
    projectId,
    revision,
    saving,
    selectedId,
  ]);

  const handleExtract = useCallback(() => {
    if (!selectedId || generating || saving) return;
    const hasReviewItems =
      items.length > 0 &&
      (designStatus === "review" ||
        designStatus === "confirmed" ||
        designStatus === "stale");
    if (hasReviewItems) {
      setReextractOpen(true);
      return;
    }
    void runExtract();
  }, [designStatus, generating, items.length, runExtract, saving, selectedId]);

  const handleExtractAll = useCallback(async () => {
    if (generating || batchExtracting || saving || confirming) return;
    const controller = new AbortController();
    abortRef.current = controller;
    generationIdRef.current = null;
    setBatchExtracting(true);
    setGenerating(true);
    setPageNote("");
    setConfirmSummary(null);

    try {
      const detailRes = await fetch(
        `${apiRoot}/asset-designs/episodes/${encodeURIComponent(SCRIPT_ASSET_DESIGN_ID)}`,
        { signal: controller.signal },
      );
      if (!detailRes.ok) {
        const payload = (await detailRes.json()) as { error?: string };
        throw new Error(payload.error ?? "无法加载完整原始剧本");
      }
      const scriptDetail = (await detailRes.json()) as EpisodeDetailPayload;
      const result = await streamStoryGeneration({
        projectId,
        brief: "",
        modelKey: assetExtractionModel,
        targetChars: 20_000,
        idempotencyKey: createEpisodeAssetDesignIdempotencyKey(),
        outputKind: "script_asset_design",
        signal: controller.signal,
        onMeta: (meta) => {
          generationIdRef.current = meta.generationId;
        },
      });
      const applyRes = await fetch(
        `${apiRoot}/asset-designs/episodes/${encodeURIComponent(SCRIPT_ASSET_DESIGN_ID)}/apply-generation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generationId: result.generationId,
            rawText: result.text,
            expectedRevision: scriptDetail.record.revision,
            fingerprint: scriptDetail.currentFingerprint,
          }),
          signal: controller.signal,
        },
      );
      const applyPayload = (await applyRes.json()) as {
        record?: EpisodeAssetDesignRecord;
        error?: string;
      };
      if (!applyRes.ok || !applyPayload.record) {
        throw new Error(applyPayload.error ?? "应用全剧本资产结果失败");
      }

      setSelectedId(SCRIPT_ASSET_DESIGN_ID);
      setFullScriptAssetCount(applyPayload.record.items.length);
      setFullScriptPending(false);
      applyRecord(applyPayload.record);
      notifyCreditsRefresh();
      setPageNote("完整剧本资产已一次性提取完成，请在下方核对。");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setPageNote("已取消全剧本资产提取。");
      } else {
        setPageNote(error instanceof Error ? error.message : "全剧本提取失败");
      }
    } finally {
      setBatchExtracting(false);
      setGenerating(false);
      setSaving(false);
      abortRef.current = null;
      generationIdRef.current = null;
      await loadDetail(SCRIPT_ASSET_DESIGN_ID);
    }
  }, [
    apiRoot,
    applyRecord,
    assetExtractionModel,
    batchExtracting,
    confirming,
    generating,
    loadDetail,
    projectId,
    saving,
  ]);

  const handleCancelGenerate = useCallback(async () => {
    abortRef.current?.abort();
    const genId = generationIdRef.current;
    if (genId) {
      await cancelStoryGeneration(projectId, genId);
    }
    setGenerating(false);
    setSaving(false);
    setPageNote(batchExtracting ? "正在取消全剧本提取…" : "已取消生成。");
    if (!batchExtracting) await markExtractStatus("failed");
    await loadList();
  }, [batchExtracting, loadList, markExtractStatus, projectId]);

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

      const res = await fetch(
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
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error ?? "确认失败");
      if (payload.record) applyRecord(payload.record);
      const counts = payload.counts ?? { created: 0, linked: 0, ignored: 0 };
      setConfirmSummary(
        isFullScriptDesign
          ? "全剧本资产已确认并自动加入资产库。"
          : "本集资产已确认并自动加入资产库。",
      );
      let note =
        counts.created || counts.linked || counts.ignored
          ? `新增 ${counts.created} 项，关联已有 ${counts.linked} 项，忽略 ${counts.ignored} 项。`
          : "";

      const createdAssets = payload.createdAssets ?? [];
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
    isFullScriptDesign,
    loadBundle,
    loadList,
    pendingMedia,
    projectId,
    saveItems,
    selectedId,
  ]);

  const handleConfirmItem = useCallback(
    async (itemId: string) => {
      if (!isPersonalSpace || !selectedId || !fingerprint) return;
      const latestItems = itemsRef.current;
      const item = latestItems.find((candidate) => candidate.id === itemId);
      if (!item) return;
      if (
        (item.resolution === "create_new" || item.resolution === "pending") &&
        item.assetType !== "audio" &&
        !item.generatedMedia?.currentId?.trim()
      ) {
        setPageNote(`无法确认：「${item.name}」尚未生成图片。`);
        return;
      }

      setConfirming(true);
      setConfirmingItemId(itemId);
      setPageNote("");
      try {
        const savedRecord = await saveItems(latestItems, {
          skipReloadList: true,
        });
        if (!savedRecord) return;
        const res = await fetch(
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
          error?: string;
        };
        if (!res.ok) throw new Error(payload.error ?? "确认入库失败");
        if (payload.record) applyRecord(payload.record);

        const created = payload.createdAssets?.find(
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
        await Promise.all([loadList(), loadBundle()]);
      } catch (error) {
        setPageNote(error instanceof Error ? error.message : "确认入库失败");
      } finally {
        setConfirming(false);
        setConfirmingItemId(null);
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
    ],
  );

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

  const updatedAtLabel = formatMetaTime(detail?.record.updatedAt);
  const confirmedAtLabel = formatMetaTime(detail?.record.confirmedAt);
  const selectedEpisodeTitle = detail
    ? meaningfulEpisodeTitle(
        detail.episode.episodeNumber,
        detail.episode.title,
      )
    : null;
  const isAwaitingFullScriptExtraction =
    isFullScriptDesign &&
    designStatus === "not_started" &&
    items.length === 0;
  const missingImageItems = items.filter(
    (item) =>
      (item.resolution === "create_new" || item.resolution === "pending") &&
      item.assetType !== "audio" &&
      !item.generatedMedia?.currentId?.trim(),
  );
  const unboundVoiceItems = items.filter((item) => {
    if (item.resolution !== "create_new" || item.assetType !== "character") {
      return false;
    }
    const mediaId = item.generatedMedia?.currentId?.trim();
    return !mediaId || !isMediaVoiceBound(getDesignMediaVoiceBinding(item, mediaId));
  });
  const canConfirm =
    !generating &&
    !saving &&
    !confirming &&
    Boolean(selectedId) &&
    designStatus !== "stale" &&
    designStatus !== "generating" &&
    designStatus !== "not_started" &&
    designStatus !== "failed" &&
    missingImageItems.length === 0;
  const confirmDisabledReason =
    missingImageItems.length > 0
      ? `请先为${missingImageItems.map((item) => item.name).join("、")}生成图片`
      : undefined;

  const canSubmitApproval =
    !generating && !saving && Boolean(selectedId);

  const canDesign =
    !generating &&
    !confirming &&
    (designStatus === "review" ||
      designStatus === "confirmed" ||
      designStatus === "stale");

  useEffect(() => {
    if (!scriptViewerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setScriptViewerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scriptViewerOpen]);

  return (
    <div className="ead" data-testid="episode-asset-design-workspace">
      <div className={`ead-layout${isAwaitingFullScriptExtraction ? " is-pending" : ""}`}>
        <section className="ead-overview amw-panel" aria-labelledby="ead-overview-title">
          <div className="ead-overview__main">
            <div className="ead-overview__copy">
              <div className="ead-overview__title-row">
                <h2 id="ead-overview-title">资产提取</h2>

                <div className="ead-overview__extract-actions">
                  <button
                    type="button"
                    className="amw-btn amw-btn-primary ead-extract-all-btn"
                    disabled={
                      generating ||
                      batchExtracting ||
                      saving ||
                      confirming
                    }
                    onClick={() => void handleExtractAll()}
                    data-testid="ead-extract-all"
                  >
                    {batchExtracting ? "提取中…" : "一键提取基本资产"}
                  </button>

                  <div
                    className="ead-extract-model-select"
                    data-testid="ead-extract-model"
                  >
                    <GlassSelect
                      label="提取模型"
                      hideLabel
                      value={assetExtractionModel}
                      options={ASSET_EXTRACTION_MODEL_OPTIONS}
                      disabled={
                        generating || batchExtracting || saving || confirming
                      }
                      menuPortal
                      menuSideOffset={6}
                      menuCollisionPadding={12}
                      onChange={setAssetExtractionModel}
                    />
                  </div>
                </div>
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

          {fullScriptPending && !isFullScriptDesign ? (
            <div className="ead-full-script-pending" data-testid="ead-full-script-pending">
              <div>
                <strong>尚未提取资产</strong>
              </div>
              <button
                type="button"
                className="amw-btn ead-full-script-pending__button"
                onClick={() => setSelectedId(SCRIPT_ASSET_DESIGN_ID)}
                disabled={batchExtracting || generating}
              >
                返回全剧本
              </button>
            </div>
          ) : null}

          <div className="ead-episode-tool">
            <div className="ead-episode-tool__copy">
              <strong>
                <span className="ead-episode-tool__eyebrow">辅助</span>
                按集补提取
              </strong>
            </div>
            <div className="ead-episode-tool__controls">
              {!isFullScriptDesign ? (
                <button
                  type="button"
                  className="amw-btn ead-back-full-script"
                  data-testid="ead-back-full-script"
                  disabled={batchExtracting || generating}
                  onClick={() => setSelectedId(SCRIPT_ASSET_DESIGN_ID)}
                >
                  返回全剧本资产
                </button>
              ) : null}
              <div className="ead-episode-select-wrap" data-testid="ead-episode-select">
                <GlassSelect
                  className="ead-episode-glass-select"
                  label="选择剧集"
                  hideLabel
                  value={isFullScriptDesign ? "" : selectedId}
                  disabled={
                    listLoading ||
                    episodes.length === 0 ||
                    batchExtracting ||
                    generating ||
                    generatingAssetIds.size > 0
                  }
                  placeholder={episodeSelectPlaceholder}
                  groups={episodeSelectGroups}
                  menuPortal
                  menuSideOffset={6}
                  menuCollisionPadding={12}
                  onChange={(id) => setSelectedId(id || SCRIPT_ASSET_DESIGN_ID)}
                />
              </div>
            </div>
          </div>
          {episodes.length === 0 && !listLoading ? (
            <p className="ead-error">暂无剧集，请先在剧本阶段完成分集。</p>
          ) : null}
        </section>

        <section className={`ead-detail amw-panel${isAwaitingFullScriptExtraction ? " ead-detail--pending" : ""}`}>
          {detailLoading || !detail ? (
            <div className="amw-empty">加载资产设计…</div>
          ) : isAwaitingFullScriptExtraction ? (
            <div className="ead-pending-assets" data-testid="ead-pending-assets">
              <h2>尚未提取资产</h2>
              {extractedEpisodes.length > 0 ? (
                <div className="ead-pending-assets__recover">
                  <p>
                    当前已有 {extractedEpisodes.length}{" "}
                    集完成按集提取（合计{" "}
                    {extractedEpisodes.reduce(
                      (sum, episode) => sum + episode.itemCount,
                      0,
                    )}{" "}
                    项），可从下方「按集补提取」打开查看。
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
                    <h2>{isFullScriptDesign ? "全剧本资产设计" : "本集资产设计"}</h2>
                    <span className={statusBadgeClass(designStatus)}>
                      {EPISODE_ASSET_DESIGN_STATUS_LABELS[designStatus]}
                    </span>
                  </div>
                  <p className="ead-detail__subtitle">
                    {isFullScriptDesign
                      ? "主理人上传的未分集完整剧本"
                      : `第${detail.episode.episodeNumber}集${
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
                  {!isFullScriptDesign ? (
                    <button
                      type="button"
                      className="amw-btn ead-back-full-script"
                      data-testid="ead-back-full-script-detail"
                      disabled={batchExtracting || generating}
                      onClick={() => setSelectedId(SCRIPT_ASSET_DESIGN_ID)}
                    >
                      返回全剧本资产
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="amw-btn ead-script-btn"
                    disabled={!selectedId || !detail}
                    onClick={() => setScriptViewerOpen(true)}
                    data-testid="ead-view-script"
                  >
                    {isFullScriptDesign ? "查看完整原始剧本" : "查看本集剧本"}
                  </button>
                </div>
              </div>

              <div className="ead-actions amw-actions">
                {!isFullScriptDesign ? (
                  <button
                    type="button"
                    className="amw-btn amw-btn-primary"
                    disabled={generating || saving || confirming}
                    onClick={() => void handleExtract()}
                    data-testid="ead-extract"
                  >
                    {generating ? "提取中…" : extractLabel}
                  </button>
                ) : null}
                {generating ? (
                  <button
                    type="button"
                    className="amw-btn"
                    onClick={() => void handleCancelGenerate()}
                    data-testid="ead-cancel-generate"
                  >
                    取消生成
                  </button>
                ) : null}
                {!isFullScriptDesign ? (
                  <button
                    type="button"
                    className="amw-btn"
                    disabled={!selectedId || generating || saving || confirming}
                    onClick={() => void saveItems(items)}
                    data-testid="ead-save"
                  >
                    {saving ? "保存中…" : "保存本集资产"}
                  </button>
                ) : null}
                {surface === "workspace" ? (
                  <button
                    type="button"
                    className={`amw-btn${canSubmitApproval ? " amw-btn-primary" : ""}`}
                    disabled={!canSubmitApproval}
                    onClick={() => setSubmitApprovalOpen(true)}
                    data-testid="ead-submit-approval"
                  >
                    提交审批素材
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`amw-btn${canConfirm ? " amw-btn-primary" : ""}`}
                    disabled={!canConfirm}
                    title={confirmDisabledReason}
                    onClick={() => void handleConfirm()}
                    data-testid="ead-confirm"
                  >
                    {confirming
                      ? "确认中…"
                      : isFullScriptDesign
                        ? "确认全剧本资产"
                        : "确认本集资产"}
                  </button>
                )}
              </div>

              {surface !== "workspace" && missingImageItems.length > 0 ? (
                <p className="ead-warn" data-testid="ead-missing-image-warning">
                  无法确认：{missingImageItems.map((item) => item.name).join("、")}
                  尚未生成图片。生成图片后才能确认入库。
                </p>
              ) : null}
              {surface !== "workspace" &&
              missingImageItems.length === 0 &&
              unboundVoiceItems.length > 0 ? (
                <p className="ead-warn" data-testid="ead-unbound-voice-warning">
                  提醒：{unboundVoiceItems.length} 个角色尚未绑定音色，可先绑定，或确认入库后在资产库补充。
                </p>
              ) : null}

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
                          disabled={generating || confirming}
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
                                item.assetType === "character"
                                  ? assetGenerationProgress[item.id]
                                  : undefined
                              }
                              disabled={
                                generating ||
                                confirming ||
                                savingVoiceItemIds.has(item.id)
                              }
                              designDisabled={!canDesign}
                              deleteLocked={
                                surface === "workspace" &&
                                isApprovedEpisodeDesignItem(item)
                              }
                              approvalUi={
                                isPersonalSpace
                                  ? "none"
                                  : designCardApprovalUi(
                                      item,
                                      pendingApprovalMediaIds,
                                      approvedApprovalMediaIds,
                                    )
                              }
                              showPersonalConfirm={
                                isPersonalSpace && surface === "project_management"
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
                  {isFullScriptDesign
                    ? "主理人上传的完整原始剧本"
                    : `第${detail.episode.episodeNumber}集剧本`}
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
                : isFullScriptDesign
                  ? "暂无完整原始剧本正文"
                  : "本集暂无正文"}
            </pre>
          </div>
        </div>
      ) : null}

      {reextractOpen ? (
        <div className="amw-overlay" role="presentation">
          <div className="amw-dialog" role="dialog" aria-modal="true">
            <h3>重新提取本集资产？</h3>
            <p className="amw-dialog-desc">
              重新提取会替换当前尚未确认的本集资产设计，是否继续？
            </p>
            <div className="amw-dialog-actions">
              <button
                type="button"
                className="amw-btn"
                onClick={() => setReextractOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                onClick={() => void runExtract()}
              >
                重新提取
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
            if (!progress) {
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
          if (selectedId) void loadDetail(selectedId);
        }}
      />

      {surface === "workspace" && selectedId ? (
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

      {surface === "project_management" && ownerApprovalSubmissionId ? (
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
          {editButton}
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
