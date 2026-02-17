import {
  deleteAsyncCompileJob,
  isExpired,
  readAsyncCompileMetadata,
} from "./asyncCompileStore";

export async function getAuthorizedAsyncCompileJob(
  userId: string,
  jobId: string
): Promise<
  | { ok: true; meta: NonNullable<Awaited<ReturnType<typeof readAsyncCompileMetadata>>> }
  | { ok: false; status: number; error: string }
> {
  const meta = await readAsyncCompileMetadata(jobId);
  if (!meta) {
    return { ok: false, status: 404, error: "Compile job not found" };
  }

  if (meta.userId !== userId) {
    return { ok: false, status: 404, error: "Compile job not found" };
  }

  if (isExpired(meta)) {
    await deleteAsyncCompileJob(jobId).catch(() => {});
    return { ok: false, status: 410, error: "Compile job result expired" };
  }

  return { ok: true, meta };
}

