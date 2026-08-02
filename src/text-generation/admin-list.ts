import { promises as fs } from "fs";
import path from "path";
import type {
  TextGenerationJob,
  TextGenerationStatus,
  TextOutputKind,
} from "@/text-generation/types";
import { listProjectRecords } from "@/projects/project-access";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { listTextJobs } from "@/text-generation/job-store";
import { projectRootDir } from "@/projects/project-storage";

export type AdminTextGenerationFilters = {
  userId?: string;
  projectId?: string;
  outputKind?: TextOutputKind | "";
  status?: TextGenerationStatus | "";
  modelKey?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

export type AdminTextGenerationListResult = {
  items: TextGenerationJob[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

function jobsDir(projectId: string): string {
  return path.join(projectRootDir(projectId), "text-generations");
}

async function readProjectJobs(projectId: string): Promise<TextGenerationJob[]> {
  if (isRemoteDataOnly()) return listTextJobs(projectId);
  const dir = jobsDir(projectId);
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const jobs: TextGenerationJob[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, name), "utf-8");
      const job = JSON.parse(raw) as TextGenerationJob;
      if (job && typeof job.generationId === "string") {
        jobs.push(job);
      }
    } catch {
      /* skip corrupt */
    }
  }
  return jobs;
}

/**
 * Cross-project scan of text-generation job files for system admin history.
 * Sorted by createdAt desc. Filters applied in memory (MVP).
 */
export async function listTextJobsForAdmin(
  filters: AdminTextGenerationFilters = {},
): Promise<AdminTextGenerationListResult> {
  const pageSize = Math.min(50, Math.max(1, filters.pageSize ?? 20));
  const page = Math.max(1, filters.page ?? 1);

  const projects = filters.projectId
    ? [{ projectId: filters.projectId }]
    : await listProjectRecords();

  const all: TextGenerationJob[] = [];
  for (const project of projects) {
    const jobs = await readProjectJobs(project.projectId);
    all.push(...jobs);
  }

  const userId = filters.userId?.trim() ?? "";
  const outputKind = filters.outputKind?.trim() ?? "";
  const status = filters.status?.trim() ?? "";
  const modelKey = filters.modelKey?.trim().toLowerCase() ?? "";
  const q = filters.q?.trim().toLowerCase() ?? "";

  const filtered = all.filter((job) => {
    if (userId && job.userId !== userId) return false;
    if (outputKind && job.outputKind !== outputKind) return false;
    if (status && job.status !== status) return false;
    if (
      modelKey &&
      !job.modelKey.toLowerCase().includes(modelKey) &&
      !job.displayModelName.toLowerCase().includes(modelKey) &&
      !job.providerModelId.toLowerCase().includes(modelKey)
    ) {
      return false;
    }
    if (q) {
      const hay = [
        job.content,
        job.brief,
        job.generationId,
        job.displayModelName,
        job.errorMessage ?? "",
      ]
        .join("\n")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    const ta = a.createdAt || a.updatedAt || "";
    const tb = b.createdAt || b.updatedAt || "";
    return tb.localeCompare(ta);
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return { items, page: safePage, pageSize, total, totalPages };
}
