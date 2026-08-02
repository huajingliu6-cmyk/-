import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

async function walk(dir: string, root: string, out: Array<{ path: string; size: number; sha256: string }>) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, root, out);
      continue;
    }
    if (!e.isFile()) continue;
    const buf = await fs.readFile(full);
    out.push({
      path: path.relative(root, full).split(path.sep).join("/"),
      size: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
    });
  }
}

async function buildManifest(dataRoot: string) {
  const files: Array<{ path: string; size: number; sha256: string }> = [];
  await walk(dataRoot, dataRoot, files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const jsonCount = files.filter((f) => f.path.endsWith(".json")).length;
  return {
    fileCount: files.length,
    jsonCount,
    binaryCount: files.length - jsonCount,
    totalSize,
    files,
  };
}

function diff(
  a: Awaited<ReturnType<typeof buildManifest>>,
  b: Awaited<ReturnType<typeof buildManifest>>,
) {
  const am = new Map(a.files.map((f) => [f.path, f]));
  const bm = new Map(b.files.map((f) => [f.path, f]));
  const added: string[] = [];
  const missing: string[] = [];
  const changed: string[] = [];
  for (const [p, f] of am) {
    const g = bm.get(p);
    if (!g) missing.push(p);
    else if (g.sha256 !== f.sha256 || g.size !== f.size) changed.push(p);
  }
  for (const p of bm.keys()) {
    if (!am.has(p)) added.push(p);
  }
  return {
    identical:
      added.length === 0 &&
      missing.length === 0 &&
      changed.length === 0 &&
      a.fileCount === b.fileCount &&
      a.totalSize === b.totalSize,
    added,
    missing,
    changed,
  };
}

async function main() {
  const mode = process.argv[2];
  const dataRoot = path.join(process.cwd(), "data");
  const dir = path.join(process.env.TEMP || "/tmp", "ic-av1-manifests");
  await fs.mkdir(dir, { recursive: true });

  if (mode === "write") {
    const name = process.argv[3] || "snap.json";
    const m = await buildManifest(dataRoot);
    await fs.writeFile(path.join(dir, name), JSON.stringify(m));
    console.log(
      `WROTE ${name} files=${m.fileCount} json=${m.jsonCount} bin=${m.binaryCount} size=${m.totalSize}`,
    );
    return;
  }

  if (mode === "compare") {
    const left = process.argv[3];
    const right = process.argv[4];
    const a = JSON.parse(await fs.readFile(path.join(dir, left), "utf8"));
    const b = JSON.parse(await fs.readFile(path.join(dir, right), "utf8"));
    const d = diff(a, b);
    console.log(`LEFT ${left} files=${a.fileCount} size=${a.totalSize}`);
    console.log(`RIGHT ${right} files=${b.fileCount} size=${b.totalSize}`);
    console.log(`IDENTICAL=${d.identical}`);
    console.log(`ADDED=${d.added.length}`);
    console.log(d.added.slice(0, 30).join("\n"));
    console.log(`MISSING=${d.missing.length}`);
    console.log(d.missing.slice(0, 30).join("\n"));
    console.log(`CHANGED=${d.changed.length}`);
    console.log(d.changed.slice(0, 30).join("\n"));
    process.exit(d.identical ? 0 : 2);
  }

  console.error("usage: write <name> | compare <left> <right>");
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
