"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Download,
  History,
  Plus,
  X,
} from "lucide-react";
import { useChipBounce } from "@/shell/useChipBounce";
import { AssetDetailImage } from "@/projects/assets/AssetDetailImage";
import { AssetDetailLayout } from "@/projects/assets/AssetDetailLayout";
import { CharacterVoiceSettings } from "@/projects/assets/CharacterVoiceSettings";
import { VoiceSelector } from "@/projects/assets/VoiceSelector";
import { VoicePreviewButton } from "@/projects/assets/VoicePreviewButton";
import type {
  AudioAsset,
  CharacterAppearance,
  CharacterAsset,
  VoiceOption,
} from "@/projects/assets/types";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import {
  getProjectAssetImageUrl,
} from "@/projects/assets/asset-image-url";
import {
  listCharacterHistoryMediaIds,
  resolveCharacterPrimaryMediaId,
} from "@/projects/assets/character-media-state";
import {
  ensureCharacterAppearances,
  createCharacterAppearance,
  findAppearanceOwningMedia,
  isAppearanceMedia,
  listCharacterAppearances,
  resolveActiveMediaId,
  resolveScopedVoice,
  type ActiveVisualContext,
} from "@/projects/assets/character-appearance-state";
import { isCharacterMediaSd2Certified } from "@/projects/assets/character-media-video-ref";
import { LibraryAssetEditingPlaceholder } from "@/projects/assets/library-asset-editing-slot";
import { LibraryAssetPromptPanel } from "@/projects/assets/LibraryAssetPromptModal";
import {
  DesignGenerationOverlay,
  type AssetGenerationProgress,
} from "@/projects/assets/DesignGenerationOverlay";
import { postLibrarySd2Precheck } from "@/projects/assets/post-library-sd2-precheck";
import {
  findLibraryDesignItem,
  makeLibraryDesignItem,
  type LibraryPromptAsset,
} from "@/projects/assets/library-asset-prompt";
import {
  buildProjectAssetMediaDragPayload,
  projectAssetMediaDragProps,
} from "@/projects/assets/project-asset-media-drag";
import { UnsavedPromptDialog } from "@/projects/assets/UnsavedPromptDialog";

import { parseResponseJson } from "@/projects/assets/parse-response-json";
import type { PromptVoiceScope } from "@/projects/assets/character-visual-state";
import { promptVoiceAppearanceId } from "@/projects/assets/character-visual-state";

export { resolveCharacterPrimaryMediaId } from "@/projects/assets/character-media-state";

type Props = {
  projectId: string;
  context?: "management" | "workspace";
  character: CharacterAsset | null;
  canEdit: boolean;
  /** @deprecated Status messages now go through onPreviewStatus / top toast. */
  note?: string;
  projectVoices?: VoiceOption[];
  audios?: AudioAsset[];
  onAudiosChange?: (next: AudioAsset[]) => void;
  onPersistAudios?: (next: AudioAsset[]) => Promise<void>;
  onVoiceHardDeleted?: (voiceId: string) => void;
  imageRevision?: number;
  onChange: (next: CharacterAsset) => void;
  onSave: (snapshot?: CharacterAsset) => void;
  onPreviewStatus?: (message: string) => void;
  onImageRevision?: (assetId: string, next: number) => void;
  ensurePersisted?: () => Promise<void>;
  controlledMediaId?: string | null;
  onActiveMediaChange?: (mediaId: string | null) => void;
  designItems?: EpisodeAssetDesignItem[];
  designEpisodeId?: string;
  onDesignItemChange?: (item: EpisodeAssetDesignItem) => void;
  onPromptDirtyChange?: (dirty: boolean) => void;
  promptFlushRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  mergeAvailable?: boolean;
  onRequestMerge?: () => void;
};

type HistoryDeleteState = {
  mediaId: string;
};

type LookLightboxState = {
  appearanceId: string;
  mediaId: string;
};

type LookInUseSample = {
  episodeId: string;
  episodeNumber: number;
  sceneId: string | null;
  sceneNumber: number | null;
  sceneTitle: string | null;
  shotId: string;
  shotNumber: number | null;
};

function buildLookPromptPrefill(character: CharacterAsset): string {
  return `基于主形象生成当前造型。保持同一人物的面部、身份与体型一致；可调整服装、年龄感、伤情、发型或妆造。单人画面。${
    character.name?.trim() ? `角色：${character.name.trim()}。` : ""
  }`;
}

export function CharacterDetail({
  projectId,
  context = "management",
  character,
  canEdit,
  note: _note,
  projectVoices = [],
  audios = [],
  onAudiosChange,
  onPersistAudios,
  onVoiceHardDeleted,
  imageRevision = 0,
  onChange,
  onSave,
  onPreviewStatus,
  onImageRevision,
  ensurePersisted,
  controlledMediaId,
  onActiveMediaChange,
  designItems,
  designEpisodeId = "",
  onDesignItemChange,
  onPromptDirtyChange,
  promptFlushRef,
  mergeAvailable = false,
  onRequestMerge,
}: Props) {
  const saveBounce = useChipBounce();
  const [promptVoiceScope, setPromptVoiceScope] = useState<PromptVoiceScope>({
    scope: "primary",
    appearanceId: null,
  });
  const activeAppearanceId = promptVoiceAppearanceId(promptVoiceScope);
  const setActiveAppearanceId = (appearanceId: string | null) => {
    setPromptVoiceScope(
      appearanceId
        ? { scope: "appearance", appearanceId }
        : { scope: "primary", appearanceId: null },
    );
  };
  const [previewMediaId, setPreviewMediaId] = useState<string | null>(null);
  const [mainGenerationProgress, setMainGenerationProgress] =
    useState<AssetGenerationProgress | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyDeleteConfirm, setHistoryDeleteConfirm] =
    useState<HistoryDeleteState | null>(null);
  const [historyDeleting, setHistoryDeleting] = useState(false);
  const [actionError, setActionError] = useState("");
  const lastStatusToastRef = useRef<string | null>(null);
  const appendedPromptMediaIdRef = useRef<string | null>(null);
  const [lookInUseSamples, setLookInUseSamples] = useState<LookInUseSample[]>(
    [],
  );
  const [promptDirty, setPromptDirty] = useState(false);
  const [pendingScopeAction, setPendingScopeAction] = useState<
    (() => void) | null
  >(null);
  const [scopeUnsavedBusy, setScopeUnsavedBusy] = useState(false);

  const handlePromptDirtyChange = (dirty: boolean) => {
    setPromptDirty(dirty);
    onPromptDirtyChange?.(dirty);
  };

  const runWithPromptGuard = (action: () => void) => {
    if (!promptDirty) {
      action();
      return;
    }
    setPendingScopeAction(() => action);
  };
  useEffect(() => {
    const text = actionError.trim();
    if (!text) {
      lastStatusToastRef.current = null;
      return;
    }
    if (lastStatusToastRef.current === text) return;
    lastStatusToastRef.current = text;
    onPreviewStatus?.(text);
  }, [actionError, onPreviewStatus]);
  const [uploadLookPhase, setUploadLookPhase] = useState<
    "idle" | "validating" | "submitting"
  >("idle");
  const [mainUploadPhase, setMainUploadPhase] = useState<
    "idle" | "validating" | "submitting"
  >("idle");
  const [pendingVoice, setPendingVoice] = useState<VoiceOption | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [appearanceDeleting, setAppearanceDeleting] = useState(false);
  const [primaryDeleteConfirm, setPrimaryDeleteConfirm] = useState(false);
  const [lookLightbox, setLookLightbox] = useState<LookLightboxState | null>(
    null,
  );
  const [lightboxPendingVoice, setLightboxPendingVoice] =
    useState<VoiceOption | null>(null);
  const [lightboxNameDraft, setLightboxNameDraft] = useState("");
  const [validationBusy, setValidationBusy] = useState(false);
  const [lookUploadMode, setLookUploadMode] = useState<"add" | "active">(
    "add",
  );
  const [lookPage, setLookPage] = useState(0);

  const LOOKS_PER_PAGE = 4;

  const lookUploadInputRef = useRef<HTMLInputElement>(null);
  const mainUploadInputRef = useRef<HTMLInputElement>(null);
  const historyPopoverRef = useRef<HTMLDivElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const promptSplitRef = useRef<HTMLDivElement>(null);
  const [lightboxLeftRect, setLightboxLeftRect] = useState<DOMRect | null>(null);

  const uploadLookBusy = uploadLookPhase !== "idle";
  const mainUploadBusy = mainUploadPhase !== "idle";

  const ensured = useMemo(
    () => (character ? ensureCharacterAppearances(character) : null),
    [character],
  );
  const appearances = useMemo(
    () => (ensured ? listCharacterAppearances(ensured) : []),
    [ensured],
  );
  const primaryMediaId = ensured
    ? resolveCharacterPrimaryMediaId(ensured)
    : null;
  const mainHistoryIds = useMemo(() => {
    if (!ensured) return [];
    const primary = resolveCharacterPrimaryMediaId(ensured);
    // Hide look media that was incorrectly written into main history.
    // Data model keeps primary out of historyMediaIds — prepend it for the
    // history UI so the in-use main image is always visible and marked.
    const history = listCharacterHistoryMediaIds(ensured).filter(
      (id) => id !== primary && !isAppearanceMedia(ensured, id),
    );
    return primary ? [primary, ...history] : history;
  }, [ensured]);

  const activeAppearance: CharacterAppearance | null = useMemo(() => {
    if (!activeAppearanceId || !ensured) return null;
    return (
      appearances.find((item) => item.id === activeAppearanceId) ?? null
    );
  }, [activeAppearanceId, appearances, ensured]);

  const currentMediaId = ensured
    ? resolveActiveMediaId(ensured, activeAppearanceId)
    : null;

  const historyMediaIds = useMemo(() => {
    if (activeAppearance) {
      const current = activeAppearance.currentMediaId?.trim() || null;
      const history = activeAppearance.mediaHistory.filter((id) => id !== current);
      return current ? [current, ...history] : history;
    }
    return mainHistoryIds;
  }, [activeAppearance, mainHistoryIds]);

  // Identity-only sync: do not fold controlledMediaId into this key or every
  // preview notify remounts look state and can flash the previous character image.
  const characterIdentityKey = character?.id ?? "";
  const [syncedCharacterId, setSyncedCharacterId] =
    useState(characterIdentityKey);
  const characterJustSwitched = syncedCharacterId !== characterIdentityKey;
  if (characterJustSwitched) {
    setSyncedCharacterId(characterIdentityKey);
    setHistoryOpen(false);
    setHistoryDeleteConfirm(null);
    setActionError("");
    setLookInUseSamples([]);
    appendedPromptMediaIdRef.current = null;
    setPromptVoiceScope({ scope: "primary", appearanceId: null });
    setPendingVoice(null);
    setDeleteConfirmId(null);
    setPrimaryDeleteConfirm(false);
    setLookLightbox(null);
    setLookPage(0);
    if (!character) {
      setPreviewMediaId(null);
    } else {
      const seed = controlledMediaId ?? primaryMediaId;
      setPreviewMediaId(seed);
      if (!controlledMediaId && primaryMediaId) {
        onActiveMediaChange?.(primaryMediaId);
      }
    }
  }

  // Keep previewMediaId aligned when host-controlled media changes for the
  // *same* character (history pick / generate), without treating it as a switch.
  const [syncedControlledMediaId, setSyncedControlledMediaId] = useState(
    controlledMediaId ?? null,
  );
  if (
    !characterJustSwitched &&
    syncedControlledMediaId !== (controlledMediaId ?? null)
  ) {
    setSyncedControlledMediaId(controlledMediaId ?? null);
    if (controlledMediaId) {
      setPreviewMediaId(controlledMediaId);
    }
  } else if (characterJustSwitched) {
    setSyncedControlledMediaId(controlledMediaId ?? null);
  }

  useEffect(() => {
    setLookPage((page) => {
      const maxPage = Math.max(
        0,
        Math.ceil(appearances.length / LOOKS_PER_PAGE) - 1,
      );
      return Math.min(page, maxPage);
    });
  }, [appearances.length]);

  useEffect(() => {
    if (!historyOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHistoryOpen(false);
        setHistoryDeleteConfirm(null);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (historyPopoverRef.current?.contains(target)) return;
      if (historyButtonRef.current?.contains(target)) return;
      setHistoryOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [historyOpen]);

  useEffect(() => {
    setLightboxPendingVoice(null);
  }, [lookLightbox?.appearanceId]);

  useEffect(() => {
    if (!lookLightbox) {
      setLightboxLeftRect(null);
      return;
    }
    const measure = () => {
      const leftColumn = promptSplitRef.current?.querySelector<HTMLElement>(
        ".character-prompt-split__left",
      );
      if (!leftColumn) return;
      setLightboxLeftRect(leftColumn.getBoundingClientRect());
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    if (promptSplitRef.current && observer) {
      observer.observe(promptSplitRef.current);
    }
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer?.disconnect();
    };
  }, [lookLightbox]);

  useEffect(() => {
    if (!lookLightbox) return;
    document.body.classList.add("character-look-lightbox-open");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setLookLightbox(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("character-look-lightbox-open");
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [lookLightbox]);

  if (!character || !ensured) {
    return (
      <AssetDetailLayout
        title="角色"
        aria-label="角色"
        empty
        emptyMessage="在左侧选择角色，或新建角色开始编辑。"
        showControls={false}
      />
    );
  }

  const apiRoot =
    context === "workspace"
      ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
      : `/api/projects/${encodeURIComponent(projectId)}`;

  const rawPreviewCandidate = characterJustSwitched
    ? (controlledMediaId ??
        (activeAppearanceId
          ? activeAppearance?.currentMediaId?.trim() || null
          : primaryMediaId) ??
        null)
    : (previewMediaId ??
        controlledMediaId ??
        (activeAppearanceId
          ? activeAppearance?.currentMediaId?.trim() || null
          : primaryMediaId) ??
        null);
  const effectivePreviewId = rawPreviewCandidate;

  const visualContext: ActiveVisualContext = {
    characterId: character.id,
    appearanceId: activeAppearanceId,
    mediaId: effectivePreviewId,
  };

  const scopedVoice = resolveScopedVoice({
    character: ensured,
    appearanceId: activeAppearanceId,
  });
  const displayedVoiceId = pendingVoice?.id ?? scopedVoice.voiceId;
  const catalogVoiceName = (() => {
    const id = displayedVoiceId?.trim();
    if (!id) return null;
    const hit =
      projectVoices.find((item) => item.id === id) ??
      audios.find((item) => item.id === id);
    if (!hit) return null;
    const fromVoice = "name" in hit ? String(hit.name ?? "").trim() : "";
    const fromLabel = "label" in hit ? String(hit.label ?? "").trim() : "";
    return fromVoice || fromLabel || null;
  })();
  const displayedVoiceName =
    pendingVoice?.name?.trim() ||
    pendingVoice?.label?.trim() ||
    scopedVoice.voiceName?.trim() ||
    catalogVoiceName ||
    null;
  const voiceSelectionDirty = Boolean(
    pendingVoice && pendingVoice.id !== scopedVoice.voiceId,
  );
  const voiceBoundCurrent =
    Boolean(scopedVoice.voiceId) && !voiceSelectionDirty;
  const voiceBadgeText = (() => {
    if (pendingVoice) {
      const pendingName =
        pendingVoice.name?.trim() ||
        pendingVoice.label?.trim() ||
        "未命名音色";
      return `${pendingName} · 待绑定`;
    }
    const boundName =
      scopedVoice.voiceName?.trim() || catalogVoiceName || null;
    if (activeAppearanceId && scopedVoice.inheritsDefault) {
      return boundName ? `继承 · ${boundName}` : "继承人物默认音色";
    }
    if (boundName) return boundName;
    return scopedVoice.voiceId ? "已绑定音色" : "未绑定音色";
  })();

  const applyCharacter = (
    next: CharacterAsset,
    options?: {
      bumpRevision?: boolean;
      previewId?: string | null;
      appearanceId?: string | null;
    },
  ) => {
    onChange(next);
    if (options?.appearanceId !== undefined) {
      setActiveAppearanceId(options.appearanceId);
    }
    const ensuredNext = ensureCharacterAppearances(next);
    const nextPrimary = resolveCharacterPrimaryMediaId(ensuredNext);
    let nextCurrent =
      options?.previewId !== undefined
        ? options.previewId
        : resolveActiveMediaId(
            ensuredNext,
            options?.appearanceId !== undefined
              ? options.appearanceId
              : activeAppearanceId,
          );
    setPreviewMediaId(nextCurrent);
    onActiveMediaChange?.(nextCurrent);
    if (options?.bumpRevision !== false) {
      onImageRevision?.(character.id, imageRevision + 1);
    }
  };

  const runMediaAction = async (
    action: string,
    payload: {
      mediaId?: string;
      appearanceId?: string;
      displayName?: string;
      promptOverride?: string;
      jobId?: string;
    } = {},
  ) => {
    if (!canEdit || historyBusy) return null;
    setHistoryBusy(true);
    setActionError("");
    setLookInUseSamples([]);
    try {
      if (ensurePersisted) await ensurePersisted();
      const response = await fetch(
        `${apiRoot}/assets-draft/characters/${encodeURIComponent(character.id)}/media`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            ...(payload.mediaId ? { mediaId: payload.mediaId } : {}),
            ...(payload.appearanceId
              ? { appearanceId: payload.appearanceId }
              : {}),
            ...(payload.displayName !== undefined
              ? { displayName: payload.displayName }
              : {}),
            ...(payload.promptOverride !== undefined
              ? { promptOverride: payload.promptOverride }
              : {}),
            ...(payload.jobId ? { jobId: payload.jobId } : {}),
          }),
        },
      );
      const body = await parseResponseJson<{
        error?: string;
        code?: string;
        character?: CharacterAsset;
        appearance?: CharacterAppearance;
        samples?: LookInUseSample[];
      }>(response);
      if (!response.ok || !body?.character) {
        if (body?.code === "CHARACTER_LOOK_IN_USE") {
          setLookInUseSamples(body.samples ?? []);
        }
        if (
          body?.code === "ASSET_REVISION_REQUIRED" ||
          body?.code === "ASSET_REVISION_CONFLICT" ||
          response.status === 409
        ) {
          throw new Error(body?.error ?? "资产数据已变更，请刷新后重试");
        }
        throw new Error(body?.error ?? "操作失败");
      }
      return body;
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "操作失败");
      return null;
    } finally {
      setHistoryBusy(false);
    }
  };

  const clearPrimaryMedia = async () => {
    if (!canEdit || !primaryMediaId || historyBusy) return;
    setPrimaryDeleteConfirm(false);
    const result = await runMediaAction("clear-primary");
    if (result?.character) {
      applyCharacter(result.character, {
        appearanceId: null,
        previewId: null,
      });
      onSave(result.character);
      onPreviewStatus?.("已删除主形象，请重新绑定人物默认音色。");
    }
  };

  const confirmUseMedia = async (mediaId: string) => {
    setActionError("");
    if (!isCharacterMediaSd2Certified(ensured, mediaId)) {
      setActionError("该图片尚未通过人物校验，不能确认使用。");
      return;
    }
    // Look media can only confirm within a look context — never as primary.
    if (
      isAppearanceMedia(ensured, mediaId) &&
      !activeAppearanceId &&
      mediaId !== primaryMediaId
    ) {
      setActionError("造型图片不能设为主形象");
      return;
    }
    if (activeAppearanceId) {
      const result = await runMediaAction("confirm-appearance", {
        mediaId,
        appearanceId: activeAppearanceId,
      });
      if (result?.character) {
        applyCharacter(result.character, {
          previewId: mediaId,
          appearanceId: activeAppearanceId,
        });
        setHistoryOpen(false);
        onPreviewStatus?.("已确认为当前造型形象。");
      }
      return;
    }
    const result = await runMediaAction("confirm-main", { mediaId });
    if (result?.character) {
      applyCharacter(result.character, {
        previewId: mediaId,
      });
      setHistoryOpen(false);
      onPreviewStatus?.("已确认为主形象。");
    }
  };

  const selectMainSlot = () => {
    runWithPromptGuard(() => {
      setPromptVoiceScope({ scope: "primary", appearanceId: null });
      setPendingVoice(null);
      setLookLightbox(null);
      const nextPreview =
        previewMediaId && mainHistoryIds.includes(previewMediaId)
          ? previewMediaId
          : primaryMediaId;
      setPreviewMediaId(nextPreview);
      onActiveMediaChange?.(nextPreview);
    });
  };

  const selectAppearanceForPrompt = (appearance: CharacterAppearance) => {
    setPromptVoiceScope({ scope: "appearance", appearanceId: appearance.id });
    setPendingVoice(null);
    const mediaId = appearance.currentMediaId?.trim();
    if (mediaId) {
      setPreviewMediaId(mediaId);
      onActiveMediaChange?.(mediaId);
    } else {
      setPreviewMediaId(null);
      onActiveMediaChange?.(null);
    }
  };

  const openAppearanceLightbox = (appearance: CharacterAppearance) => {
    const mediaId = appearance.currentMediaId?.trim();
    if (!mediaId) return;
    setLookLightbox({ appearanceId: appearance.id, mediaId });
  };

  const selectLookAppearance = (appearance: CharacterAppearance) => {
    runWithPromptGuard(() => {
      selectAppearanceForPrompt(appearance);
      const mediaId = appearance.currentMediaId?.trim();
      if (mediaId) {
        setPreviewMediaId(mediaId);
        onActiveMediaChange?.(mediaId);
      }
      setLookLightbox(null);
    });
  };

  const uploadCandidate = async (file: File) => {
    if (ensurePersisted) await ensurePersisted();
    const form = new FormData();
    form.set("file", file);
    const uploadRes = await fetch(
      `${apiRoot}/assets-draft/characters/${encodeURIComponent(character.id)}/replace-primary`,
      { method: "POST", credentials: "include", body: form },
    );
    const uploadPayload = await parseResponseJson<{
      error?: string;
      candidateMediaId?: string;
      character?: CharacterAsset;
    }>(uploadRes);
    if (!uploadRes.ok || !uploadPayload?.candidateMediaId) {
      throw new Error(uploadPayload?.error ?? "上传失败");
    }
    return uploadPayload.candidateMediaId;
  };

  const uploadAndAddLook = async (file: File) => {
    if (!canEdit || uploadLookBusy) return;
    setUploadLookPhase("validating");
    setActionError("");
    try {
      const candidateMediaId = await uploadCandidate(file);
      const precheck = await postLibrarySd2Precheck({
        apiRoot,
        assetId: character.id,
        mediaId: candidateMediaId,
      });
      if (precheck.character) {
        applyCharacter(precheck.character, { previewId: candidateMediaId });
      }
      if (!precheck.ok) {
        throw new Error(precheck.error ?? "人物校验未通过");
      }
      setUploadLookPhase("submitting");
      const result = await runMediaAction("add-look", {
        mediaId: candidateMediaId,
      });
      if (result?.character) {
        const appearanceId = result.appearance?.id ?? null;
        applyCharacter(result.character, {
          previewId: candidateMediaId,
          appearanceId,
        });
        onPreviewStatus?.("已上传造型并通过人物校验。");
      }
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "上传造型失败");
    } finally {
      setUploadLookPhase("idle");
    }
  };

  const uploadMainMedia = async (file: File) => {
    if (!canEdit || mainUploadBusy) return;
    setMainUploadPhase("validating");
    setActionError("");
    try {
      const candidateMediaId = await uploadCandidate(file);
      const precheck = await postLibrarySd2Precheck({
        apiRoot,
        assetId: character.id,
        mediaId: candidateMediaId,
      });
      if (precheck.character) {
        applyCharacter(precheck.character, {
          previewId: candidateMediaId,
          appearanceId: null,
        });
      }
      if (!precheck.ok) {
        throw new Error(precheck.error ?? "人物校验未通过");
      }
      setMainUploadPhase("submitting");
      if (!primaryMediaId) {
        const result = await runMediaAction("confirm-main", {
          mediaId: candidateMediaId,
        });
        if (result?.character) {
          applyCharacter(result.character, {
            previewId: candidateMediaId,
            appearanceId: null,
          });
          onPreviewStatus?.("已上传并设为主形象。");
        }
      } else {
        const result = await runMediaAction("append-main-media", {
          mediaId: candidateMediaId,
        });
        if (result?.character) {
          applyCharacter(result.character, {
            previewId: candidateMediaId,
            appearanceId: null,
          });
          onPreviewStatus?.("已上传到主形象历史，请确认使用。");
        }
      }
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "上传主形象失败",
      );
    } finally {
      setMainUploadPhase("idle");
    }
  };

  const openCreateLookEditor = () => {
    if (!canEdit || historyBusy) return;
    setActionError("");
    lastStatusToastRef.current = null;
    setMainGenerationProgress(null);
    const { asset: next, appearance } = createCharacterAppearance({
      asset: ensured,
      promptOverride: "",
      currentMediaId: null,
    });
    const nextAppearances = next.appearances ?? [];
    const nextPage = Math.max(
      0,
      Math.ceil(nextAppearances.length / LOOKS_PER_PAGE) - 1,
    );
    setLookPage(nextPage);
    applyCharacter(next, {
      appearanceId: appearance.id,
      bumpRevision: false,
      previewId: null,
    });
    selectAppearanceForPrompt(appearance);
    setLookLightbox(null);
  };

  const uploadToActiveLook = async (file: File) => {
    if (!canEdit || !activeAppearanceId || uploadLookBusy) return;
    setUploadLookPhase("validating");
    setActionError("");
    try {
      const candidateMediaId = await uploadCandidate(file);
      const precheck = await postLibrarySd2Precheck({
        apiRoot,
        assetId: character.id,
        mediaId: candidateMediaId,
      });
      if (precheck.character) {
        applyCharacter(precheck.character, {
          appearanceId: activeAppearanceId,
          previewId: candidateMediaId,
        });
      }
      if (!precheck.ok) {
        throw new Error(precheck.error ?? "人物校验未通过");
      }
      setUploadLookPhase("submitting");
      const result = await runMediaAction("confirm-appearance", {
        appearanceId: activeAppearanceId,
        mediaId: candidateMediaId,
      });
      if (result?.character) {
        applyCharacter(result.character, {
          previewId: candidateMediaId,
          appearanceId: activeAppearanceId,
        });
        onPreviewStatus?.("已上传造型图片并通过人物校验。");
      }
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "上传造型失败");
    } finally {
      setUploadLookPhase("idle");
    }
  };

  const deleteAppearance = async (appearanceId: string) => {
    if (appearanceDeleting) return;
    setAppearanceDeleting(true);
    try {
      const result = await runMediaAction("delete-appearance", { appearanceId });
      if (result?.character) {
        const wasActive =
          promptVoiceScope.scope === "appearance" &&
          promptVoiceScope.appearanceId === appearanceId;
        applyCharacter(result.character, {
          appearanceId: wasActive ? null : activeAppearanceId,
          previewId: wasActive
            ? resolveCharacterPrimaryMediaId(result.character)
            : previewMediaId ?? primaryMediaId,
        });
        if (wasActive) {
          setPromptVoiceScope({ scope: "primary", appearanceId: null });
        }
        setDeleteConfirmId(null);
        onPreviewStatus?.("已删除造型。");
      }
    } finally {
      setAppearanceDeleting(false);
    }
  };

  const deleteHistoryMedia = async (mediaId: string) => {
    if (mediaId === primaryMediaId || historyDeleting) return;
    setHistoryDeleting(true);
    setActionError("");
    try {
      const result = await runMediaAction("delete-main-history", { mediaId });
      if (result?.character) {
        const nextPrimary = resolveCharacterPrimaryMediaId(result.character);
        applyCharacter(result.character, {
          previewId:
            previewMediaId === mediaId ? nextPrimary : previewMediaId,
        });
        setHistoryDeleteConfirm(null);
        onPreviewStatus?.("已从主形象历史删除。");
      }
    } finally {
      setHistoryDeleting(false);
    }
  };

  const persistAppearancePrompt = async (text: string) => {
    if (!activeAppearanceId || !canEdit) return;
    const trimmed = text.trim();
    const current =
      activeAppearance?.promptOverride?.trim() ?? "";
    if (trimmed === current) return;
    const result = await runMediaAction("update-appearance-prompt", {
      appearanceId: activeAppearanceId,
      promptOverride: trimmed,
    });
    if (result?.character) {
      applyCharacter(result.character, {
        bumpRevision: false,
        appearanceId: activeAppearanceId,
        previewId:
          activeAppearanceId && activeAppearance?.currentMediaId
            ? activeAppearance.currentMediaId
            : previewMediaId ?? primaryMediaId,
      });
    }
  };

  const bindScopedVoice = async () => {
    if (!canEdit) return;
    const voice = pendingVoice;
    const voiceId = voice?.id ?? displayedVoiceId;
    const voiceName =
      voice?.name?.trim() ||
      voice?.label?.trim() ||
      displayedVoiceName?.trim() ||
      null;
    if (!voiceId) return;
    saveBounce.trigger();
    try {
      if (ensurePersisted) await ensurePersisted();
      const response = await fetch(
        `${apiRoot}/assets-draft/characters/${encodeURIComponent(character.id)}/voice`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            activeAppearanceId
              ? {
                  scope: "appearance_override",
                  appearanceId: activeAppearanceId,
                  voiceId,
                  voiceName,
                  expectedRevision: activeAppearance?.revision,
                }
              : {
                  scope: "character_default",
                  voiceId,
                  voiceName,
                  voiceStyle: voice?.style ?? null,
                },
          ),
        },
      );
      const payload = await parseResponseJson<{
        error?: string;
        character?: CharacterAsset;
      }>(response);
      if (!response.ok || !payload?.character) {
        throw new Error(payload?.error ?? "绑定音色失败");
      }
      applyCharacter(payload.character, {
        bumpRevision: false,
        appearanceId: activeAppearanceId,
        previewId: effectivePreviewId,
      });
      setPendingVoice(null);
      onSave(payload.character);
      onPreviewStatus?.("音色已绑定。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "绑定音色失败");
    }
  };

  const lightboxAppearance = lookLightbox
    ? appearances.find((item) => item.id === lookLightbox.appearanceId) ?? null
    : null;

  useEffect(() => {
    if (lightboxAppearance) {
      setLightboxNameDraft(lightboxAppearance.name);
    }
  }, [lookLightbox?.appearanceId, lightboxAppearance?.name]);
  const lightboxScopedVoice = lookLightbox
    ? resolveScopedVoice({
        character: ensured,
        appearanceId: lookLightbox.appearanceId,
      })
    : null;
  const lightboxDisplayedVoiceId =
    lightboxPendingVoice?.id ?? lightboxScopedVoice?.voiceId ?? null;
  const lightboxDisplayedVoiceName =
    lightboxPendingVoice?.name?.trim() ||
    lightboxPendingVoice?.label?.trim() ||
    lightboxScopedVoice?.voiceName?.trim() ||
    null;
  const lightboxVoiceDirty = Boolean(
    lightboxPendingVoice &&
      lightboxPendingVoice.id !== lightboxScopedVoice?.voiceId,
  );
  const lightboxVoiceBound =
    Boolean(lightboxScopedVoice?.voiceId) &&
    !lightboxScopedVoice?.inheritsDefault &&
    !lightboxVoiceDirty;

  const renameAppearance = async (
    appearanceId: string,
    displayName: string,
    previousName: string,
  ) => {
    const trimmed = displayName.trim();
    if (!trimmed || trimmed === previousName.trim()) return;
    const result = await runMediaAction("rename-appearance", {
      appearanceId,
      displayName: trimmed,
    });
    if (result?.character) {
      applyCharacter(result.character, {
        appearanceId: activeAppearanceId,
        bumpRevision: false,
      });
    }
  };

  const bindLookLightboxVoice = async () => {
    if (!canEdit || !lookLightbox) return;
    const voice = lightboxPendingVoice;
    const voiceId = voice?.id ?? lightboxDisplayedVoiceId;
    const voiceName =
      voice?.name?.trim() ||
      voice?.label?.trim() ||
      lightboxDisplayedVoiceName?.trim() ||
      null;
    if (!voiceId) return;
    saveBounce.trigger();
    try {
      if (ensurePersisted) await ensurePersisted();
      const response = await fetch(
        `${apiRoot}/assets-draft/characters/${encodeURIComponent(character.id)}/voice`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: "appearance_override",
            appearanceId: lookLightbox.appearanceId,
            voiceId,
            voiceName,
            expectedRevision: lightboxAppearance?.revision,
          }),
        },
      );
      const payload = await parseResponseJson<{
        error?: string;
        character?: CharacterAsset;
      }>(response);
      if (!response.ok || !payload?.character) {
        throw new Error(payload?.error ?? "绑定音色失败");
      }
      applyCharacter(payload.character, {
        bumpRevision: false,
        appearanceId: activeAppearanceId,
        previewId: effectivePreviewId,
      });
      setLightboxPendingVoice(null);
      onSave(payload.character);
      onPreviewStatus?.("造型音色已绑定。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "绑定音色失败");
    }
  };

  const clearVoiceOverride = async () => {
    if (!canEdit || !activeAppearanceId) return;
    try {
      if (ensurePersisted) await ensurePersisted();
      const response = await fetch(
        `${apiRoot}/assets-draft/characters/${encodeURIComponent(character.id)}/voice`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: "appearance_override",
            appearanceId: activeAppearanceId,
            clearOverride: true,
            voiceId: null,
            voiceName: null,
            expectedRevision: activeAppearance?.revision,
          }),
        },
      );
      const payload = await parseResponseJson<{
        error?: string;
        character?: CharacterAsset;
      }>(response);
      if (!response.ok || !payload?.character) {
        throw new Error(payload?.error ?? "恢复继承失败");
      }
      applyCharacter(payload.character, {
        bumpRevision: false,
        appearanceId: activeAppearanceId,
        previewId: effectivePreviewId,
      });
      setPendingVoice(null);
      onPreviewStatus?.("已恢复继承人物默认音色。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "恢复继承失败");
    }
  };

  const syncPromptMedia = (mediaId: string | null) => {
    if (!mediaId) return;

    const isLookMedia =
      isAppearanceMedia(ensured, mediaId) && mediaId !== primaryMediaId;

    if (isLookMedia && !activeAppearanceId) {
      // Orphan look media from prompt sync — bind to owning look, never hero.
      const owning = findAppearanceOwningMedia(ensured, mediaId);
      if (owning) setActiveAppearanceId(owning.id);
      appendedPromptMediaIdRef.current = mediaId;
      return;
    }

    if (isLookMedia && activeAppearanceId) {
      setPreviewMediaId(mediaId);
      onActiveMediaChange?.(mediaId);
    }

    if (!isLookMedia) {
      // Main / main-history candidate — may temporarily preview in hero (option B).
      setPreviewMediaId(mediaId);
      onActiveMediaChange?.(mediaId);
    }
    // Look media while an appearance is active: keep hero on primary; append below.
    if (appendedPromptMediaIdRef.current === mediaId) return;

    const appearanceId = activeAppearanceId;
    const activeLook = appearanceId
      ? appearances.find((item) => item.id === appearanceId)
      : null;
    const alreadyTracked = activeLook
      ? activeLook.currentMediaId === mediaId ||
        activeLook.mediaHistory.includes(mediaId)
      : primaryMediaId === mediaId ||
        mainHistoryIds.includes(mediaId) ||
        (ensured.historyMediaIds ?? []).includes(mediaId);
    if (alreadyTracked) {
      appendedPromptMediaIdRef.current = mediaId;
      return;
    }
    appendedPromptMediaIdRef.current = mediaId;

    void (async () => {
      const action = appearanceId
        ? "append-appearance-media"
        : "append-main-media";
      const payload = {
        mediaId,
        ...(appearanceId ? { appearanceId } : {}),
      };
      let result = await runMediaAction(action, payload);
      if (!result) {
        result = await runMediaAction(action, payload);
      }
      if (result?.character) {
        applyCharacter(result.character, {
          previewId: mediaId,
          appearanceId,
          bumpRevision: false,
        });
        setActionError("");
      }
    })();
  };

  const downloadActiveImage = () => {
    if (!effectivePreviewId || !previewSrc) return;
    const anchor = document.createElement("a");
    anchor.href = previewSrc;
    anchor.download = `${character.name || "character"}-${effectivePreviewId}.png`;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const previewSrc = effectivePreviewId
    ? getProjectAssetImageUrl(projectId, effectivePreviewId, {
        // Stable per media id; only bump when host explicitly revises (replace).
        revision:
          imageRevision > 0
            ? `${effectivePreviewId}:r${imageRevision}`
            : effectivePreviewId,
        context,
      })
    : null;

  const certifiedCurrent = effectivePreviewId
    ? isCharacterMediaSd2Certified(ensured, effectivePreviewId)
    : false;

  const runValidationForMedia = async (
    mediaId: string,
    options?: { autoConfirm?: boolean },
  ): Promise<boolean> => {
    if (!canEdit || validationBusy || !mediaId) return false;
    setValidationBusy(true);
    setActionError("");
    try {
      const precheck = await postLibrarySd2Precheck({
        apiRoot,
        assetId: character.id,
        mediaId,
      });
      if (precheck.character) {
        applyCharacter(precheck.character, {
          appearanceId: activeAppearanceId,
          previewId: mediaId,
          bumpRevision: true,
        });
      }
      if (!precheck.ok) {
        throw new Error(precheck.error ?? "人物校验未通过");
      }
      onPreviewStatus?.(
        activeAppearanceId ? "造型校验已通过。" : "人物校验已通过。",
      );
      if (options?.autoConfirm) {
        await confirmUseMedia(mediaId);
      }
      return true;
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "人物校验失败",
      );
      return false;
    } finally {
      setValidationBusy(false);
    }
  };

  const runCurrentValidation = async () => {
    if (!effectivePreviewId || certifiedCurrent) return;
    await runValidationForMedia(effectivePreviewId);
  };

  const handleHistoryItemPreview = (mediaId: string) => {
    setPreviewMediaId(mediaId);
    onActiveMediaChange?.(mediaId);
  };

  const handleHistoryItemAction = async (mediaId: string) => {
    handleHistoryItemPreview(mediaId);
    const certified = isCharacterMediaSd2Certified(ensured, mediaId);
    if (!certified) {
      await runValidationForMedia(mediaId, { autoConfirm: true });
      return;
    }
    await confirmUseMedia(mediaId);
  };

  const validationLabel = activeAppearanceId ? "造型校验" : "主形象校验";
  const objectLabel = activeAppearance
    ? `造型：${activeAppearance.name}`
    : "主形象";
  const promptContextLabel = activeAppearance
    ? `造型：${activeAppearance.name}`
    : "主形象提示词";
  const voiceObjectLabel = activeAppearance?.name?.trim() || objectLabel;
  const appearancePromptScopeKey = activeAppearanceId
    ? `appearance:${activeAppearanceId}`
    : "primary";
  const appearancePromptScopeText = activeAppearance
    ? activeAppearance.currentMediaId?.trim()
      ? activeAppearance.promptOverride?.trim() ||
        buildLookPromptPrefill(character)
      : activeAppearance.promptOverride?.trim() ?? ""
    : null;
  const designItem = findLibraryDesignItem(
    character as LibraryPromptAsset,
    designItems,
  );
  const mainPromptScopeText = useMemo(
    () =>
      makeLibraryDesignItem(
        character as LibraryPromptAsset,
        "character",
        designItem,
      ).designPrompt?.text ?? "",
    [character, designItem],
  );
  const promptScopeText = activeAppearanceId
    ? appearancePromptScopeText
    : mainPromptScopeText;
  const totalLookPages = Math.max(
    1,
    Math.ceil(appearances.length / LOOKS_PER_PAGE),
  );
  const safeLookPage = Math.min(lookPage, totalLookPages - 1);
  const pagedAppearances = appearances.slice(
    safeLookPage * LOOKS_PER_PAGE,
    safeLookPage * LOOKS_PER_PAGE + LOOKS_PER_PAGE,
  );
  const lookBoardSlots = [0, 1, 2, 3] as const;
  const mainBoardMediaId = primaryMediaId;
  const mainBoardCertified = mainBoardMediaId
    ? isCharacterMediaSd2Certified(ensured, mainBoardMediaId)
    : false;
  const historyPopoverTitle = activeAppearance
    ? `${activeAppearance.name} 历史`
    : "主形象历史";
  const heroDragPayload = useMemo(
    () =>
      effectivePreviewId
        ? buildProjectAssetMediaDragPayload({
            projectId,
            context,
            mediaId: effectivePreviewId,
            label: character.name,
          })
        : null,
    [projectId, context, effectivePreviewId, character.name],
  );
  const mainBoardDragPayload = useMemo(
    () =>
      mainBoardMediaId
        ? buildProjectAssetMediaDragPayload({
            projectId,
            context,
            mediaId: mainBoardMediaId,
            label: `${character.name} · 主形象`,
          })
        : null,
    [projectId, context, mainBoardMediaId, character.name],
  );

  return (
    <>
      <AssetDetailLayout
        title="角色"
        aria-label="角色"
        className="character-detail character-detail--prompt-split"
        showControls={false}
        banner={
          !canEdit ? (
            <div className="amw-readonly-banner">
              当前账号无资产编辑权限（默认仅项目主理人可编辑）。
            </div>
          ) : null
        }
        preview={
          <div
            className="character-prompt-split"
            data-testid="character-prompt-split"
            ref={promptSplitRef}
          >
            <div className="character-prompt-split__left">
              <div
                className="character-media-stage character-preview-pane character-primary-preview"
                data-testid="character-hero-stage"
                onClick={() => {
                  if (previewSrc) selectMainSlot();
                }}
                style={
                  previewSrc
                    ? ({
                        ["--preview-image" as string]: `url("${previewSrc}")`,
                        cursor: "pointer",
                      } as React.CSSProperties)
                    : undefined
                }
              >
                {previewSrc ? (
                  <div
                    className="character-preview-pane__display project-asset-media-drag-source"
                    data-testid="character-preview-display"
                    {...projectAssetMediaDragProps(heroDragPayload)}
                  >
                    <AssetDetailImage
                      fill
                      src={previewSrc}
                      alt={character.imageFileName ?? character.name}
                      testId="character-hero-image"
                    />
                  </div>
                ) : canEdit ? (
                  <div
                    className="character-media-stage__empty-actions"
                    data-testid="character-empty-hero"
                  >
                    <p
                      className="character-media-stage__empty-hint"
                      data-testid="character-empty-hero-hint"
                    >
                      请在右侧填写主形象素材提示词后生成。
                    </p>
                    <button
                      type="button"
                      className="amw-btn amw-btn-primary"
                      data-testid="character-main-upload"
                      disabled={mainUploadBusy}
                      onClick={() => mainUploadInputRef.current?.click()}
                    >
                      {mainUploadBusy ? "处理中…" : "上传主形象"}
                    </button>
                  </div>
                ) : null}

                {mainGenerationProgress && !activeAppearanceId ? (
                  <DesignGenerationOverlay progress={mainGenerationProgress} />
                ) : null}

                {previewSrc && effectivePreviewId ? (
                  <button
                    type="button"
                    className={`character-validation-badge${
                      certifiedCurrent ? " is-ok" : " is-warn"
                    }`}
                    data-testid="character-validation-badge"
                    disabled={!canEdit || validationBusy || certifiedCurrent}
                    title={
                      certifiedCurrent
                        ? "当前图片已通过人物校验"
                        : "点击对该图片执行人物校验"
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      void runCurrentValidation();
                    }}
                  >
                    {validationBusy
                      ? `${validationLabel} · 校验中…`
                      : `${validationLabel}${
                          certifiedCurrent ? " · 已通过" : " · 未通过"
                        }`}
                  </button>
                ) : null}

                {previewSrc ? (
                  <div
                    className="character-primary-preview__actions"
                    data-testid="character-image-tools"
                  >
                    <button
                      ref={historyButtonRef}
                      type="button"
                      className={`character-history-trigger${
                        historyOpen ? " is-open" : ""
                      }`}
                      data-testid="character-history-trigger"
                      aria-label="历史图片"
                      title="历史图片"
                      aria-expanded={historyOpen}
                      disabled={historyMediaIds.length === 0 && !historyOpen}
                      onClick={(event) => {
                        event.stopPropagation();
                        setHistoryOpen((open) => !open);
                      }}
                    >
                      <History size={16} aria-hidden />
                      <span className="character-history-trigger__label">历史</span>
                      {historyMediaIds.length > 0 ? (
                        <span
                          className="character-history-trigger__badge"
                          data-testid="character-history-count"
                        >
                          {historyMediaIds.length > 99
                            ? "99+"
                            : historyMediaIds.length}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="character-download-trigger"
                      data-testid="character-download-trigger"
                      aria-label="下载当前图片"
                      title="下载当前图片"
                      onClick={(event) => {
                        event.stopPropagation();
                        downloadActiveImage();
                      }}
                    >
                      <Download size={16} aria-hidden />
                    </button>
                  </div>
                ) : null}

                {historyOpen ? (
                  <div
                    ref={historyPopoverRef}
                    className="character-history-popover"
                    data-testid="character-history-popover"
                    role="dialog"
                    aria-label={historyPopoverTitle}
                  >
                    <header className="character-history-popover__head">
                      {historyPopoverTitle}
                    </header>
                    <div className="character-history-popover__list">
                      {historyMediaIds.length === 0 ? (
                        <p className="amw-hint">暂无历史图片</p>
                      ) : (
                        historyMediaIds.map((id) => {
                          const previewing = id === effectivePreviewId;
                          const inUse = activeAppearanceId
                            ? id === activeAppearance?.currentMediaId
                            : id === primaryMediaId;
                          const certified = isCharacterMediaSd2Certified(
                            ensured,
                            id,
                          );
                          const canConfirm =
                            canEdit &&
                            !inUse &&
                            (Boolean(activeAppearanceId) ||
                              !isAppearanceMedia(ensured, id));
                          return (
                            <div
                              key={id}
                              className={`character-history-popover__item${
                                previewing ? " is-active" : ""
                              }${inUse ? " is-in-use" : ""}`}
                              data-in-use={inUse ? "1" : "0"}
                            >
                              <div className="character-history-popover__thumb-wrap">
                                <button
                                  type="button"
                                  className="character-history-popover__thumb"
                                  title={
                                    inUse
                                      ? activeAppearanceId
                                        ? "正在使用的造型图"
                                        : "正在使用的主形象"
                                      : "预览历史图片"
                                  }
                                  onClick={() => {
                                    handleHistoryItemPreview(id);
                                  }}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={getProjectAssetImageUrl(projectId, id, {
                                      revision: id,
                                      context,
                                    })}
                                    alt=""
                                  />
                                  {inUse ? (
                                    <span
                                      className="character-history-popover__in-use"
                                      data-testid={`character-history-in-use-${id}`}
                                    >
                                      正在使用
                                    </span>
                                  ) : null}
                                </button>
                                {canEdit && !inUse && !activeAppearanceId ? (
                                  <button
                                    type="button"
                                    className="character-history-popover__delete"
                                    data-testid={`character-history-delete-${id}`}
                                    aria-label="删除历史形象"
                                    disabled={historyBusy || historyDeleting}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setHistoryDeleteConfirm({ mediaId: id });
                                    }}
                                  >
                                    <X size={14} aria-hidden />
                                  </button>
                                ) : null}
                                {canEdit && !inUse ? (
                                  <button
                                    type="button"
                                    className="amw-btn character-history-confirm character-history-popover__confirm"
                                    data-testid={`character-history-confirm-${id}`}
                                    disabled={historyBusy || validationBusy || !canConfirm}
                                    title={
                                      !certified
                                        ? "先校验，通过后自动确认使用"
                                        : activeAppearanceId
                                          ? "将此图设为当前造型"
                                          : "将此图设为当前主形象"
                                    }
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleHistoryItemAction(id);
                                    }}
                                  >
                                    {!certified ? "先校验" : "确认使用"}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="character-looks" data-testid="character-looks">
                <div className="character-looks-board-wrap">
                  <div
                    className="character-looks-board"
                    data-testid="character-looks-grid"
                  >
                    <div
                      className={`character-look-card-slot character-look-card character-look-card--main character-look-card-slot--1${
                        !activeAppearanceId ? " is-active" : ""
                      }`}
                      data-testid="character-main-board-card"
                      data-kind="main"
                    >
                      <button
                        type="button"
                        className="character-look-card__media"
                        onClick={(event) => {
                          event.stopPropagation();
                          selectMainSlot();
                        }}
                      >
                        {mainBoardMediaId ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className="project-asset-media-drag-source"
                            src={getProjectAssetImageUrl(
                              projectId,
                              mainBoardMediaId,
                              { revision: mainBoardMediaId, context },
                            )}
                            alt=""
                            {...projectAssetMediaDragProps(mainBoardDragPayload)}
                          />
                        ) : (
                          <span className="character-look-card__empty">空</span>
                        )}
                        <span className="character-look-card__badge character-look-card__badge--main">
                          {mainBoardCertified ? "已认证" : "主形象"}
                        </span>
                      </button>
                      <span className="character-look-card__label character-look-card__label--main">
                        主形象
                      </span>
                    </div>

                    {lookBoardSlots.map((slotIndex) => {
                      const appearance = pagedAppearances[slotIndex];
                      const slotClass = `character-look-card-slot--${slotIndex + 2}`;
                      if (!appearance) {
                        return (
                          <div
                            key={`look-slot-empty-${safeLookPage}-${slotIndex}`}
                            className={`character-look-card-slot character-look-card character-look-card--empty ${slotClass}`}
                            aria-hidden
                          />
                        );
                      }
                      const mediaId = appearance.currentMediaId;
                      const isEditing = !mediaId;
                      const certified = mediaId
                        ? isCharacterMediaSd2Certified(ensured, mediaId)
                        : false;
                      return (
                        <div
                          key={appearance.id}
                          className={`character-look-card-slot character-look-card ${slotClass}${
                            activeAppearanceId === appearance.id
                              ? " is-active"
                              : ""
                          }${isEditing ? " character-look-card--editing" : ""}`}
                          data-testid={`character-look-card-${appearance.id}`}
                          data-kind="look"
                          data-certified={certified ? "1" : "0"}
                          data-editing={isEditing ? "1" : "0"}
                        >
                          {canEdit ? (
                            <button
                              type="button"
                              className="character-look-card__delete-icon"
                              data-testid={`character-look-delete-${appearance.id}`}
                              aria-label={`删除造型 ${appearance.name}`}
                              disabled={historyBusy || appearanceDeleting}
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeleteConfirmId(appearance.id);
                              }}
                            >
                              <X size={14} aria-hidden />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={`character-look-card__media${
                              isEditing ? " character-look-card__media--editing" : ""
                            }`}
                            onClick={(event) => {
                              event.stopPropagation();
                              selectLookAppearance(appearance);
                            }}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              openAppearanceLightbox(appearance);
                            }}
                          >
                            {isEditing ? (
                              <LibraryAssetEditingPlaceholder />
                            ) : mediaId ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                className="project-asset-media-drag-source"
                                src={getProjectAssetImageUrl(
                                  projectId,
                                  mediaId,
                                  { revision: mediaId, context },
                                )}
                                alt=""
                                {...projectAssetMediaDragProps(
                                  buildProjectAssetMediaDragPayload({
                                    projectId,
                                    context,
                                    mediaId,
                                    label: `${character.name} · ${appearance.name}`,
                                  }),
                                )}
                              />
                            ) : (
                              <span className="character-look-card__empty">空</span>
                            )}
                            <span className="character-look-card__badge">
                              {isEditing ? "编辑中" : certified ? "已认证" : "造型"}
                            </span>
                          </button>
                          {canEdit ? (
                            <input
                              className="character-look-card__name-input"
                              data-testid={`character-look-name-input-${appearance.id}`}
                              defaultValue={appearance.name}
                              key={`${appearance.id}:${appearance.name}`}
                              aria-label="造型名称"
                              onFocus={() =>
                                selectAppearanceForPrompt(appearance)
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                selectAppearanceForPrompt(appearance);
                              }}
                              onBlur={(event) => {
                                void renameAppearance(
                                  appearance.id,
                                  event.currentTarget.value,
                                  appearance.name,
                                );
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.currentTarget.blur();
                                }
                                if (event.key === "Escape") {
                                  event.currentTarget.value = appearance.name;
                                  event.currentTarget.blur();
                                }
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className="character-look-card__label character-look-card__label--readonly"
                              onClick={() =>
                                selectAppearanceForPrompt(appearance)
                              }
                            >
                              {appearance.name}
                            </button>
                          )}
                        </div>
                      );
                    })}

                    <div className="character-look-add-card">
                      <button
                        type="button"
                        className="character-look-card character-look-card--add"
                        data-testid="character-look-add"
                        disabled={!canEdit || historyBusy}
                        aria-label="新增人物造型"
                        title="新增人物造型"
                        onClick={() => runWithPromptGuard(openCreateLookEditor)}
                      >
                        <span className="character-look-card__media character-look-card__media--add">
                          <Plus size={22} aria-hidden />
                        </span>
                      </button>
                    </div>
                  </div>

                  {totalLookPages > 1 ? (
                    <div
                      className="character-looks-board__pager"
                      data-testid="character-looks-pager"
                    >
                      <button
                        type="button"
                        className="amw-btn character-looks-board__page-btn"
                        data-testid="character-looks-prev"
                        disabled={safeLookPage <= 0}
                        onClick={() =>
                          setLookPage((page) => Math.max(0, page - 1))
                        }
                      >
                        上一页
                      </button>
                      <span className="character-looks-board__page-label">
                        {safeLookPage + 1} / {totalLookPages}
                      </span>
                      <button
                        type="button"
                        className="amw-btn character-looks-board__page-btn"
                        data-testid="character-looks-next"
                        disabled={safeLookPage >= totalLookPages - 1}
                        onClick={() =>
                          setLookPage((page) =>
                            Math.min(totalLookPages - 1, page + 1),
                          )
                        }
                      >
                        下一页
                      </button>
                    </div>
                  ) : null}
                </div>

                {mergeAvailable && onRequestMerge ? (
                  <button
                    type="button"
                    className="amw-btn"
                    disabled={!canEdit}
                    data-testid="character-merge-open"
                    onClick={onRequestMerge}
                  >
                    合并同名造型
                  </button>
                ) : null}

                <input
                  ref={lookUploadInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  data-testid="character-look-upload-input"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    if (lookUploadMode === "active" && activeAppearanceId) {
                      void uploadToActiveLook(file);
                    } else {
                      void uploadAndAddLook(file);
                    }
                  }}
                />
                <input
                  ref={mainUploadInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  data-testid="character-main-upload-input"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void uploadMainMedia(file);
                  }}
                />
              </div>
            </div>

            <div className="character-prompt-split__right">
              <div className="character-prompt-split__prompt">
                <LibraryAssetPromptPanel
                  projectId={projectId}
                  context={context}
                  episodeId={designEpisodeId}
                  kind="character"
                  asset={character as LibraryPromptAsset}
                  designItem={designItem}
                  onItemChange={onDesignItemChange}
                  onCurrentMediaChange={syncPromptMedia}
                  hideMediaToolbar
                  hidePromptSectionLabel
                  promptContextLabel={promptContextLabel}
                  promptScopeKey={appearancePromptScopeKey}
                  promptScopeText={promptScopeText}
                  promptScopeMedia={
                    activeAppearance
                      ? {
                          currentId: activeAppearance.currentMediaId,
                          historyIds: activeAppearance.mediaHistory,
                        }
                      : null
                  }
                  onPromptScopePersist={
                    activeAppearanceId ? persistAppearancePrompt : undefined
                  }
                  onPromptDirtyChange={handlePromptDirtyChange}
                  promptFlushRef={promptFlushRef}
                  onStatus={onPreviewStatus}
                  onGenerationProgress={(_itemId, progress) => {
                    setMainGenerationProgress(progress);
                  }}
                />
              </div>

              <CharacterVoiceSettings
                projectId={projectId}
                canEdit={canEdit}
                characterId={character.id}
                voiceScope={scopedVoice.scope}
                visualContext={visualContext.appearanceId ?? "main"}
                contextLabel={
                  (character.name?.trim() || "未命名角色") +
                  " · " +
                  voiceObjectLabel
                }
                scopeLabel={voiceBadgeText}
                displayedVoiceId={displayedVoiceId}
                displayedVoiceName={displayedVoiceName}
                pendingVoice={pendingVoice}
                onPendingVoiceChange={setPendingVoice}
                voiceBoundCurrent={voiceBoundCurrent}
                voiceSelectionDirty={voiceSelectionDirty}
                projectVoices={projectVoices}
                audios={audios}
                onAudiosChange={onAudiosChange}
                onPersistAudios={onPersistAudios}
                onBind={() => void bindScopedVoice()}
                onStatus={onPreviewStatus}
              />

              {actionError && lookInUseSamples.length > 0 ? (
                <div
                  className="character-look-error character-look-error--portal"
                  data-testid="character-look-error"
                  role="alert"
                >
                  <ul data-testid="character-look-in-use-samples">
                    {lookInUseSamples.map((sample) => (
                      <li key={`${sample.episodeId}-${sample.shotId}`}>
                        第{sample.episodeNumber}集
                        {sample.sceneNumber != null
                          ? ` · 场景${sample.sceneNumber}`
                          : ""}
                        {sample.shotNumber != null
                          ? ` · 镜头${sample.shotNumber}`
                          : ""}
                        {sample.sceneTitle ? `（${sample.sceneTitle}）` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        }

      />

      {historyDeleteConfirm ? (
        <div
          className="character-look-delete-dialog"
          data-testid="character-history-delete-dialog"
          role="alertdialog"
          aria-modal="true"
        >
          <p>
            删除这张历史形象？
            <br />
            删除后无法恢复，当前正在使用的主形象不能删除。
          </p>
          <div className="character-look-delete-dialog__actions">
            <button
              type="button"
              className="amw-btn"
              disabled={historyDeleting}
              onClick={() => setHistoryDeleteConfirm(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="amw-btn amw-btn-primary"
              data-testid="character-history-delete-confirm"
              disabled={historyDeleting}
              onClick={() =>
                void deleteHistoryMedia(historyDeleteConfirm.mediaId)
              }
            >
              {historyDeleting ? "删除中…" : "确认删除"}
            </button>
          </div>
        </div>
      ) : null}

      {lookLightbox && typeof document !== "undefined"
        ? createPortal(
            <div
              className="character-look-lightbox"
              data-testid="character-look-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label="造型预览"
            >
              <div
                className="character-look-lightbox__left-cover"
                style={
                  lightboxLeftRect
                    ? {
                        top: lightboxLeftRect.top,
                        left: lightboxLeftRect.left,
                        width: lightboxLeftRect.width,
                        height: lightboxLeftRect.height,
                      }
                    : undefined
                }
              >
                <button
                  type="button"
                  className="character-look-lightbox__backdrop"
                  aria-label="关闭预览"
                  onClick={() => setLookLightbox(null)}
                />
                <div className="character-look-lightbox__stage">
              <div className="character-look-lightbox__panel">
                <button
                  type="button"
                  className={`character-look-lightbox__validate${
                    isCharacterMediaSd2Certified(ensured, lookLightbox.mediaId)
                      ? " is-ok"
                      : " is-warn"
                  }`}
                  data-testid="character-look-lightbox-validate"
                  disabled={
                    !canEdit ||
                    validationBusy ||
                    isCharacterMediaSd2Certified(ensured, lookLightbox.mediaId)
                  }
                  onClick={() => {
                    void (async () => {
                      if (
                        !canEdit ||
                        validationBusy ||
                        isCharacterMediaSd2Certified(
                          ensured,
                          lookLightbox.mediaId,
                        )
                      ) {
                        return;
                      }
                      setValidationBusy(true);
                      setActionError("");
                      try {
                        const precheck = await postLibrarySd2Precheck({
                          apiRoot,
                          assetId: character.id,
                          mediaId: lookLightbox.mediaId,
                        });
                        if (precheck.character) {
                          applyCharacter(precheck.character, {
                            appearanceId: null,
                            previewId: primaryMediaId,
                            bumpRevision: true,
                          });
                        }
                        if (!precheck.ok) {
                          throw new Error(precheck.error ?? "人物校验未通过");
                        }
                        onPreviewStatus?.("造型校验已通过。");
                      } catch (caught) {
                        setActionError(
                          caught instanceof Error
                            ? caught.message
                            : "造型校验失败",
                        );
                      } finally {
                        setValidationBusy(false);
                      }
                    })();
                  }}
                >
                  {isCharacterMediaSd2Certified(ensured, lookLightbox.mediaId)
                    ? "校验 · 已通过"
                    : validationBusy
                      ? "校验中…"
                      : "校验"}
                </button>
                <div className="character-look-lightbox__top-right">
                  <button
                    type="button"
                    className="character-look-lightbox__download"
                    data-testid="character-look-lightbox-download"
                    aria-label="下载造型图"
                    onClick={() => {
                      const url = getProjectAssetImageUrl(
                        projectId,
                        lookLightbox.mediaId,
                        { revision: lookLightbox.mediaId, context },
                      );
                      const anchor = document.createElement("a");
                      anchor.href = url;
                      anchor.download = `${character.name || "character"}-look-${lookLightbox.mediaId}.png`;
                      anchor.rel = "noopener";
                      document.body.appendChild(anchor);
                      anchor.click();
                      anchor.remove();
                    }}
                  >
                    <Download size={16} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="character-look-lightbox__close"
                    data-testid="character-look-lightbox-close"
                    aria-label="关闭预览"
                    title="关闭预览"
                    onClick={() => setLookLightbox(null)}
                  >
                    <X size={16} aria-hidden />
                  </button>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="character-look-lightbox__image"
                  src={getProjectAssetImageUrl(
                    projectId,
                    lookLightbox.mediaId,
                    {
                      revision: lookLightbox.mediaId,
                      context,
                    },
                  )}
                  alt="造型预览"
                />
                </div>
                {canEdit ? (
                  <div className="character-look-lightbox__actions"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}>
                    <label className="character-look-lightbox__name amw-field">
                      <span>造型名称</span>
                      <input
                        className="amw-input character-look-lightbox__name-input"
                        data-testid="character-look-lightbox-name"
                        value={lightboxNameDraft}
                        onChange={(event) =>
                          setLightboxNameDraft(event.target.value)
                        }
                        onBlur={() => {
                          if (!lookLightbox || !lightboxAppearance) return;
                          void renameAppearance(
                            lookLightbox.appearanceId,
                            lightboxNameDraft,
                            lightboxAppearance.name,
                          );
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }
                          if (event.key === "Escape" && lightboxAppearance) {
                            setLightboxNameDraft(lightboxAppearance.name);
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    </label>
                    <div className="character-look-lightbox__voice">
                      <div className="character-look-lightbox__voice-selector">
                        <VoiceSelector
                          label="造型音色"
                          labelHidden
                          value={lightboxDisplayedVoiceId}
                          disabled={!canEdit}
                          projectId={projectId}
                          canEdit={canEdit}
                          projectVoices={projectVoices}
                          audios={audios}
                          onAudiosChange={onAudiosChange}
                          onPersistAudios={onPersistAudios}
                          onVoiceHardDeleted={onVoiceHardDeleted}
                          onStatus={onPreviewStatus}
                          onChange={(voice) => {
                            if (!voice) {
                              setLightboxPendingVoice(null);
                              return;
                            }
                            if (voice.id === lightboxScopedVoice?.voiceId) {
                              setLightboxPendingVoice(null);
                              return;
                            }
                            setLightboxPendingVoice(voice);
                          }}
                        />
                      </div>
                      <VoicePreviewButton
                        projectId={projectId}
                        voiceId={lightboxDisplayedVoiceId}
                        audios={audios}
                        disabled={!lightboxDisplayedVoiceId}
                        onStatus={onPreviewStatus}
                        toggle
                      />
                      <button
                        type="button"
                        className={`amw-btn character-look-lightbox__bind-voice${
                          lightboxVoiceBound ? " is-bound" : " amw-btn-primary"
                        }`}
                        data-testid="character-look-lightbox-bind-voice"
                        disabled={
                          !canEdit ||
                          !lightboxDisplayedVoiceId ||
                          lightboxVoiceBound
                        }
                        title={
                          lightboxVoiceBound
                            ? "当前造型音色已绑定"
                            : "为该造型单独绑定音色（不影响主形象）"
                        }
                        onClick={() => void bindLookLightboxVoice()}
                      >
                        {lightboxVoiceBound ? "已绑定音色" : "绑定音色"}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="amw-btn amw-btn-primary character-look-lightbox__promote"
                      data-testid="character-look-lightbox-promote"
                      disabled={
                        historyBusy ||
                        lookLightbox.mediaId === primaryMediaId ||
                        !isCharacterMediaSd2Certified(
                          ensured,
                          lookLightbox.mediaId,
                        )
                      }
                      onClick={() => {
                        void runMediaAction("promote-look-to-main", {
                          mediaId: lookLightbox.mediaId,
                        }).then((result) => {
                          if (!result?.character) return;
                          applyCharacter(result.character, {
                            appearanceId: null,
                            previewId: lookLightbox.mediaId,
                          });
                          setLookLightbox(null);
                          onPreviewStatus?.("已设为主形象。");
                        });
                      }}
                    >
                      设为主图
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            </div>,
            document.body,
          )
        : null}

      {primaryDeleteConfirm ? (
        <div
          className="character-look-delete-dialog"
          data-testid="character-primary-delete-dialog"
          role="alertdialog"
          aria-modal="true"
        >
          <p>
            删除主形象将清空主图与人物默认音色，造型图片与造型音色覆盖不受影响。删除后需重新绑定音色。
          </p>
          <div className="character-look-delete-dialog__actions">
            <button
              type="button"
              className="amw-btn"
              onClick={() => setPrimaryDeleteConfirm(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="amw-btn amw-btn-primary"
              data-testid="character-primary-delete-confirm"
              disabled={historyBusy}
              onClick={() => void clearPrimaryMedia()}
            >
              确认删除
            </button>
          </div>
        </div>
      ) : null}

      {deleteConfirmId ? (
        <div
          className="character-look-delete-dialog"
          data-testid="character-look-delete-dialog"
          role="alertdialog"
          aria-modal="true"
        >
          <p>删除该造型将移除其当前图、历史、校验与音色覆盖，且不影响主形象。</p>
          <div className="character-look-delete-dialog__actions">
            <button
              type="button"
              className="amw-btn"
              onClick={() => setDeleteConfirmId(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="amw-btn amw-btn-primary"
              data-testid="character-look-delete-confirm"
              disabled={appearanceDeleting}
              onClick={() => void deleteAppearance(deleteConfirmId)}
            >
              {appearanceDeleting ? "删除中…" : "确认删除"}
            </button>
          </div>
        </div>
      ) : null}

      <UnsavedPromptDialog
        open={pendingScopeAction != null}
        busy={scopeUnsavedBusy}
        onSave={() => {
          setScopeUnsavedBusy(true);
          void (async () => {
            try {
              await promptFlushRef?.current?.();
              pendingScopeAction?.();
              setPendingScopeAction(null);
              setPromptDirty(false);
            } finally {
              setScopeUnsavedBusy(false);
            }
          })();
        }}
        onDiscard={() => {
          pendingScopeAction?.();
          setPendingScopeAction(null);
          setPromptDirty(false);
        }}
        onCancel={() => setPendingScopeAction(null)}
      />
    </>
  );
}
