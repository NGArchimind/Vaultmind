// Simple in-memory per-user/IP rate limiter. Resets on restart and isn't shared
// across instances — fine for a single Railway container. See HANDOVER "B3".
const rateLimitMap = new Map();

function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const key = req.user?.id || req.ip;
    const now = Date.now();
    const entry = rateLimitMap.get(key) || { count: 0, start: now };
    if (now - entry.start > windowMs) {
      entry.count = 0;
      entry.start = now;
    }
    entry.count++;
    rateLimitMap.set(key, entry);
    if (entry.count > maxRequests) {
      return res.status(429).json({ error: "Too many requests — please slow down." });
    }
    next();
  };
}

// Evict stale rate-limit entries so the map can't grow unbounded on a long-lived server.
const _rateLimitSweep = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap) if (now - v.start > 600_000) rateLimitMap.delete(k);
}, 600_000);
if (_rateLimitSweep.unref) _rateLimitSweep.unref();

module.exports = { rateLimit };
