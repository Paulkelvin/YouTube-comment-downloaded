// Simple in-memory, fixed-window rate limiter keyed by client IP.
//
// NOTE: Vercel serverless functions are stateless between cold starts and
// can run as multiple concurrent instances, so this only limits requests
// hitting the *same warm instance* — it is a best-effort guard against
// casual abuse, not a hard cap. For strict enforcement across all
// instances, back this with a shared store (e.g. Upstash Redis/Vercel KV).

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS = 10;

const hits = new Map(); // ip -> array of request timestamps

export function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const timestamps = (hits.get(ip) || []).filter((t) => t > windowStart);
  const allowed = timestamps.length < MAX_REQUESTS;

  if (allowed) {
    timestamps.push(now);
    hits.set(ip, timestamps);
  }

  return {
    allowed,
    remaining: Math.max(0, MAX_REQUESTS - timestamps.length),
    resetAt: timestamps.length ? timestamps[0] + WINDOW_MS : now + WINDOW_MS,
  };
}

export function getClientIp(request) {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}
