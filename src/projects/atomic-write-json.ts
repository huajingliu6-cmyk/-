import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

/**
 * Temp-file + rename write. Payload is re-read before rename so a truncated
 * temp file cannot replace the live document.
 */
export async function atomicWriteJson(
  target: string,
  data: unknown,
): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  try {
    await fs.writeFile(temp, payload, "utf-8");
    const readBack = await fs.readFile(temp, "utf-8");
    if (readBack !== payload) {
      throw new Error("ATOMIC_WRITE_VERIFY_FAILED");
    }
    await fs.rename(temp, target);
  } catch (error) {
    await fs.unlink(temp).catch(() => undefined);
    throw error;
  }
}
