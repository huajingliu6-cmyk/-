export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateWebRuntimeContract } = await import(
      "@/persistence/web-runtime-contract"
    );
    validateWebRuntimeContract();

    const { installImageJobGracefulShutdownHooks } = await import(
      "@/projects/assets/image-generation/graceful-shutdown"
    );
    installImageJobGracefulShutdownHooks();

    // Best-effort: re-dispatch live asset-extraction runners after web rebuild.
    void (async () => {
      try {
        const { listProjectRecords } = await import(
          "@/projects/project-access"
        );
        const { resumeLiveAssetExtractionTask } = await import(
          "@/projects/assets/extraction/resume"
        );
        const projects = await listProjectRecords();
        for (const project of projects) {
          try {
            await resumeLiveAssetExtractionTask(project.projectId);
          } catch {
            /* ignore per-project resume errors */
          }
        }
      } catch {
        /* ignore startup resume bootstrap errors */
      }
    })();
  }
}
