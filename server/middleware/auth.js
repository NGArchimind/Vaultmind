// Authentication / authorisation middleware.
const { supabase } = require("../helpers/clients");

// ── JWT auth middleware ───────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorised — no token provided" });
  }

  const token = authHeader.slice(7);

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: "Unauthorised — invalid or expired token" });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorised — invalid or expired token" });
  }
}

async function requireAdmin(req, res, next) {
  // Role lives in app_metadata (server-only, not user-editable), never user_metadata.
  const role = req.user?.app_metadata?.role;
  if (role !== "admin") {
    return res.status(403).json({ error: "Forbidden — admin only" });
  }
  next();
}

// Allows admins and HR. Use ONLY on timesheet-review endpoints — HR is walled
// off from expenses, fees, user management and all other admin areas.
function requireTimesheetManager(req, res, next) {
  const role = req.user?.app_metadata?.role;
  if (role !== "admin" && role !== "hr") {
    return res.status(403).json({ error: "Forbidden — admin or HR only" });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireTimesheetManager };
