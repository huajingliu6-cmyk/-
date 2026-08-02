/**
 * Legacy JSON / filesystem stores remain the runtime default while
 * PERSISTENCE_DRIVER=file (Batch A).
 *
 * New features must target PostgreSQL repositories under src/persistence/.
 * Do not treat these modules as the long-term production data layer.
 */

export const LEGACY_FILE_REPOSITORY_NOTE =
  "LegacyFileRepository: JSON/fs store under data/. Migrate domain-by-domain; do not dual-write.";

export type LegacyFileRepositoryTag = "legacy-file";
