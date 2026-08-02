import type { WorkflowDocument } from "@/workflow/types";

export const DOCUMENT_HISTORY_LIMIT = 50;

export type DocumentHistoryState = {
  past: WorkflowDocument[];
  future: WorkflowDocument[];
};

export function createEmptyDocumentHistory(): DocumentHistoryState {
  return { past: [], future: [] };
}

export function cloneWorkflowDocument(
  doc: WorkflowDocument,
): WorkflowDocument {
  return structuredClone(doc);
}

export function pushDocumentHistory(
  history: DocumentHistoryState,
  previous: WorkflowDocument,
  limit = DOCUMENT_HISTORY_LIMIT,
): DocumentHistoryState {
  const past = [...history.past, cloneWorkflowDocument(previous)];
  while (past.length > limit) {
    past.shift();
  }
  return { past, future: [] };
}

export function undoDocumentHistory(
  history: DocumentHistoryState,
  current: WorkflowDocument,
): {
  history: DocumentHistoryState;
  document: WorkflowDocument;
} | null {
  if (history.past.length === 0) return null;
  const previous = history.past[history.past.length - 1]!;
  return {
    document: previous,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, cloneWorkflowDocument(current)],
    },
  };
}

export function redoDocumentHistory(
  history: DocumentHistoryState,
  current: WorkflowDocument,
): {
  history: DocumentHistoryState;
  document: WorkflowDocument;
} | null {
  if (history.future.length === 0) return null;
  const next = history.future[history.future.length - 1]!;
  return {
    document: next,
    history: {
      past: [...history.past, cloneWorkflowDocument(current)],
      future: history.future.slice(0, -1),
    },
  };
}

export function canUndoDocumentHistory(history: DocumentHistoryState): boolean {
  return history.past.length > 0;
}

export function canRedoDocumentHistory(history: DocumentHistoryState): boolean {
  return history.future.length > 0;
}
