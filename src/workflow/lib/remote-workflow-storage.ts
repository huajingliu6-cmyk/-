import "server-only";

import { requestRemoteData } from "@/persistence/remote-data-client";
import type { WorkflowDocument } from "@/workflow/types";

const ENDPOINT = "/v1/workflows";
const REMOTE_REVISION = Symbol("workflow-remote-revision");

type WorkflowWithRemoteRevision = WorkflowDocument & {
  [REMOTE_REVISION]?: number;
};

export function attachWorkflowRemoteRevision(
  workflow: WorkflowDocument,
  revision: number,
): WorkflowDocument {
  Object.defineProperty(workflow, REMOTE_REVISION, {
    value: revision,
    configurable: true,
    enumerable: true,
    writable: true,
  });
  return workflow;
}

export function carryWorkflowRemoteRevision(
  source: WorkflowDocument,
  target: WorkflowDocument,
): WorkflowDocument {
  const revision = (source as WorkflowWithRemoteRevision)[REMOTE_REVISION];
  return typeof revision === "number"
    ? attachWorkflowRemoteRevision(target, revision)
    : target;
}

export function workflowRemoteRevision(
  workflow: WorkflowDocument,
): number | null {
  const revision = (workflow as WorkflowWithRemoteRevision)[REMOTE_REVISION];
  return typeof revision === "number" ? revision : null;
}

async function workflowRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await requestRemoteData(path, init);
  if (response.status === 409) throw new Error("REVISION_CONFLICT");
  if (!response.ok) throw new Error(`REMOTE_WORKFLOW_REQUEST_FAILED:${response.status}`);
  return (await response.json()) as T;
}

export async function loadRemoteWorkflowDocument(projectId: string) {
  const result = await workflowRequest<{ workflow: unknown | null; revision: number }>(
    `${ENDPOINT}?projectId=${encodeURIComponent(projectId)}`,
  );
  return result.workflow === null
    ? null
    : { value: result.workflow, revision: result.revision };
}

export async function listRemoteWorkflowDocuments(): Promise<
  Array<{ projectId: string; value: unknown; revision: number }>
> {
  const result = await workflowRequest<{
    documents: Array<{ projectId: string; value: unknown; revision: number }>;
  }>(ENDPOINT);
  return result.documents;
}

export async function saveRemoteWorkflowDocument(
  workflow: WorkflowDocument,
): Promise<WorkflowDocument> {
  const expectedRevision = workflowRemoteRevision(workflow) ?? workflow.revision - 1;
  const result = await workflowRequest<{ workflow: WorkflowDocument; revision: number }>(
    `${ENDPOINT}?projectId=${encodeURIComponent(workflow.projectId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision, workflow }),
    },
  );
  return attachWorkflowRemoteRevision(result.workflow, result.revision);
}