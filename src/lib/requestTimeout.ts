export class RequestTimeoutError extends Error {
  step: string;
  timeoutMs: number;

  constructor(step: string, timeoutMs: number) {
    super(`[RequestTimeout] Step "${step}" timed out after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
    this.step = step;
    this.timeoutMs = timeoutMs;
  }
}

export function isRequestTimeoutError(err: any): boolean {
  return Boolean(
    err &&
      (err instanceof RequestTimeoutError ||
        err.name === "RequestTimeoutError" ||
        err.name === "AuthTimeoutError" ||
        err.name === "AbortError" ||
        String(err.message || "").toLowerCase().includes("timed out"))
  );
}

/**
 * Wraps any Promise/Thenable (such as Supabase PostgREST queries or RPC calls)
 * with a bounded timeout and cleans up the timer upon settlement.
 */
export function withRequestTimeout<T>(
  promiseOrThenable: PromiseLike<T>,
  timeoutMs = 10000,
  stepName = "supabase.request"
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.resolve(promiseOrThenable);
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new RequestTimeoutError(stepName, timeoutMs));
    }, timeoutMs);

    Promise.resolve(promiseOrThenable).then(
      (val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
