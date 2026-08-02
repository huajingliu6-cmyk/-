import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = path.join(repoRoot, ".next", "standalone");

for (const name of ["data", "prisma"]) {
  const target = path.resolve(standaloneRoot, name);
  if (path.dirname(target) !== standaloneRoot) {
    throw new Error(`Refusing to remove unexpected artifact path: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
}

console.log("Standalone artifact sanitized: removed local data and legacy Prisma files.");
