import { mkdtemp, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const documents = vi.hoisted(
  () => new Map<string, { revision: number; value: unknown }>(),
);
const state = vi.hoisted(() => ({ conflictsRemaining: 0 }));

vi.mock('@/persistence/remote-data-client', () => ({
  isRemoteDataOnly: () => true,
  requestRemoteData: vi.fn(async (requestPath: string, init: RequestInit = {}) => {
    const url = new URL(requestPath, 'http://go-backend.internal');
    const projectId = url.searchParams.get('projectId') ?? '';
    const identity = 'asset-approvals/' + projectId;
    if ((init.method ?? 'GET') === 'POST') {
      const body = JSON.parse(String(init.body)) as { value: Record<string, unknown> };
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const snapshot = structuredClone(documents.get(identity));
        if (state.conflictsRemaining > 0) {
          state.conflictsRemaining -= 1;
          await Promise.resolve();
          continue;
        }
        if (documents.get(identity)?.revision !== snapshot?.revision) continue;
        const value = {
          ...body.value,
          updatedAt: new Date().toISOString(),
          ...('approvals' === 'approvals' ? { version: 1 } : {}),
        };
        const revision = (snapshot?.revision ?? 0) + 1;
        documents.set(identity, { revision, value: structuredClone(value) });
        return Response.json({ value, revision });
      }
      return Response.json({ error: 'project asset data write conflict' }, { status: 409 });
    }
    const document = documents.get(identity);
    return Response.json({
      value: structuredClone(document?.value ?? null),
      revision: document?.revision ?? 0,
    });
  }),
}));
import {
  emptyApprovalsFile,
  loadAssetApprovalsFile,
  saveAssetApprovalsFile,
} from '@/projects/assets/approvals/store';
import type { AssetApprovalSubmission } from '@/projects/assets/approvals/types';

function submission(projectId: string, id: string): AssetApprovalSubmission {
  return {
    id,
    projectId,
    episodeId: 'episode_1',
    submittedByUserId: 'user_1',
    approverUserId: 'owner_1',
    status: 'pending',
    items: [
      {
        id: `${id}_item_1`,
        submissionId: id,
        category: 'character',
        assetDesignItemId: 'design_1',
        assetNameSnapshot: '林清',
        generatedMediaId: 'gen_1',
        generatedAtSnapshot: '2026-08-01T00:00:00.000Z',
        storageKey: 'gen_1',
        promptSnapshot: null,
        status: 'pending',
        approvedByUserId: null,
        approvedAt: null,
        rejectedByUserId: null,
        rejectedAt: null,
        promotedAssetId: null,
      },
    ],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    submittedAt: '2026-08-01T00:00:00.000Z',
    completedAt: null,
    revision: 1,
    idempotencyKey: null,
  };
}

describe('remote asset approvals store', () => {
  beforeEach(() => {
    documents.clear();
    state.conflictsRemaining = 0;
  });

  it('persists approval documents without local files', async () => {
    const isolatedRoot = await mkdtemp(path.join(tmpdir(), 'approvals-remote-'));
    process.env.APP_DATA_DIR = isolatedRoot;
    process.env.DATA_ROOT = isolatedRoot;
    const file = emptyApprovalsFile();
    file.revision = 1;
    file.submissions.push(submission('project_1', 'submission_1'));

    await saveAssetApprovalsFile('project_1', file);
    const loaded = await loadAssetApprovalsFile('project_1');
    expect(loaded.submissions[0]?.id).toBe('submission_1');
    expect(await readdir(isolatedRoot)).toEqual([]);
  });

  it('isolates approval documents by project', async () => {
    await saveAssetApprovalsFile('project_1', {
      ...emptyApprovalsFile(),
      submissions: [submission('project_1', 'submission_1')],
    });
    await saveAssetApprovalsFile('project_2', {
      ...emptyApprovalsFile(),
      submissions: [submission('project_2', 'submission_2')],
    });
    expect((await loadAssetApprovalsFile('project_1')).submissions[0]?.id).toBe(
      'submission_1',
    );
    expect((await loadAssetApprovalsFile('project_2')).submissions[0]?.id).toBe(
      'submission_2',
    );
  });

  it('returns an empty file for a missing remote document', async () => {
    expect((await loadAssetApprovalsFile('missing')).submissions).toEqual([]);
  });

  it('retries remote document conflicts', async () => {
    state.conflictsRemaining = 2;
    await saveAssetApprovalsFile('project_1', {
      ...emptyApprovalsFile(),
      submissions: [submission('project_1', 'submission_1')],
    });
    expect(documents.get('asset-approvals/project_1')?.revision).toBe(1);
  });
});
