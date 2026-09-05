import { commands, type IpcError } from "./bindings";

/**
 * The IPC boundary.
 *
 * `bindings.ts` returns `{ status: "ok" | "error" }` so a failed command is not
 * an exception. The UI wants the opposite: one `try`/`catch` per user action
 * and a typed error, because every error code maps to exactly one catalog key
 * (`errors.*` in i18n/en.json). `unwrap` does that conversion and nothing else.
 */

/** A command that failed, carrying the core's error code (never a sentence). */
export class NovalisError extends Error {
  readonly ipc: IpcError;

  constructor(ipc: IpcError) {
    super(ipc.code);
    this.name = "NovalisError";
    this.ipc = ipc;
  }

  get code(): string {
    return this.ipc.code;
  }
}

type Result<T> = { status: "ok"; data: T } | { status: "error"; error: IpcError };

export async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
  const result = await call;
  if (result.status === "error") throw new NovalisError(result.error);
  return result.data;
}

/** True for the one error the save path handles itself (§5.3 step 3). */
export function isConflict(error: unknown): boolean {
  return error instanceof NovalisError && error.code === "conflict";
}

/** The catalog key for any thrown value. */
export function errorKey(error: unknown): string {
  if (!(error instanceof NovalisError)) return "errors.internal";
  const map: Record<string, string> = {
    not_found: "errors.notFound",
    already_exists: "errors.alreadyExists",
    conflict: "errors.precondition",
    ambiguous: "errors.ambiguous",
    cloud_only: "errors.cloudOnly",
    no_vault: "errors.noVault",
    io: "errors.io",
    parse: "errors.parse",
    cache_busy: "errors.cacheBusy",
    invalid_path: "errors.invalidPath",
    bad_request: "errors.badRequest",
  };
  return map[error.code] ?? "errors.internal";
}

/** Values every `errors.*` message may interpolate. */
export function errorValues(error: unknown): Record<string, string> {
  if (!(error instanceof NovalisError)) return { detail: String(error) };
  return {
    path: error.ipc.path ?? "",
    detail: error.ipc.detail ?? error.code,
    name: error.ipc.name ?? "",
  };
}

export { commands };
export * from "./bindings";
