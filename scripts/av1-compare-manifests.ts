import { promises as fs } from "fs";
import path from "path";

type Manifest = {
  fileCount: number;
  jsonCount: number;
  binaryCount: number;
  totalSize: number;
  files: Array<{ path: string; size: number; sha256: string }>;
};

async function load(p: string): Promise<Manifest> {
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, "")) as Manifest;
}

async function main() {
  const dir = process.argv[2];
  const aName = process.argv[3];
  const bName = process.argv[4];
  if (!dir || !aName || !bName) {
    throw new Error("Usage: av1-compare-manifests.ts <dir> <pre.json> <post.json>");
  }
  const a = await load(path.join(dir, aName));
  const b = await load(path.join(dir, bName));
  const map = new Map(a.files.map((f) => [f.path, f]));
  const diffs: Array<{ type: string; path: string }> = [];
  for (const f of b.files) {
    const prev = map.get(f.path);
    if (!prev) diffs.push({ type: "added", path: f.path });
    else if (prev.sha256 !== f.sha256 || prev.size !== f.size) {
      diffs.push({ type: "changed", path: f.path });
    }
    map.delete(f.path);
  }
  for (const p of map.keys()) diffs.push({ type: "removed", path: p });
  const summary = {
    pre: {
      fileCount: a.fileCount,
      jsonCount: a.jsonCount,
      binaryCount: a.binaryCount,
      totalSize: a.totalSize,
    },
    post: {
      fileCount: b.fileCount,
      jsonCount: b.jsonCount,
      binaryCount: b.binaryCount,
      totalSize: b.totalSize,
    },
    identical: diffs.length === 0,
    diffCount: diffs.length,
    diffs: diffs.slice(0, 30),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
