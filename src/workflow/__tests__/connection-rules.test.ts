import { describe, expect, it } from "vitest";
import {
  dedupeWorkflowEdges,
  normalizeConnectionHandles,
  validateAllEdges,
  validateConnection,
} from "@/workflow/connection-rules";
import type { WorkflowEdge, WorkflowNode } from "@/workflow/types";

function node(
  id: string,
  type: WorkflowNode["type"],
  title = id,
): WorkflowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { title },
  } as WorkflowNode;
}

describe("connection-rules reference edges", () => {
  it("allows multiple character → videoShot references", () => {
    const nodes = [
      node("c1", "character", "角色1"),
      node("c2", "character", "角色2"),
      node("c3", "character", "角色3"),
      node("vs", "videoShot", "镜头"),
    ];
    const edges: WorkflowEdge[] = [
      {
        id: "e1",
        source: "c1",
        target: "vs",
        sourceHandle: "out",
        targetHandle: "in",
      },
      {
        id: "e2",
        source: "c2",
        target: "vs",
        sourceHandle: "out",
        targetHandle: "in",
      },
      {
        id: "e3",
        source: "c3",
        target: "vs",
        sourceHandle: "out",
        targetHandle: "in",
      },
    ];
    expect(validateAllEdges(nodes, edges)).toEqual({ ok: true });
  });

  it("rejects videoShot → character (wrong reference direction)", () => {
    const result = validateConnection(
      {
        sourceNodeId: "vs",
        targetNodeId: "c1",
        sourceHandle: "out",
        targetHandle: "in",
        sourceType: "videoShot",
        targetType: "character",
      },
      [],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("不要从镜头连出到素材");
    }
  });

  it("dedupes empty-handle and out/in as the same edge", () => {
    const deduped = dedupeWorkflowEdges([
      {
        id: "a",
        source: "c1",
        target: "vs",
        sourceHandle: "",
        targetHandle: "",
      },
      {
        id: "b",
        source: "c1",
        target: "vs",
        sourceHandle: "out",
        targetHandle: "in",
      },
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.sourceHandle).toBe("out");
    expect(deduped[0]?.targetHandle).toBe("in");
  });

  it("normalizeConnectionHandles fills missing handles", () => {
    expect(
      normalizeConnectionHandles({
        sourceHandle: null,
        targetHandle: undefined,
      }),
    ).toEqual({ sourceHandle: "out", targetHandle: "in" });
  });

  it("detects cycle with reverse edge and shows readable reason", () => {
    const nodes = [
      node("c1", "character", "男主"),
      node("vs", "videoShot", "镜头1"),
    ];
    const edges: WorkflowEdge[] = [
      {
        id: "fwd",
        source: "c1",
        target: "vs",
        sourceHandle: "out",
        targetHandle: "in",
      },
      {
        id: "rev",
        source: "vs",
        target: "c1",
        sourceHandle: "out",
        targetHandle: "in",
      },
    ];
    const result = validateAllEdges(nodes, edges);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("循环");
      expect(result.message).toContain("男主");
    }
  });
});
