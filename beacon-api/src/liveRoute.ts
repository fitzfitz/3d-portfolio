import { rateKey, type RequestLimiter } from "./handler";

export interface LiveDeps {
  allowedOrigins: readonly string[];
  /** Same per-pilot budget as beacons (env.LIMITER); optional so tests need no binding. */
  limiter?: RequestLimiter;
}

/**
 * Gates GET /live before it reaches the Sky room. Returns the refusal, or null
 * to forward the upgrade. As with beacon drops, the Origin check only stops
 * other sites' pages from joining; the request budget is what bounds abuse.
 */
export async function refuseLive(req: Request, deps: LiveDeps): Promise<Response | null> {
  if (req.method !== "GET" || req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("expected a websocket upgrade", { status: 426 });
  }
  const origin = req.headers.get("Origin");
  if (!origin || !deps.allowedOrigins.includes(origin)) return new Response("origin", { status: 403 });
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  if (deps.limiter && !(await deps.limiter.limit({ key: rateKey(ip) })).success) {
    return new Response("slow down", { status: 429, headers: { "Retry-After": "60" } });
  }
  return null;
}
