/**
 * Canonical read-only hash of a data directory (repo data/ or APP_DATA_DIR).
 *
 * Algorithm (stable across OS / absolute paths):
 * 1. Recurse files
 * 2. Sort by relative path with `/` separators
 * 3. For each file: UTF-8 relative path + NUL + raw bytes + NUL
 * 4. SHA-256 hex digest
 *
 * Usage:
 *   npx tsx scripts/hash-app-data.ts
 *   npx tsx scripts/hash-app-data.ts --dir path/to/data
 */
import { createHash } from "crypto";
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import path from "path";

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch (err) {
      throw new Error(`无法读取 ${full}: ${String(err)}`);
    }
    if (st.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out;
}

export function hashAppDataDir(dir: string): {
  fileCount: number;
  sha256: string;
} {
  if (!existsSync(dir)) {
    throw new Error(`目录不存在: ${dir}`);
  }
  const files = walkFiles(dir)
    .map((f) => path.relative(dir, f).split(path.sep).join("/"))
    .sort();
  const h = createHash("sha256");
  for (const rel of files) {
    h.update(rel, "utf8");
    h.update("\0");
    h.update(readFileSync(path.join(dir, ...rel.split("/"))));
    h.update("\0");
  }
  return { fileCount: files.length, sha256: h.digest("hex") };
}

function main() {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf("--dir");
  const target =
    dirIdx >= 0 && args[dirIdx + 1]
      ? path.resolve(args[dirIdx + 1]!)
      : path.resolve(process.cwd(), "data");
  const result = hashAppDataDir(target);
  console.log(
    JSON.stringify(
      {
        dir: target,
        fileCount: result.fileCount,
        sha256: result.sha256,
        algorithm: "relpath-utf8 + NUL + bytes + NUL / sha256",
      },
      null,
      2,
    ),
  );
}

main();
