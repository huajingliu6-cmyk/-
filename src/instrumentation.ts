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
  }
}
