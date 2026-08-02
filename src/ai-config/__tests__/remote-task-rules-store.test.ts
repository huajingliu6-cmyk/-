import { createHash } from "crypto";
import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TaskRuleDraft,
  TaskRulePublishedVersion,
  TaskRuleRecord,
} from "@/ai-config/task-rules-store";

const records = vi.hoisted(() => new Map<string, TaskRuleRecord>());

function emptyRecord(capabilityId: string): TaskRuleRecord {
  return {
    capabilityId: capabilityId as TaskRuleRecord["capabilityId"],
    draft: null,
    publishedVersion: null,
    versions: [],
  };
}

function hash(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  requestRemoteData: vi.fn(async (requestPath: string, init: RequestInit = {}) => {
    const url = new URL(requestPath, "http://go-backend.internal");
    const parts = url.pathname.split("/").filter(Boolean);
    const capabilityId = parts[2] ? decodeURIComponent(parts[2]) : null;
    const action = parts[3] ?? null;
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : {};

    if (!capabilityId && method === "GET") {
      return json({
        schemaVersion: 1,
        rules: Object.fromEntries(
          [...records.entries()].map(([key, value]) => [
            key,
            structuredClone(value),
          ]),
        ),
      });
    }

    if (!capabilityId) return json({ error: "not found" }, 404);
    const current = structuredClone(
      records.get(capabilityId) ?? emptyRecord(capabilityId),
    );

    if (!action && method === "GET") return json({ record: current });

    if (action === "draft" && method === "PUT") {
      const currentRevision = current.draft?.revision ?? 0;
      if (
        body.expectedRevision !== null &&
        body.expectedRevision !== undefined &&
        body.expectedRevision !== currentRevision
      ) {
        return json(
          {
            code: "AI_TASK_RULE_REVISION_CONFLICT",
            error: "draft revision conflict",
          },
          409,
        );
      }
      const draft: TaskRuleDraft = {
        content: body.content,
        sourceType: body.sourceType,
        sourceFileName: body.sourceFileName,
        revision: currentRevision + 1,
        updatedBy: body.userId,
        updatedAt: new Date().toISOString(),
      };
      await Promise.resolve();
      const latestRevision = records.get(capabilityId)?.draft?.revision ?? 0;
      if (latestRevision !== currentRevision) {
        return json(
          {
            code: "AI_TASK_RULE_REVISION_CONFLICT",
            error: "task rule was updated by another request",
          },
          409,
        );
      }
      current.draft = draft;
      records.set(capabilityId, current);
      return json({ revision: draft.revision });
    }

    if (action === "draft" && method === "DELETE") {
      current.draft = null;
      records.set(capabilityId, current);
      return json({ ok: true });
    }

    if (action === "publish" && method === "POST") {
      const published = current.versions.find(
        (version) => version.version === current.publishedVersion,
      );
      if (
        body.idempotencyKey &&
        current.lastPublishIdempotencyKey === body.idempotencyKey &&
        published
      ) {
        return json({
          version: published!.version,
          contentHash: published!.contentHash,
        });
      }
      if (!current.draft?.content.trim()) {
        return json(
          { code: "AI_TASK_RULE_CONFIG_INVALID", error: "no draft" },
          400,
        );
      }
      if (
        body.expectedRevision !== null &&
        body.expectedRevision !== undefined &&
        body.expectedRevision !== current.draft.revision
      ) {
        return json(
          {
            code: "AI_TASK_RULE_REVISION_CONFLICT",
            error: "draft revision conflict",
          },
          409,
        );
      }
      await Promise.resolve();
      if (
        JSON.stringify(records.get(capabilityId)) !== JSON.stringify(current)
      ) {
        return json(
          {
            code: "AI_TASK_RULE_REVISION_CONFLICT",
            error: "task rule was updated by another request",
          },
          409,
        );
      }
      const version = Math.max(0, ...current.versions.map((item) => item.version)) + 1;
      const entry: TaskRulePublishedVersion = {
        version,
        content: current.draft.content,
        contentHash: hash(current.draft.content),
        sourceType: current.draft.sourceType,
        sourceFileName: current.draft.sourceFileName,
        publishedBy: body.userId,
        publishedAt: new Date().toISOString(),
        rolledBackFromVersion: null,
      };
      current.versions.push(entry);
      current.publishedVersion = version;
      current.draft = null;
      current.lastPublishIdempotencyKey = body.idempotencyKey || null;
      records.set(capabilityId, current);
      return json({ version, contentHash: entry.contentHash });
    }

    if (action === "rollback" && method === "POST") {
      const published = current.versions.find(
        (version) => version.version === current.publishedVersion,
      );
      if (
        body.idempotencyKey &&
        current.lastRollbackIdempotencyKey === body.idempotencyKey &&
        published?.rolledBackFromVersion === body.toVersion
      ) {
        return json({
          version: published!.version,
          contentHash: published!.contentHash,
        });
      }
      const target = current.versions.find(
        (version) => version.version === body.toVersion,
      );
      if (!target) {
        return json(
          { code: "AI_TASK_RULE_CONFIG_INVALID", error: "target missing" },
          400,
        );
      }
      const version = Math.max(...current.versions.map((item) => item.version)) + 1;
      const entry: TaskRulePublishedVersion = {
        version,
        content: target.content,
        contentHash: hash(target.content),
        sourceType: "rollback",
        sourceFileName: target.sourceFileName,
        publishedBy: body.userId,
        publishedAt: new Date().toISOString(),
        rolledBackFromVersion: body.toVersion,
      };
      current.versions.push(entry);
      current.publishedVersion = version;
      current.lastRollbackIdempotencyKey = body.idempotencyKey || null;
      records.set(capabilityId, current);
      return json({ version, contentHash: entry.contentHash });
    }

    if (action === "use-builtin" && method === "POST") {
      const version = Math.max(0, ...current.versions.map((item) => item.version)) + 1;
      current.versions.push({
        version,
        content: "",
        contentHash: hash(""),
        sourceType: "use-builtin",
        sourceFileName: null,
        publishedBy: body.userId,
        publishedAt: new Date().toISOString(),
        rolledBackFromVersion: null,
      });
      current.publishedVersion = null;
      current.draft = null;
      records.set(capabilityId, current);
      return json({ ok: true });
    }

    return json({ error: "not found" }, 404);
  }),
}));

import {
  getEffectivePublishedRule,
  getRuleRecord,
  listVersions,
  publishRule,
  revertCapabilityToBuiltin,
  rollbackRule,
  saveDraft,
} from "@/ai-config/task-rules-store";

describe("remote task rules store", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-task-rules-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    records.clear();
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("persists a published rule remotely without local files", async () => {
    await saveDraft("story.generate", "Create a concise story outline with consistent motivations.", "manual", null, null, "admin");
    expect(await getEffectivePublishedRule("story.generate")).toMatchObject({ source: "builtin", version: null });
    const published = await publishRule("story.generate", 1, "publish-1", "admin");
    expect(await publishRule("story.generate", null, "publish-1", "admin")).toEqual(published);
    expect(records.get("story.generate")).toMatchObject({ publishedVersion: 1, draft: null });
    expect(await getEffectivePublishedRule("story.generate")).toMatchObject({ source: "custom", version: 1 });
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("rejects concurrent stale remote draft writes", async () => {
    const results = await Promise.allSettled([
      saveDraft("story.generate", "First remote draft content.", "manual", null, null, "a"),
      saveDraft("story.generate", "Second remote draft content.", "manual", null, null, "b"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await getRuleRecord("story.generate")).draft?.revision).toBe(1);
  });

  it("isolates concurrent writes for different capabilities", async () => {
    const results = await Promise.all([
      saveDraft("story.generate", "Create a complete story with a clear dramatic arc.", "manual", null, null, "a"),
      saveDraft("script.outline.generate", "Create a structured outline without changing the source story.", "manual", null, null, "b"),
    ]);
    expect(results).toEqual([{ revision: 1 }, { revision: 1 }]);
    expect(records.has("story.generate")).toBe(true);
    expect(records.has("script.outline.generate")).toBe(true);
  });

  it("does not replay a concurrent publish over the winning version", async () => {
    await saveDraft("story.generate", "Publish one safe remote rule with deterministic behavior.", "manual", null, null, "admin");
    const results = await Promise.allSettled([
      publishRule("story.generate", 1, "publish-a", "a"),
      publishRule("story.generate", 1, "publish-b", "b"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "AI_TASK_RULE_REVISION_CONFLICT" } });
    expect(await listVersions("story.generate")).toHaveLength(1);
  });

  it("preserves publish, rollback, and use-builtin version history", async () => {
    await saveDraft("story.generate", "First published remote task rule with stable output requirements.", "manual", null, null, "admin");
    await publishRule("story.generate", 1, "publish-1", "admin");
    await saveDraft("story.generate", "Second published remote task rule with stricter output requirements.", "markdown", "rule.md", null, "admin");
    await publishRule("story.generate", 1, "publish-2", "admin");
    await rollbackRule("story.generate", 1, "rollback-1", "admin");
    await revertCapabilityToBuiltin("story.generate", "admin");
    const record = await getRuleRecord("story.generate");
    expect(record.publishedVersion).toBeNull();
    expect(record.draft).toBeNull();
    expect(record.versions.map((version) => version.version)).toEqual([1, 2, 3, 4]);
    expect(record.versions[2]).toMatchObject({ sourceType: "rollback", rolledBackFromVersion: 1, content: record.versions[0]?.content, contentHash: record.versions[0]?.contentHash });
    expect(record.versions[3]).toMatchObject({ sourceType: "use-builtin", content: "" });
    expect((await getEffectivePublishedRule("story.generate")).source).toBe("builtin");
  });

  it("returns builtin defaults without writes", async () => {
    expect((await getRuleRecord("story.generate")).draft).toBeNull();
    expect((await getEffectivePublishedRule("story.generate")).source).toBe("builtin");
    expect(records.size).toBe(0);
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });
});
