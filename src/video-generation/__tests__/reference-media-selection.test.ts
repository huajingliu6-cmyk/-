import { describe, expect, it } from "vitest";
import { migrateWorkflowDocument } from "@/workflow/migrate";
import { createNodeByType } from "@/workflow/create-node";
import { buildVideoGenerationInput } from "@/workflow/lib/build-video-generation-input";
import { getWan27R2VCapability } from "@/video-generation/model-capabilities";
import {
  buildInputSummary,
  selectWanGenerationMode,
} from "@/video-generation/select-wan-mode";
import {
  buildPromptWithMediaRefs,
  buildWan27Request,
  orderResolvedMedia,
} from "@/video-generation/build-wan27-request";
import { validateGenerationSettings } from "@/video-generation/validate-settings";
import {
  collectReferenceMediaCandidates,
  resolveFirstFrame,
  resolveReferenceMediaSelection,
} from "@/video-generation/reference-media";
import type {
  AssetRecord,
  CharacterNode,
  ImageNode,
  SceneNode,
  VideoShotNode,
  WorkflowDocument,
  WorkflowEdge,
} from "@/workflow/types";
import type {
  ResolvedProviderMedia,
  VideoGenerationInput,
} from "@/video-generation/types";

const capability = getWan27R2VCapability("wan2.7-r2v-2026-06-12");

function asset(
  id: string,
  patch: Partial<AssetRecord> = {},
): AssetRecord {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id,
    projectId: "demo",
    assetType: "referenceImage",
    name: id,
    originalFileName: `${id}.png`,
    mimeType: "image/png",
    sizeBytes: 100,
    url: `/api/assets/${id}`,
    thumbnailUrl: `/api/assets/${id}`,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function edge(
  id: string,
  source: string,
  target: string,
): WorkflowEdge {
  return {
    id,
    source,
    target,
    sourceHandle: "out",
    targetHandle: "in",
  };
}

function emptyDoc(
  nodes: WorkflowDocument["nodes"],
  edges: WorkflowEdge[],
  assets: AssetRecord[],
): WorkflowDocument {
  return {
    version: 4,
    projectId: "demo",
    revision: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges,
    assets,
    shotOrder: nodes.filter((n) => n.type === "videoShot").map((n) => n.id),
  };
}

describe("migrate reference selection (v4)", () => {
  it("migrates missing selection fields to auto + []", () => {
    const raw = {
      version: 3,
      projectId: "demo",
      revision: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: "shot-1",
          type: "videoShot",
          position: { x: 0, y: 0 },
          data: {
            title: "shot 1",
            shotNumber: 1,
            generationInstruction: "hi",
            duration: 5,
            shotSize: "medium",
            cameraAngle: "eyeLevel",
            cameraMovement: "static",
            actionDescription: "",
            colorTone: "",
            focalLength: "50mm",
            aspectRatio: "9:16",
            resolution: "720P",
            provider: "mock",
            model: "mock",
            continuityMode: "standalone",
            sourceVideoAssetId: "",
            startFrameAssetId: "",
            endFrameAssetId: "",
            status: "idle",
            progress: 0,
            errorMessage: "",
            resultAssetId: "",
          },
        },
      ],
      edges: [],
      assets: [],
      shotOrder: ["shot-1"],
    };
    const doc = migrateWorkflowDocument(raw);
    expect(doc.version).toBe(4);
    const shot = doc.nodes[0] as VideoShotNode;
    expect(shot.data.referenceSelectionMode).toBe("auto");
    expect(shot.data.selectedReferenceAssetIds).toEqual([]);
  });

  it("keeps non-empty selected ids and migrates to manual", () => {
    const raw = {
      version: 3,
      projectId: "demo",
      revision: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: "shot-1",
          type: "videoShot",
          position: { x: 0, y: 0 },
          data: {
            title: "shot 1",
            shotNumber: 1,
            generationInstruction: "hi",
            duration: 5,
            shotSize: "medium",
            cameraAngle: "eyeLevel",
            cameraMovement: "static",
            actionDescription: "",
            colorTone: "",
            focalLength: "50mm",
            aspectRatio: "9:16",
            resolution: "720P",
            provider: "mock",
            model: "mock",
            continuityMode: "standalone",
            sourceVideoAssetId: "",
            startFrameAssetId: "",
            endFrameAssetId: "",
            status: "idle",
            progress: 0,
            errorMessage: "",
            resultAssetId: "",
            selectedReferenceAssetIds: ["b", "a", "c"],
          },
        },
      ],
      edges: [],
      assets: [],
      shotOrder: ["shot-1"],
    };
    const doc = migrateWorkflowDocument(raw);
    const shot = doc.nodes[0] as VideoShotNode;
    expect(shot.data.referenceSelectionMode).toBe("manual");
    expect(shot.data.selectedReferenceAssetIds).toEqual(["b", "a", "c"]);
  });

  it("migrates empty selected array without mode to auto", () => {
    const raw = {
      version: 3,
      projectId: "demo",
      revision: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: "shot-1",
          type: "videoShot",
          position: { x: 0, y: 0 },
          data: {
            title: "shot 1",
            shotNumber: 1,
            generationInstruction: "hi",
            duration: 5,
            shotSize: "medium",
            cameraAngle: "eyeLevel",
            cameraMovement: "static",
            actionDescription: "",
            colorTone: "",
            focalLength: "50mm",
            aspectRatio: "9:16",
            resolution: "720P",
            provider: "mock",
            model: "mock",
            continuityMode: "standalone",
            sourceVideoAssetId: "",
            startFrameAssetId: "",
            endFrameAssetId: "",
            status: "idle",
            progress: 0,
            errorMessage: "",
            resultAssetId: "",
            selectedReferenceAssetIds: [],
          },
        },
      ],
      edges: [],
      assets: [],
      shotOrder: ["shot-1"],
    };
    const doc = migrateWorkflowDocument(raw);
    const shot = doc.nodes[0] as VideoShotNode;
    expect(shot.data.referenceSelectionMode).toBe("auto");
    expect(shot.data.selectedReferenceAssetIds).toEqual([]);
  });

  it("round-trips mode and selected order through migrate", () => {
    const shot = createNodeByType("videoShot", { x: 0, y: 0 }, 1) as VideoShotNode;
    shot.data.referenceSelectionMode = "manual";
    shot.data.selectedReferenceAssetIds = ["x", "y", "z"];
    const doc = emptyDoc([shot], [], []);
    const again = migrateWorkflowDocument(doc);
    const next = again.nodes[0] as VideoShotNode;
    expect(again.version).toBe(4);
    expect(next.data.referenceSelectionMode).toBe("manual");
    expect(next.data.selectedReferenceAssetIds).toEqual(["x", "y", "z"]);
  });

  it("does not truncate or reorder selected ids on migrate", () => {
    const ids = ["1", "2", "3", "4", "5", "6", "7"];
    const shot = createNodeByType("videoShot", { x: 0, y: 0 }, 1) as VideoShotNode;
    shot.data.referenceSelectionMode = "manual";
    shot.data.selectedReferenceAssetIds = ids;
    const again = migrateWorkflowDocument(emptyDoc([shot], [], []));
    expect(
      (again.nodes[0] as VideoShotNode).data.selectedReferenceAssetIds,
    ).toEqual(ids);
  });
});

describe("collectReferenceMediaCandidates", () => {
  it("only collects connected nodes and skips disconnected", () => {
    const shot = createNodeByType("videoShot", { x: 0, y: 0 }, 1) as VideoShotNode;
    const char = createNodeByType("character", { x: 0, y: 0 }) as CharacterNode;
    const char2 = createNodeByType("character", { x: 0, y: 0 }) as CharacterNode;
    const a1 = asset("a1");
    const a2 = asset("a2");
    char.data.variants[0]!.primaryAssetId = "a1";
    char.data.variants[0]!.referenceAssetIds = ["a1"];
    char2.data.variants[0]!.primaryAssetId = "a2";
    const doc = emptyDoc(
      [shot, char, char2],
      [edge("e1", char.id, shot.id)],
      [a1, a2],
    );
    const candidates = collectReferenceMediaCandidates({
      document: doc,
      videoShotNodeId: shot.id,
      capability,
    });
    expect(candidates.map((c) => c.assetId)).toEqual(["a1"]);
  });

  it("includes multiple character reference images from current variant", () => {
    const shot = createNodeByType("videoShot", { x: 0, y: 0 }, 1) as VideoShotNode;
    const char = createNodeByType("character", { x: 0, y: 0 }) as CharacterNode;
    char.data.variants[0]!.primaryAssetId = "c1";
    char.data.variants[0]!.referenceAssetIds = ["c1", "c2", "c3"];
    char.data.variants[0]!.references = [
      { assetId: "c2", poseTag: "front", label: "front" },
      { assetId: "c3", poseTag: "side", label: "side" },
    ];
    const doc = emptyDoc(
      [shot, char],
      [edge("e1", char.id, shot.id)],
      [asset("c1"), asset("c2"), asset("c3")],
    );
    const candidates = collectReferenceMediaCandidates({
      document: doc,
      videoShotNodeId: shot.id,
      capability,
    });
    expect(candidates.map((c) => c.assetId)).toEqual(["c1", "c2", "c3"]);
  });

  it("includes scene primary and viewpoints; skips startFrame images", () => {
    const shot = createNodeByType("videoShot", { x: 0, y: 0 }, 1) as VideoShotNode;
    const scene = createNodeByType("scene", { x: 0, y: 0 }) as SceneNode;
    scene.data.primaryAssetId = "s1";
    scene.data.viewpoints = [
      { id: "v1", tag: "front", label: "front", assetId: "s2" },
    ];
    const img = createNodeByType("image", { x: 0, y: 0 }) as ImageNode;
    img.data.referenceType = "startFrame";
    img.data.primaryAssetId = "sf1";
    img.data.assetIds = ["sf1"];
    const img2 = createNodeByType("image", { x: 0, y: 0 }) as ImageNode;
    img2.data.referenceType = "style";
    img2.data.primaryAssetId = "g1";
    img2.data.assetIds = ["g1"];
    const doc = emptyDoc(
      [shot, scene, img, img2],
      [
        edge("e1", scene.id, shot.id),
        edge("e2", img.id, shot.id),
        edge("e3", img2.id, shot.id),
      ],
      [asset("s1"), asset("s2"), asset("sf1"), asset("g1")],
    );
    const candidates = collectReferenceMediaCandidates({
      document: doc,
      videoShotNodeId: shot.id,
      capability,
    });
    expect(candidates.map((c) => c.assetId)).toEqual(["s1", "s2", "g1"]);
  });

  it("dedupes same assetId to one slot and marks blob/missing/bad mime", () => {
    const shot = createNodeByType("videoShot", { x: 0, y: 0 }, 1) as VideoShotNode;
    const img = createNodeByType("image", { x: 0, y: 0 }) as ImageNode;
    img.data.assetIds = ["dup", "dup", "missing", "blob1", "bad"];
    img.data.primaryAssetId = "dup";
    const prop = createNodeByType("prop", { x: 0, y: 0 });
    if (prop.type === "prop") {
      prop.data.primaryAssetId = "dup";
      prop.data.assetIds = ["dup"];
    }
    const doc = emptyDoc(
      [shot, img, prop],
      [edge("e1", img.id, shot.id), edge("e2", prop.id, shot.id)],
      [
        asset("dup"),
        asset("blob1", { url: "blob:http://local/1" }),
        asset("bad", { mimeType: "image/gif" }),
      ],
    );
    const candidates = collectReferenceMediaCandidates({
      document: doc,
      videoShotNodeId: shot.id,
      capability,
    });
    expect(candidates.filter((c) => c.assetId === "dup")).toHaveLength(1);
    expect(candidates.find((c) => c.assetId === "missing")?.eligible).toBe(
      false,
    );
    expect(candidates.find((c) => c.assetId === "blob1")?.eligible).toBe(
      false,
    );
    expect(candidates.find((c) => c.assetId === "bad")?.eligible).toBe(false);
  });

  it("adds sourceVideoAssetId when supported", () => {
    const shot = createNodeByType("videoShot", { x: 0, y: 0 }, 1) as VideoShotNode;
    shot.data.sourceVideoAssetId = "vid1";
    const doc = emptyDoc(
      [shot],
      [],
      [
        asset("vid1", {
          assetType: "generatedVideo",
          mimeType: "video/mp4",
          originalFileName: "v.mp4",
        }),
      ],
    );
    const candidates = collectReferenceMediaCandidates({
      document: doc,
      videoShotNodeId: shot.id,
      capability,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.mediaKind).toBe("video");
    expect(candidates[0]?.eligible).toBe(true);
  });

  it("includes assets mentioned in generationInstruction without edges", () => {
    const shot = createNodeByType("videoShot", { x: 0, y: 0 }, 1) as VideoShotNode;
    shot.data.generationInstruction =
      "用 @[主角](asset:m1) 和 @[背景](asset:m2) 生成镜头";
    const doc = emptyDoc(
      [shot],
      [],
      [asset("m1"), asset("m2"), asset("m3")],
    );
    const candidates = collectReferenceMediaCandidates({
      document: doc,
      videoShotNodeId: shot.id,
      capability,
    });
    expect(candidates.map((c) => c.assetId).sort()).toEqual(["m1", "m2"]);
    expect(candidates.every((c) => c.eligible)).toBe(true);
  });
});

describe("resolveReferenceMediaSelection", () => {
  function makeCandidates(n: number, eligible = true) {
    return Array.from({ length: n }, (_, i) => ({
      assetId: `id-${i}`,
      mediaKind: "image" as const,
      referenceKind: "general" as const,
      sourceNodeId: `n-${i}`,
      sourceNodeType: "image",
      sourceNodeTitle: `n-${i}`,
      label: `L${i}`,
      fileName: `${i}.png`,
      mimeType: "image/png",
      url: `/api/assets/id-${i}`,
      eligible,
      disabledReason: eligible ? undefined : "unavailable",
    }));
  }

  it("auto: 0/3/5 eligible within limit", () => {
    expect(
      resolveReferenceMediaSelection({
        candidates: [],
        selectionMode: "auto",
        selectedReferenceAssetIds: ["x"],
        capability,
      }).selected,
    ).toEqual([]);

    const three = makeCandidates(3);
    const r3 = resolveReferenceMediaSelection({
      candidates: three,
      selectionMode: "auto",
      selectedReferenceAssetIds: [],
      capability,
    });
    expect(r3.selected.map((c) => c.assetId)).toEqual([
      "id-0",
      "id-1",
      "id-2",
    ]);
    expect(r3.requiresManualSelection).toBe(false);

    const five = makeCandidates(5);
    const r5 = resolveReferenceMediaSelection({
      candidates: five,
      selectionMode: "auto",
      selectedReferenceAssetIds: [],
      capability,
    });
    expect(r5.selected).toHaveLength(5);
  });

  it("auto: 6 eligible requires manual and does not take first 5", () => {
    const six = makeCandidates(6);
    const r = resolveReferenceMediaSelection({
      candidates: six,
      selectionMode: "auto",
      selectedReferenceAssetIds: [],
      capability,
    });
    expect(r.requiresManualSelection).toBe(true);
    expect(r.selected).toEqual([]);
    expect(r.validationErrors[0]?.code).toBe("REFERENCE_SELECTION_REQUIRED");
    expect(r.validationErrors[0]?.message).toContain("6");
    expect(r.validationErrors[0]?.message).toContain("5");
  });

  it("manual: select 5 of 6 succeeds with order; empty is not auto", () => {
    const six = makeCandidates(6);
    const ids = ["id-5", "id-1", "id-0", "id-2", "id-4"];
    const r = resolveReferenceMediaSelection({
      candidates: six,
      selectionMode: "manual",
      selectedReferenceAssetIds: ids,
      capability,
    });
    expect(r.selected.map((c) => c.assetId)).toEqual(ids);
    expect(r.excluded.map((c) => c.assetId)).toContain("id-3");

    const empty = resolveReferenceMediaSelection({
      candidates: six,
      selectionMode: "manual",
      selectedReferenceAssetIds: [],
      capability,
    });
    expect(empty.selected).toEqual([]);
    expect(empty.requiresManualSelection).toBe(false);
    expect(empty.validationErrors).toEqual([]);
  });

  it("manual: rejects over limit, duplicates, out-of-pool, unavailable", () => {
    const six = makeCandidates(6);
    expect(
      resolveReferenceMediaSelection({
        candidates: six,
        selectionMode: "manual",
        selectedReferenceAssetIds: six.map((c) => c.assetId),
        capability,
      }).validationErrors.some((e) => e.code === "REFERENCE_MEDIA_LIMIT_EXCEEDED"),
    ).toBe(true);

    expect(
      resolveReferenceMediaSelection({
        candidates: six,
        selectionMode: "manual",
        selectedReferenceAssetIds: ["id-0", "id-0"],
        capability,
      }).duplicateSelectedIds,
    ).toEqual(["id-0"]);

    expect(
      resolveReferenceMediaSelection({
        candidates: six,
        selectionMode: "manual",
        selectedReferenceAssetIds: ["ghost"],
        capability,
      }).invalidSelectedIds,
    ).toEqual(["ghost"]);

    const mixed = makeCandidates(2);
    mixed[1]!.eligible = false;
    expect(
      resolveReferenceMediaSelection({
        candidates: mixed,
        selectionMode: "manual",
        selectedReferenceAssetIds: ["id-1"],
        capability,
      }).validationErrors.some(
        (e) => e.code === "REFERENCE_MEDIA_NOT_AVAILABLE",
      ),
    ).toBe(true);
  });

  it("manual: does not mutate input arrays", () => {
    const candidates = makeCandidates(3);
    const selected = ["id-2", "id-0"];
    const freezeC = candidates.map((c) => ({ ...c }));
    const freezeS = [...selected];
    resolveReferenceMediaSelection({
      candidates,
      selectionMode: "manual",
      selectedReferenceAssetIds: selected,
      capability,
    });
    expect(candidates).toEqual(freezeC);
    expect(selected).toEqual(freezeS);
  });

  it("reads limit from capability", () => {
    const caps = { maxReferenceMedia: 2 };
    const r = resolveReferenceMediaSelection({
      candidates: makeCandidates(3),
      selectionMode: "auto",
      selectedReferenceAssetIds: [],
      capability: caps,
    });
    expect(r.limit).toBe(2);
    expect(r.requiresManualSelection).toBe(true);
  });
});

describe("first frame independent of maxReferenceMedia", () => {
  it("resolves one first frame and rejects multiples", () => {
    const shot = createNodeByType("videoShot", { x: 0, y: 0 }, 1) as VideoShotNode;
    shot.data.startFrameAssetId = "ff1";
    const img = createNodeByType("image", { x: 0, y: 0 }) as ImageNode;
    img.data.referenceType = "startFrame";
    img.data.primaryAssetId = "ff2";
    img.data.assetIds = ["ff2"];
    const doc = emptyDoc(
      [shot, img],
      [edge("e1", img.id, shot.id)],
      [asset("ff1"), asset("ff2")],
    );
    const multi = resolveFirstFrame({
      document: doc,
      videoShotNodeId: shot.id,
      capability,
    });
    expect(multi.ok).toBe(false);

    const singleDoc = emptyDoc([shot], [], [asset("ff1")]);
    const single = resolveFirstFrame({
      document: singleDoc,
      videoShotNodeId: shot.id,
      capability,
    });
    expect(single.ok).toBe(true);
    if (single.ok) {
      expect(single.firstFrame?.assetId).toBe("ff1");
    }
  });

  it("rejects first frame id inside selectedReferenceAssetIds", () => {
    const candidates = [
      {
        assetId: "a1",
        mediaKind: "image" as const,
        referenceKind: "general" as const,
        sourceNodeId: "n1",
        sourceNodeType: "image",
        sourceNodeTitle: "n1",
        label: "A",
        fileName: "a.png",
        mimeType: "image/png",
        url: "/api/assets/a1",
        eligible: true,
      },
    ];
    const r = resolveReferenceMediaSelection({
      candidates,
      selectionMode: "manual",
      selectedReferenceAssetIds: ["ff1"],
      capability,
      firstFrameAssetId: "ff1",
    });
    expect(
      r.validationErrors.some((e) => e.code === "INVALID_REFERENCE_SELECTION"),
    ).toBe(true);
  });
});

describe("buildVideoGenerationInput + summary + provider order", () => {
  it("manual 5 of 6 passes summary validation; auto 6 fails", () => {
    const shot = createNodeByType("videoShot", { x: 0, y: 0 }, 1) as VideoShotNode;
    shot.data.generationInstruction = "shot prompt";
    const assets = Array.from({ length: 6 }, (_, i) => asset(`img-${i}`));
    const images = assets.map((a, i) => {
      const node = createNodeByType("image", { x: i, y: 0 }) as ImageNode;
      node.data.primaryAssetId = a.id;
      node.data.assetIds = [a.id];
      node.data.referenceType = "general";
      return node;
    });
    const edges = images.map((n, i) => edge(`e-${i}`, n.id, shot.id));
    const doc = emptyDoc([shot, ...images], edges, assets);

    shot.data.referenceSelectionMode = "auto";
    const autoBuilt = buildVideoGenerationInput(doc, shot.id, { capability });
    expect(autoBuilt.ok).toBe(false);
    if (!autoBuilt.ok) {
      expect(autoBuilt.requiresManualSelection).toBe(true);
    }

    shot.data.referenceSelectionMode = "manual";
    shot.data.selectedReferenceAssetIds = [
      "img-5",
      "img-0",
      "img-1",
      "img-2",
      "img-3",
    ];
    const manualBuilt = buildVideoGenerationInput(doc, shot.id, { capability });
    expect(manualBuilt.ok).toBe(true);
    if (manualBuilt.ok) {
      expect(manualBuilt.input.orderedReferenceMedia.map((m) => m.assetId)).toEqual(
        shot.data.selectedReferenceAssetIds,
      );
      const summary = buildInputSummary(manualBuilt.input);
      expect(summary.referenceImageCount).toBe(5);
      const errors = validateGenerationSettings({
        capability,
        settings: {
          resolution: manualBuilt.input.resolution,
          aspectRatio: manualBuilt.input.aspectRatio,
          durationSeconds: manualBuilt.input.durationSeconds,
          watermark: false,
          promptExtend: true,
        },
        inputSummary: summary,
      });
      expect(errors.filter((e) => e.code === "TOO_MANY_REFERENCE_MEDIA")).toEqual(
        [],
      );
      expect(selectWanGenerationMode(manualBuilt.input)).toBe(
        "referenceToVideo",
      );
      expect(manualBuilt.input.aspectRatio).not.toBeNull();
    }
  });

  it("first frame sets aspectRatio null and does not count toward media limit", () => {
    const shot = createNodeByType("videoShot", { x: 0, y: 0 }, 1) as VideoShotNode;
    shot.data.generationInstruction = "with first frame";
    shot.data.startFrameAssetId = "ff1";
    shot.data.referenceSelectionMode = "manual";
    shot.data.selectedReferenceAssetIds = ["img-0"];
    const img = createNodeByType("image", { x: 0, y: 0 }) as ImageNode;
    img.data.primaryAssetId = "img-0";
    img.data.assetIds = ["img-0"];
    const doc = emptyDoc(
      [shot, img],
      [edge("e1", img.id, shot.id)],
      [asset("ff1"), asset("img-0")],
    );
    const built = buildVideoGenerationInput(doc, shot.id, { capability });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.input.aspectRatio).toBeNull();
      expect(built.input.firstFrame?.assetId).toBe("ff1");
      expect(built.input.orderedReferenceMedia).toHaveLength(1);
      const summary = buildInputSummary(built.input);
      expect(summary.referenceImageCount + summary.referenceVideoCount).toBe(1);
      expect(summary.firstFrameCount).toBe(1);
    }
  });

  it("rejects stale client selection snapshot", () => {
    const shot = createNodeByType("videoShot", { x: 0, y: 0 }, 1) as VideoShotNode;
    shot.data.generationInstruction = "x";
    shot.data.referenceSelectionMode = "manual";
    shot.data.selectedReferenceAssetIds = ["img-0"];
    const img = createNodeByType("image", { x: 0, y: 0 }) as ImageNode;
    img.data.primaryAssetId = "img-0";
    img.data.assetIds = ["img-0"];
    const doc = emptyDoc(
      [shot, img],
      [edge("e1", img.id, shot.id)],
      [asset("img-0")],
    );
    const built = buildVideoGenerationInput(doc, shot.id, {
      capability,
      clientSelectedReferenceAssetIds: ["img-0", "ghost"],
    });
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.structuredErrors[0]?.code).toBe("STALE_REFERENCE_SELECTION");
    }
  });

  it("keeps mixed image/video selected order in wan payload and prompt numbers", () => {
    const ordered: VideoGenerationInput["orderedReferenceMedia"] = [
      {
        assetId: "imgA",
        kind: "image",
        label: "imgA",
        mimeType: "image/png",
        sourceUrl: "https://example.com/a.png",
      },
      {
        assetId: "vidB",
        kind: "reference_video",
        label: "vidB",
        mimeType: "video/mp4",
        sourceUrl: "https://example.com/b.mp4",
      },
      {
        assetId: "imgC",
        kind: "image",
        label: "imgC",
        mimeType: "image/png",
        sourceUrl: "https://example.com/c.png",
      },
    ];
    const input: VideoGenerationInput = {
      shotId: "shot-1",
      projectId: "demo",
      prompt: "mixed order",
      resolution: "720P",
      aspectRatio: "16:9",
      durationSeconds: 5,
      watermark: false,
      promptExtend: true,
      characterReferences: [],
      sceneReferences: [],
      imageReferences: ordered.filter((m) => m.kind === "image"),
      referenceVideos: ordered.filter((m) => m.kind === "reference_video"),
      orderedReferenceMedia: ordered,
      textInputs: [],
      referenceSelectionMode: "manual",
      selectedReferenceAssetIds: ["imgA", "vidB", "imgC"],
    };
    const resolved: ResolvedProviderMedia[] = [
      {
        type: "reference_image",
        url: "https://example.com/a.png",
        assetId: "imgA",
        label: "imgA",
      },
      {
        type: "reference_video",
        url: "https://example.com/b.mp4",
        assetId: "vidB",
        label: "vidB",
      },
      {
        type: "reference_image",
        url: "https://example.com/c.png",
        assetId: "imgC",
        label: "imgC",
      },
    ];
    const orderedMedia = orderResolvedMedia(resolved);
    expect(orderedMedia.map((m) => m.assetId)).toEqual([
      "imgA",
      "vidB",
      "imgC",
    ]);
    const prompt = buildPromptWithMediaRefs(input, orderedMedia);
    expect(prompt).toContain("\u56fe1\uff08imgA\uff09");
    expect(prompt).toContain("\u56fe2\uff08imgC\uff09");
    expect(prompt).toContain("\u89c6\u98911\uff08vidB\uff09");
    const body = buildWan27Request(input, capability, resolved);
    expect(body.input.media?.map((m) => m.url)).toEqual([
      "https://example.com/a.png",
      "https://example.com/b.mp4",
      "https://example.com/c.png",
    ]);
  });

  it("rejects build without capability instead of using fallback limit 5", () => {
    const shot = createNodeByType("videoShot", { x: 0, y: 0 }, 1) as VideoShotNode;
    shot.data.generationInstruction = "prompt";
    const doc = emptyDoc([shot], [], []);
    const built = buildVideoGenerationInput(doc, shot.id);
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.structuredErrors[0]?.code).toBe(
        "MODEL_CAPABILITY_NOT_LOADED",
      );
      expect(built.errors[0]).toBe(
        "\u6a21\u578b\u80fd\u529b\u5c1a\u672a\u52a0\u8f7d",
      );
    }
  });

  it("does not use slice(0, maxReferenceMedia) in selection path", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      assetId: `id-${i}`,
      mediaKind: "image" as const,
      referenceKind: "general" as const,
      sourceNodeId: `n-${i}`,
      sourceNodeType: "image",
      sourceNodeTitle: `n-${i}`,
      label: `L${i}`,
      fileName: `${i}.png`,
      mimeType: "image/png",
      url: `/api/assets/id-${i}`,
      eligible: true,
    }));
    const r = resolveReferenceMediaSelection({
      candidates: six,
      selectionMode: "auto",
      selectedReferenceAssetIds: [],
      capability,
    });
    expect(r.selected).toHaveLength(0);
  });
});
