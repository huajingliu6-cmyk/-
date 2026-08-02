import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/generated-videos/[fileName]/route";

describe("generated videos legacy route", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-generated-route-"));
    process.env.APP_DATA_DIR = isolatedRoot;
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("does not expose local generated files in remote mode", async () => {
    const generatedDir = path.join(isolatedRoot, "generated-videos");
    const fileName = "legacy.mp4";
    const filePath = path.join(generatedDir, fileName);
    mkdirSync(generatedDir, { recursive: true });
    writeFileSync(filePath, Buffer.from("local-only-video"));
    process.env.REMOTE_DATA_ONLY = "true";

    const response = await GET(new Request("http://localhost") as never, {
      params: Promise.resolve({ fileName }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "文件不存在" });
  });

  it("keeps the isolated legacy file response in local mode", async () => {
    const generatedDir = path.join(isolatedRoot, "generated-videos");
    const fileName = "legacy.mp4";
    const body = Buffer.from("isolated-local-video");
    mkdirSync(generatedDir, { recursive: true });
    writeFileSync(path.join(generatedDir, fileName), body);

    const response = await GET(new Request("http://localhost") as never, {
      params: Promise.resolve({ fileName }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
  });
});
