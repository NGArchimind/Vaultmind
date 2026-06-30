// Timesheets — staff entry/submit + admin/HR review (approve/reject/unlock).
// Includes the week-lock + field-validation helpers. Extracted verbatim.
const express = require("express");
const { requireAuth, requireTimesheetManager } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");
const { supabase } = require("../helpers/clients");
const { serverError } = require("../helpers/serverError");
const { sendEmail, escapeHtml, notificationEmailHtml, notificationRecipients, getUserEmail } = require("../helpers/email");
const { daysOverCap } = require("../lib/timesheetValidation");
const { extrasMissingType } = require("../lib/unpricedExtras");
const { recentProjectIds } = require("../lib/recentProjects");

const router = express.Router();

// ── Timesheet helpers ─────────────────────────────────────────────────────────

function getWeekStart(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split("T")[0];
}

async function getWeekLockStatus(userId, weekStart) {
  const { data } = await supabase
    .from("timesheet_submissions")
    .select("status")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (data?.status === "submitted" || data?.status === "approved") return data.status;
  return null;
}

function validateTimesheetFields({ hours, minutes, entry_date } = {}) {
  if (entry_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) return "entry_date must be YYYY-MM-DD";
    const d = new Date(entry_date + "T12:00:00Z");
    if (isNaN(d.getTime())) return "entry_date is not a valid date";
    const day = d.getUTCDay();
    if (day === 0 || day === 6) return "entry_date must be a weekday (Monday–Friday)";
  }
  if (hours !== undefined) {
    const h = Number(hours);
    if (!Number.isInteger(h) || h < 0 || h > 16) return "hours must be an integer between 0 and 16";
  }
  if (minutes !== undefined) {
    const m = Number(minutes);
    if (![0, 15, 30, 45].includes(m)) return "minutes must be 0, 15, 30, or 45";
  }
  return null;
}

// ── Timesheets ────────────────────────────────────────────────────────────────

// GET /api/timesheets?week=YYYY-MM-DD  (Monday of the week)
router.get("/api/timesheets", requireAuth, async (req, res) => {
  const { week } = req.query;
  if (!week) return res.status(400).json({ error: "week parameter required" });
  const weekStart = week;
  const fri = new Date(week);
  fri.setDate(fri.getDate() + 4);
  const weekEnd = fri.toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("timesheets")
    .select("*, projects(id, name, job_number), project_extra_types(id, label)")
    .eq("user_id", req.user.id)
    .gte("entry_date", weekStart)
    .lte("entry_date", weekEnd)
    .order("entry_date");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/timesheets/history  — paginated entries for the current user, 6 weeks at a time
router.get("/api/timesheets/history", requireAuth, async (req, res) => {
  const weeks = Math.min(parseInt(req.query.weeks) || 6, 52);
  const endDate = req.query.before
    ? new Date(req.query.before + "T12:00:00Z")
    : new Date();
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - weeks * 7);
  const endStr   = endDate.toISOString().split("T")[0];
  const startStr = startDate.toISOString().split("T")[0];

  const [{ data: entries, error }, { data: subs }] = await Promise.all([
    supabase.from("timesheets").select("*, projects(id, name, job_number)")
      .eq("user_id", req.user.id)
      .gte("entry_date", startStr).lte("entry_date", endStr)
      .order("entry_date", { ascending: false }),
    supabase.from("timesheet_submissions").select("week_start, status, rejection_reason")
      .eq("user_id", req.user.id)
      .gte("week_start", startStr).lte("week_start", endStr),
  ]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ entries: entries || [], submissions: subs || [], startStr });
});

// GET /api/timesheets/submission?week=YYYY-MM-DD  — must be before /:id
router.get("/api/timesheets/submission", requireAuth, async (req, res) => {
  const { week } = req.query;
  if (!week) return res.status(400).json({ error: "week required" });
  const { data } = await supabase
    .from("timesheet_submissions")
    .select("*")
    .eq("user_id", req.user.id)
    .eq("week_start", week)
    .single();
  res.json(data || null);
});

// GET /api/timesheets/recent-projects — the user's most-recently-used project ids (must be before /:id)
router.get("/api/timesheets/recent-projects", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("timesheets")
      .select("project_id, entry_date")
      .eq("user_id", req.user.id)
      .not("project_id", "is", null)
      .order("entry_date", { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json({ project_ids: recentProjectIds(data || [], 8) });
  } catch (err) {
    return serverError(res, err, "GET /api/timesheets/recent-projects");
  }
});

// POST /api/timesheets
router.post("/api/timesheets", requireAuth, async (req, res) => {
  const { project_id, category, entry_date, hours = 0, minutes = 0, notes, overtime_hours = 0, overtime_minutes = 0, unpriced_extra = false, extra_type_id = null } = req.body;
  if (!entry_date) return res.status(400).json({ error: "entry_date required" });
  if (!project_id && !category) return res.status(400).json({ error: "project_id or category required" });

  const validErr = validateTimesheetFields({ entry_date, hours, minutes });
  if (validErr) return res.status(400).json({ error: validErr });
  const otErr = validateTimesheetFields({ hours: overtime_hours, minutes: overtime_minutes });
  if (otErr) return res.status(400).json({ error: `Overtime ${otErr}` });

  const weekStart = getWeekStart(entry_date);
  const lockStatus = await getWeekLockStatus(req.user.id, weekStart);
  if (lockStatus) return res.status(403).json({ error: `Week is ${lockStatus} — entries cannot be added` });

  const { data, error } = await supabase
    .from("timesheets")
    .insert({
      user_id: req.user.id,
      project_id: project_id || null,
      category: category || null,
      entry_date,
      hours: Number(hours),
      minutes: Number(minutes),
      // Overtime only applies to project entries
      overtime_hours: project_id ? Number(overtime_hours) : 0,
      overtime_minutes: project_id ? Number(overtime_minutes) : 0,
      notes: notes || null,
      // Unpriced-extra tag only makes sense against a project (job) line.
      unpriced_extra: project_id ? !!unpriced_extra : false,
      extra_type_id:  project_id ? (extra_type_id || null) : null,
    })
    .select("*, projects(id, name, job_number), project_extra_types(id, label)")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/timesheets/submit  — must be before /:id
router.post("/api/timesheets/submit", requireAuth, async (req, res) => {
  const { week } = req.body;
  if (!week) return res.status(400).json({ error: "week required" });

  const { data: existing } = await supabase
    .from("timesheet_submissions")
    .select("status")
    .eq("user_id", req.user.id)
    .eq("week_start", week)
    .maybeSingle();
  if (existing?.status === "approved") {
    return res.status(403).json({ error: "This week has already been approved and cannot be resubmitted" });
  }

  // Pre-submit checks on the week's entries:
  //   1. Daily cap — "time worked" (overtime excluded) must not exceed 7h 30m on any day.
  //   2. Every "unpriced extra" line must have an extra-type chosen.
  {
    const fri = new Date(week);
    fri.setDate(fri.getDate() + 4);
    const weekEnd = fri.toISOString().split("T")[0];
    const { data: weekEntries } = await supabase
      .from("timesheets")
      .select("entry_date, hours, minutes, unpriced_extra, extra_type_id")
      .eq("user_id", req.user.id)
      .gte("entry_date", week)
      .lte("entry_date", weekEnd);
    const over = daysOverCap(weekEntries || []);
    if (over.length) {
      const days = over.map(o => o.date).join(", ");
      return res.status(400).json({ error: `One or more days exceed the 7.5 hour daily limit for time worked (${days}). Move the extra time into Overtime before submitting.` });
    }
    if (extrasMissingType(weekEntries || []).length) {
      return res.status(400).json({ error: "Every 'unpriced extra' line needs an extra-type selected before you can submit." });
    }
  }

  const { data, error } = await supabase
    .from("timesheet_submissions")
    .upsert(
      { user_id: req.user.id, week_start: week, status: "submitted", submitted_at: new Date().toISOString(), rejection_reason: null },
      { onConflict: "user_id,week_start" }
    )
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  // Notify the configured role(s) that a timesheet was submitted for review
  {
    const adminEmails = await notificationRecipients("timesheet_submitted");
    if (adminEmails.length) {
      const weekStr = formatWeekRange(week);
      await sendEmail({
        to: adminEmails,
        subject: `Timesheet submitted — ${req.user.email}`,
        html: notificationEmailHtml("Timesheets", `<p style="margin:0;font-size:15px;color:#262830;"><strong>${escapeHtml(req.user.email)}</strong> submitted their timesheet for <strong>${weekStr}</strong> for review.</p>`),
        text: `${req.user.email} submitted their timesheet for ${weekStr} for review.`,
      });
    }
  }

  res.json(data);
});

// PUT /api/timesheets/:id
router.put("/api/timesheets/:id", requireAuth, async (req, res) => {
  const { data: existing } = await supabase
    .from("timesheets")
    .select("user_id, entry_date")
    .eq("id", req.params.id)
    .single();
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.user_id !== req.user.id) return res.status(403).json({ error: "Not authorised" });

  const weekStart = getWeekStart(existing.entry_date);
  const lockStatus = await getWeekLockStatus(req.user.id, weekStart);
  if (lockStatus) return res.status(403).json({ error: `Week is ${lockStatus} — entries cannot be modified` });

  if ("hours" in req.body) {
    const err = validateTimesheetFields({ hours: req.body.hours });
    if (err) return res.status(400).json({ error: err });
  }
  if ("minutes" in req.body) {
    const err = validateTimesheetFields({ minutes: req.body.minutes });
    if (err) return res.status(400).json({ error: err });
  }
  if ("overtime_hours" in req.body) {
    const err = validateTimesheetFields({ hours: req.body.overtime_hours });
    if (err) return res.status(400).json({ error: `Overtime ${err}` });
  }
  if ("overtime_minutes" in req.body) {
    const err = validateTimesheetFields({ minutes: req.body.overtime_minutes });
    if (err) return res.status(400).json({ error: `Overtime ${err}` });
  }

  const updates = { updated_at: new Date().toISOString() };
  if ("hours"            in req.body) updates.hours            = Number(req.body.hours);
  if ("minutes"          in req.body) updates.minutes          = Number(req.body.minutes);
  if ("overtime_hours"   in req.body) updates.overtime_hours   = Number(req.body.overtime_hours);
  if ("overtime_minutes" in req.body) updates.overtime_minutes = Number(req.body.overtime_minutes);
  if ("notes"      in req.body) updates.notes      = req.body.notes ?? null;
  if ("project_id" in req.body) updates.project_id = req.body.project_id || null;
  if ("category"   in req.body) updates.category   = req.body.category  || null;
  if ("unpriced_extra" in req.body) updates.unpriced_extra = !!req.body.unpriced_extra;
  if ("extra_type_id"  in req.body) updates.extra_type_id  = req.body.extra_type_id || null;

  const { data, error } = await supabase
    .from("timesheets")
    .update(updates)
    .eq("id", req.params.id)
    .select("*, projects(id, name, job_number), project_extra_types(id, label)")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/timesheets/:id
router.delete("/api/timesheets/:id", requireAuth, async (req, res) => {
  const { data: existing } = await supabase
    .from("timesheets")
    .select("user_id, entry_date")
    .eq("id", req.params.id)
    .single();
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.user_id !== req.user.id) return res.status(403).json({ error: "Not authorised" });

  const weekStart = getWeekStart(existing.entry_date);
  const lockStatus = await getWeekLockStatus(req.user.id, weekStart);
  if (lockStatus) return res.status(403).json({ error: `Week is ${lockStatus} — entries cannot be deleted` });

  const { error } = await supabase.from("timesheets").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Admin timesheet routes ─────────────────────────────────────────────────────

// GET /api/admin/timesheets/submissions  — must be before /:id
router.get("/api/admin/timesheets/submissions", requireAuth, requireTimesheetManager, async (req, res) => {
  const { data, error } = await supabase
    .from("timesheet_submissions")
    .select("*")
    .order("submitted_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/admin/timesheets/approve
router.post("/api/admin/timesheets/approve", requireAuth, requireTimesheetManager, async (req, res) => {
  const { week, user_id } = req.body;
  if (!week || !user_id) return res.status(400).json({ error: "week and user_id required" });
  const { data, error } = await supabase
    .from("timesheet_submissions")
    .update({ status: "approved", reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
    .eq("user_id", user_id)
    .eq("week_start", week)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post("/api/admin/timesheets/reject", requireAuth, requireTimesheetManager, async (req, res) => {
  const { week, user_id, reason } = req.body;
  if (!week || !user_id) return res.status(400).json({ error: "week and user_id required" });
  if (!reason?.trim()) return res.status(400).json({ error: "rejection reason required" });
  const { data, error } = await supabase
    .from("timesheet_submissions")
    .update({
      status: "draft",
      rejection_reason: reason.trim(),
      reviewed_by: req.user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("user_id", user_id)
    .eq("week_start", week)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  // Notify the configured role(s) that a timesheet was returned for changes
  {
    const recipients = await notificationRecipients("timesheet_rejected");
    if (recipients.length) {
      const who = (await getUserEmail(user_id)) || "A staff member";
      const weekStr = formatWeekRange(week);
      await sendEmail({
        to: recipients,
        subject: `Timesheet returned — ${weekStr}`,
        html: notificationEmailHtml("Timesheets", `<p style="margin:0 0 14px;font-size:15px;color:#262830;">The timesheet from <strong>${escapeHtml(who)}</strong> for <strong>${weekStr}</strong> has been returned for changes.</p><p style="margin:0;font-size:13px;color:#6a8a9a;">Reason:</p><p style="margin:4px 0 0;font-size:13px;color:#262830;padding:10px 14px;background:#f1f2f4;border-left:3px solid #4c6278;">${escapeHtml(reason.trim())}</p>`),
        text: `The timesheet from ${who} for ${weekStr} has been returned for changes.\nReason: ${reason.trim()}`,
      });
    }
  }

  res.json(data);
});

// POST /api/timesheets/unlock-request  — must be before /:id route
router.post("/api/timesheets/unlock-request", requireAuth, rateLimit(5, 60_000), async (req, res) => {
  const { week, reason } = req.body;
  if (!week) return res.status(400).json({ error: "week required" });
  if (!reason?.trim()) return res.status(400).json({ error: "reason required" });

  const { data: sub } = await supabase
    .from("timesheet_submissions")
    .select("status")
    .eq("user_id", req.user.id)
    .eq("week_start", week)
    .maybeSingle();
  if (!sub || (sub.status !== "submitted" && sub.status !== "approved")) {
    return res.status(400).json({ error: "No locked timesheet found for this week" });
  }

  const { error } = await supabase
    .from("timesheet_submissions")
    .update({ unlock_requested: true, unlock_reason: reason.trim() })
    .eq("user_id", req.user.id)
    .eq("week_start", week);
  if (error) return res.status(500).json({ error: error.message });

  // Email the configured role(s)
  const adminEmails = await notificationRecipients("unlock_requested");
  if (adminEmails.length) {
    const weekDate = new Date(week + "T12:00:00Z");
    const fri = new Date(weekDate); fri.setUTCDate(fri.getUTCDate() + 4);
    const o = { day: "numeric", month: "short" };
    const weekStr = `${weekDate.toLocaleDateString("en-GB", o)} – ${fri.toLocaleDateString("en-GB", { ...o, year: "numeric" })}`;
    await sendEmail({
      to: adminEmails,
      subject: `Timesheet edit request — ${req.user.email}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;"><div style="background:#4c6278;padding:16px 24px;"><span style="color:#fff;font-size:14px;font-weight:600;">Archimind — Timesheets</span></div><div style="padding:24px;border:1px solid #dde4e8;border-top:none;"><p style="margin:0 0 16px;font-size:15px;color:#262830;"><strong>${escapeHtml(req.user.email)}</strong> has requested to edit their timesheet for <strong>${weekStr}</strong>.</p><p style="font-size:13px;color:#6a8a9a;margin:0 0 6px;">Reason:</p><p style="margin:0;font-size:13px;color:#262830;padding:10px 14px;background:#f1f2f4;border-left:3px solid #4c6278;">${escapeHtml(reason.trim())}</p></div></div>`,
      text: `Timesheet edit request from ${req.user.email}\n\nWeek: ${weekStr}\nReason: ${reason.trim()}`,
    });
  }

  res.json({ ok: true });
});

router.post("/api/admin/timesheets/unlock", requireAuth, requireTimesheetManager, async (req, res) => {
  const { week, user_id } = req.body;
  if (!week || !user_id) return res.status(400).json({ error: "week and user_id required" });
  const { error } = await supabase
    .from("timesheet_submissions")
    .update({ status: "draft", unlock_requested: false, unlock_reason: null, rejection_reason: null })
    .eq("user_id", user_id)
    .eq("week_start", week);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// GET /api/admin/timesheets?user_id=&project_id=&week=&from=&to=
router.get("/api/admin/timesheets", requireAuth, requireTimesheetManager, async (req, res) => {
  const { week, user_id, project_id, from, to } = req.query;
  let query = supabase
    .from("timesheets")
    .select("*, projects(id, name, job_number), project_extra_types(id, label)")
    .order("entry_date", { ascending: false });
  if (user_id) query = query.eq("user_id", user_id);
  if (project_id) query = query.eq("project_id", project_id);
  if (week) {
    const fri = new Date(week);
    fri.setDate(fri.getDate() + 4);
    query = query.gte("entry_date", week).lte("entry_date", fri.toISOString().split("T")[0]);
  }
  if (from) query = query.gte("entry_date", from);
  if (to) query = query.lte("entry_date", to);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /api/admin/timesheets/:id
router.patch("/api/admin/timesheets/:id", requireAuth, requireTimesheetManager, async (req, res) => {
  if ("hours" in req.body) {
    const err = validateTimesheetFields({ hours: req.body.hours });
    if (err) return res.status(400).json({ error: err });
  }
  if ("minutes" in req.body) {
    const err = validateTimesheetFields({ minutes: req.body.minutes });
    if (err) return res.status(400).json({ error: err });
  }
  if ("overtime_hours" in req.body) {
    const err = validateTimesheetFields({ hours: req.body.overtime_hours });
    if (err) return res.status(400).json({ error: `Overtime ${err}` });
  }
  if ("overtime_minutes" in req.body) {
    const err = validateTimesheetFields({ minutes: req.body.overtime_minutes });
    if (err) return res.status(400).json({ error: `Overtime ${err}` });
  }
  const updates = { updated_at: new Date().toISOString() };
  if ("hours"            in req.body) updates.hours            = Number(req.body.hours);
  if ("minutes"          in req.body) updates.minutes          = Number(req.body.minutes);
  if ("overtime_hours"   in req.body) updates.overtime_hours   = Number(req.body.overtime_hours);
  if ("overtime_minutes" in req.body) updates.overtime_minutes = Number(req.body.overtime_minutes);
  if ("notes"      in req.body) updates.notes      = req.body.notes ?? null;
  if ("project_id" in req.body) updates.project_id = req.body.project_id || null;
  if ("category"   in req.body) updates.category   = req.body.category  || null;
  const { data, error } = await supabase
    .from("timesheets")
    .update(updates)
    .eq("id", req.params.id)
    .select("*, projects(id, name, job_number)")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
