import { describe, expect, it } from "vitest";
import { createDefaultWorkflow } from "@/workflow/default-workflow";
import {
  canRedoDocumentHistory,
  canUndoDocumentHistory,
  createEmptyDocumentHistory,
  pushDocumentHistory,
  redoDocumentHistory,
  undoDocumentHistory,
} from "@/workflow/lib/document-history";

describe("document-history", () => {
  it("push / undo / redo round-trip", () => {
    let history = createEmptyDocumentHistory();
    const a = createDefaultWorkflow("p1");
    const b = { ...a, shotOrder: ["shot-after"] };

    history = pushDocumentHistory(history, a);
    expect(canUndoDocumentHistory(history)).toBe(true);
    expect(canRedoDocumentHistory(history)).toBe(false);

    const undone = undoDocumentHistory(history, b);
    expect(undone).not.toBeNull();
    expect(undone!.document.shotOrder).toEqual(a.shotOrder);
    history = undone!.history;
    expect(canRedoDocumentHistory(history)).toBe(true);

    const redone = redoDocumentHistory(history, undone!.document);
    expect(redone).not.toBeNull();
    expect(redone!.document.shotOrder).toEqual(["shot-after"]);
  });

  it("push clears future", () => {
    let history = createEmptyDocumentHistory();
    const a = createDefaultWorkflow("p1");
    const b = { ...a, shotOrder: ["b"] };
    const c = { ...a, shotOrder: ["c"] };
    history = pushDocumentHistory(history, a);
    const undone = undoDocumentHistory(history, b)!;
    history = undone.history;
    history = pushDocumentHistory(history, undone.document);
    expect(canRedoDocumentHistory(history)).toBe(false);
    const again = undoDocumentHistory(history, c)!;
    expect(again.document.shotOrder).toEqual(a.shotOrder);
  });

  it("respects stack limit", () => {
    let history = createEmptyDocumentHistory();
    let current = createDefaultWorkflow("p1");
    for (let i = 0; i < 55; i += 1) {
      history = pushDocumentHistory(history, current, 50);
      current = { ...current, shotOrder: [`n-${i}`] };
    }
    expect(history.past.length).toBe(50);
  });

  it("undo/redo return null at boundaries", () => {
    const history = createEmptyDocumentHistory();
    const doc = createDefaultWorkflow("p1");
    expect(undoDocumentHistory(history, doc)).toBeNull();
    expect(redoDocumentHistory(history, doc)).toBeNull();
  });
});
