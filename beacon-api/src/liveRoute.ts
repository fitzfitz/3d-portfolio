import { hmacHex, rateKey, MIN_SALT_LENGTH, type RequestLimiter } from "./handler";

/** The header the Worker sets for the Sky room; whatever a client sent under it is replaced. */
export const VISITOR_HEADER = "X-Sky-Visitor";

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

/**
 * The key the room caps places by: HMAC(IP_SALT, the pilot's IPv4 or IPv6
 * /64), as beacons hash it. Null without a usable salt, which turns the
 * per-visitor cap off rather than hashing weakly.
 */
export async function visitorKey(ip: string, salt: string): Promise<string | null> {
  return salt.length < MIN_SALT_LENGTH ? null : hmacHex(salt, rateKey(ip));
}

/** The upgrade as forwarded to the room: only the Worker may set the visitor header. */
export function skyRequest(req: Request, visitor: string | null): Request {
  const r = new Request(req);
  if (visitor) r.headers.set(VISITOR_HEADER, visitor);
  else r.headers.delete(VISITOR_HEADER);
  return r;
}
