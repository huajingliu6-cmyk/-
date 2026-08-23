import { describe, expect, it } from "vitest";
import {
  progressForResumedLibraryLookJob,
  shouldResumeLibraryLookJob,
} from "@/projects/assets/character-look-job-resume";
import type { ImageGenerationJob } from "@/projects/assets/image-generation/types";

function makeJob(
  overrides: Partial<ImageGenerationJob> = {},
): ImageGenerationJob {
  return {
    id: "img_test",
    projectId: "proj_1",
    scope: "management",
    subjectKind: "library_character",
    subjectId: "char_1",
    sourceEntry: "library_look",
    status: "running",
    params: {
      prompt: "test",
      mode: "image_to_image",
    },
    errorFields: [],
    savedToLibrary: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("character look job resume", () => {
  it("resumes active library_look jobs not yet owned by the editor session", () => {
    const job = makeJob({ status: "running", estimatedPercent: 55 });
    expect(
      shouldResumeLibraryLookJob(job, {
        ownedJobIds: new Set(),
        appliedJobId: null,
      }),
    ).toBe(true);
    expect(progressForResumedLibraryLookJob(job)).toEqual({
      stage: "generating",
      percent: 55,
      message: "正在生成图片",
    });
  });

  it("resumes succeeded library_look jobs that still need saving", () => {
    const job = makeJob({
      status: "succeeded",
      primaryMediaId: "media_1",
      savedToLibrary: false,
    });
    expect(
      shouldResumeLibraryLookJob(job, {
        ownedJobIds: new Set(),
        appliedJobId: null,
      }),
    ).toBe(true);
  });

  it("ignores main-image jobs and already-owned jobs", () => {
    const mainImage = makeJob({ sourceEntry: "library_image" });
    const owned = makeJob({ id: "img_owned" });
    expect(
      shouldResumeLibraryLookJob(mainImage, {
        ownedJobIds: new Set(),
        appliedJobId: null,
      }),
    ).toBe(false);
    expect(
      shouldResumeLibraryLookJob(owned, {
        ownedJobIds: new Set(["img_owned"]),
        appliedJobId: null,
      }),
    ).toBe(false);
  });
});
