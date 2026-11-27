import "server-only";
import { ZodError, type ZodType } from "zod";
import { UnauthorizedError, requireSession, type Session } from "./auth";
import { NotFoundError, VersionConflictError } from "./data/repository";
import { ProposalStateError } from "./services/proposals";
import { AssistantError } from "./ai/assistant";
import { CaptureInputError } from "./capture/process";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
  return schema.parse(raw);
}

/** Wrap a route handler: resolves the session and maps domain errors to HTTP responses. */
export function route<C = unknown>(fn: (session: Session, req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      const session = await requireSession();
      return await fn(session, req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof UnauthorizedError) return json({ error: err.message, code: "unauthorized" }, 401);
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) fields[issue.path.join(".") || "_"] ??= issue.message;
    return json({ error: "Please check the highlighted fields.", code: "validation", fields }, 422);
  }
  if (err instanceof NotFoundError) return json({ error: err.message, code: "not_found" }, 404);
  if (err instanceof VersionConflictError) return json({ error: err.message, code: "version_conflict", current: err.current }, 409);
  if (err instanceof ProposalStateError) return json({ error: err.message, code: "proposal_state" }, 409);
  if (err instanceof CaptureInputError) return json({ error: err.message, code: "capture_input" }, 422);
  if (err instanceof AssistantError) return json({ error: err.message, code: "assistant" }, err.status);
  if (err instanceof HttpError) return json({ error: err.message, ...err.body }, err.status);
  console.error(err);
  return json({ error: "Something went wrong. Your changes were not saved.", code: "internal" }, 500);
}
