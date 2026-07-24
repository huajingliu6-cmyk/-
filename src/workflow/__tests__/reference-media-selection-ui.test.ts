import { describe, expect, it } from "vitest";
import {
  canMoveDraftSelection,
  createReferenceMediaSelectionDraft,
  moveDraftSelection,
  removeInvalidDraftIds,
  switchDraftToManual,
  toggleDraftSelection,
} from "@/workflow/lib/reference-media-selection-draft";
import {
  buildReferenceMediaSelectionView,
  canSaveReferenceMediaDraft,
} from "@/workflow/lib/reference-media-selection-view";
import { resolveReferenceMediaSelection } from "@/video-generation/reference-media";
import type { ReferenceMediaCandidate } from "@/video-generation/reference-media";
import { getWan27R2VCapability } from "@/video-generation/model-capabilities";
import { createNodeByType } from "@/workflow/create-node";
import { useWorkflowStore } from "@/workflow/store";
import type { VideoShotNode } from "@/workflow/types";

const capability = getWan27R2VCapability("wan2.7-r2v-test");

function makeCandidates(n: number, eligible = true): ReferenceMediaCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    assetId: `id-${i}`,
    mediaKind: "image" as const,
    referenceKind: i % 2 === 0 ? "character" : "general",
    sourceNodeId: `n-${i}`,
    sourceNodeType: "image",
    sourceNodeTitle: `n-${i}`,
    label: `L${i}`,
    fileName: `${i}.png`,
    mimeType: "image/png",
    url: `/api/assets/id-${i}`,
    eligible,
    disabledReason: eligible ? undefined : "bad",
  }));
}

describe("reference media selection view + draft (3C-B)", () => {
  it("capability missing => canGenerate false", () => {
    const view = buildReferenceMediaSelectionView({
      candidates: makeCandidates(2),
      resolvedSelection: null,
      firstFrame: { ok: true, firstFrame: null },
      capability: null,
      currentMode: "auto",
    });
    expect(view.capabilityLoaded).toBe(false);
    expect(view.canGenerate).toBe(false);
    expect(view.summaryMessage).toContain("尚未加载");
  });

  it("auto 3/limit shows full auto select; auto over limit requires manual and no first-N selection", () => {
    const three = makeCandidates(3);
    const r3 = resolveReferenceMediaSelection({
      candidates: three,
      selectionMode: "auto",
      selectedReferenceAssetIds: [],
      capability,
    });
    const v3 = buildReferenceMediaSelectionView({
      candidates: three,
      resolvedSelection: r3,
      firstFrame: { ok: true, firstFrame: null },
      capability,
      currentMode: "auto",
    });
    expect(v3.selectedCount).toBe(3);
    expect(v3.canGenerate).toBe(true);
    expect(v3.summaryMessage).toContain("全部 3");

    const six = makeCandidates(6);
    const r6 = resolveReferenceMediaSelection({
      candidates: six,
      selectionMode: "auto",
      selectedReferenceAssetIds: [],
      capability,
    });
    const v6 = buildReferenceMediaSelectionView({
      candidates: six,
      resolvedSelection: r6,
      firstFrame: { ok: true, firstFrame: null },
      capability,
      currentMode: "auto",
    });
    expect(v6.requiresManualSelection).toBe(true);
    expect(v6.selectedOrdered).toEqual([]);
    expect(v6.canGenerate).toBe(false);
  });

  it("switch to manual over limit starts empty; within limit can seed", () => {
    const over = switchDraftToManual({
      draft: createReferenceMediaSelectionDraft({
        mode: "auto",
        selectedReferenceAssetIds: [],
      }),
      autoSelectedIds: ["a", "b", "c", "d", "e"],
      eligibleCount: 6,
      limit: capability.maxReferenceMedia,
    });
    expect(over.draftMode).toBe("manual");
    expect(over.draftSelectedIds).toEqual([]);

    const ok = switchDraftToManual({
      draft: createReferenceMediaSelectionDraft({
        mode: "auto",
        selectedReferenceAssetIds: [],
      }),
      autoSelectedIds: ["a", "b"],
      eligibleCount: 2,
      limit: capability.maxReferenceMedia,
    });
    expect(ok.draftSelectedIds).toEqual(["a", "b"]);
  });

  it("manual toggle respects limit; empty stays empty", () => {
    let draft = createReferenceMediaSelectionDraft({
      mode: "manual",
      selectedReferenceAssetIds: [],
    });
    expect(draft.draftSelectedIds).toEqual([]);
    const limit = capability.maxReferenceMedia;
    for (let i = 0; i < limit; i += 1) {
      draft = toggleDraftSelection({
        draft,
        assetId: `id-${i}`,
        eligible: true,
        limit,
      });
    }
    expect(draft.draftSelectedIds).toHaveLength(limit);
    const blocked = toggleDraftSelection({
      draft,
      assetId: "extra",
      eligible: true,
      limit,
    });
    expect(blocked.draftSelectedIds).toHaveLength(limit);
    expect(blocked.draftSelectedIds.includes("extra")).toBe(false);
  });

  it("cannot toggle ineligible; move up/down bounds", () => {
    let draft = createReferenceMediaSelectionDraft({
      mode: "manual",
      selectedReferenceAssetIds: ["a", "b", "c"],
    });
    const noIneligible = toggleDraftSelection({
      draft,
      assetId: "x",
      eligible: false,
      limit: capability.maxReferenceMedia,
    });
    expect(noIneligible.draftSelectedIds).toEqual(["a", "b", "c"]);

    expect(canMoveDraftSelection(draft, "a", "up")).toBe(false);
    expect(canMoveDraftSelection(draft, "c", "down")).toBe(false);
    draft = moveDraftSelection({ draft, assetId: "b", direction: "up" });
    expect(draft.draftSelectedIds).toEqual(["b", "a", "c"]);
    draft = moveDraftSelection({ draft, assetId: "a", direction: "down" });
    expect(draft.draftSelectedIds).toEqual(["b", "c", "a"]);
  });

  it("remove invalid ids; cancel draft does not mutate original", () => {
    const original = ["bad", "ok"];
    const draft = createReferenceMediaSelectionDraft({
      mode: "manual",
      selectedReferenceAssetIds: original,
    });
    const cleaned = removeInvalidDraftIds({
      draft,
      invalidIds: ["bad"],
    });
    expect(cleaned.draftSelectedIds).toEqual(["ok"]);
    expect(original).toEqual(["bad", "ok"]);
  });

  it("canSaveReferenceMediaDraft blocks over-limit and capability missing", () => {
    expect(
      canSaveReferenceMediaDraft({
        capabilityLoaded: false,
        mode: "manual",
        eligibleCount: 1,
        limit: null,
        draftSelectedIds: ["a"],
        invalidDraftIds: [],
        resolvedErrors: [],
        requiresManualSelection: false,
      }),
    ).toBe(false);

    const limit = capability.maxReferenceMedia;
    const within = Array.from({ length: limit }, (_, i) => String(i + 1));
    const over = [...within, String(limit + 1)];

    expect(
      canSaveReferenceMediaDraft({
        capabilityLoaded: true,
        mode: "manual",
        eligibleCount: limit + 1,
        limit,
        draftSelectedIds: over,
        invalidDraftIds: [],
        resolvedErrors: [],
        requiresManualSelection: false,
      }),
    ).toBe(false);

    expect(
      canSaveReferenceMediaDraft({
        capabilityLoaded: true,
        mode: "manual",
        eligibleCount: limit + 1,
        limit,
        draftSelectedIds: within,
        invalidDraftIds: [],
        resolvedErrors: [],
        requiresManualSelection: false,
      }),
    ).toBe(true);

    expect(
      canSaveReferenceMediaDraft({
        capabilityLoaded: true,
        mode: "auto",
        eligibleCount: limit + 1,
        limit,
        draftSelectedIds: [],
        invalidDraftIds: [],
        resolvedErrors: [],
        requiresManualSelection: true,
      }),
    ).toBe(false);
  });

  it("first frame excluded from selectedCount in view", () => {
    const candidates = makeCandidates(2);
    const resolved = resolveReferenceMediaSelection({
      candidates,
      selectionMode: "manual",
      selectedReferenceAssetIds: ["id-0"],
      capability,
    });
    const view = buildReferenceMediaSelectionView({
      candidates,
      resolvedSelection: resolved,
      firstFrame: {
        ok: true,
        firstFrame: {
          assetId: "ff",
          mediaKind: "image",
          referenceKind: "general",
          sourceNodeId: "shot",
          sourceNodeType: "videoShot",
          sourceNodeTitle: "shot",
          label: "首帧",
          fileName: "ff.png",
          mimeType: "image/png",
          eligible: true,
        },
      },
      capability,
      currentMode: "manual",
    });
    expect(view.selectedCount).toBe(1);
    expect(view.firstFrame?.assetId).toBe("ff");
    expect(view.nodeSummaryLabel).toContain("首帧已连接");
  });

  it("setReferenceMediaSelection writes mode and ids in one update", () => {
    const shot = createNodeByType("videoShot", { x: 0, y: 0 }, 1) as VideoShotNode;
    useWorkflowStore.getState().setDocument({
      version: 4,
      projectId: "demo",
      revision: 0,
      updatedAt: new Date().toISOString(),
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [shot],
      edges: [],
      assets: [],
      shotOrder: [shot.id],
    });
    const before = useWorkflowStore.getState().contentEpoch;
    useWorkflowStore
      .getState()
      .setReferenceMediaSelection(shot.id, "manual", ["b", "a"]);
    const node = useWorkflowStore
      .getState()
      .document.nodes.find((n) => n.id === shot.id);
    expect(node?.type).toBe("videoShot");
    if (node?.type === "videoShot") {
      expect(node.data.referenceSelectionMode).toBe("manual");
      expect(node.data.selectedReferenceAssetIds).toEqual(["b", "a"]);
    }
    expect(useWorkflowStore.getState().contentEpoch).toBe(before + 1);
  });
});
