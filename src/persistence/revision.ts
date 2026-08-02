export class RevisionConflictError extends Error {
  readonly code = "REVISION_CONFLICT" as const;
  readonly resource: string;
  readonly expectedRevision: number;
  readonly currentRevision: number | null;

  constructor(input: {
    resource: string;
    expectedRevision: number;
    currentRevision?: number | null;
  }) {
    super(
      `Revision conflict on ${input.resource}: expected ${input.expectedRevision}`,
    );
    this.name = "RevisionConflictError";
    this.resource = input.resource;
    this.expectedRevision = input.expectedRevision;
    this.currentRevision = input.currentRevision ?? null;
  }
}

export const HTTP_REVISION_CONFLICT = 409;
