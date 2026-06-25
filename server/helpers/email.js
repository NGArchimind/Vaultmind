// Email sending + notification-routing helpers (shared by timesheets, expenses
// and admin domains). Wraps Resend and reads per-event routing from app_settings.
const { Resend } = require("resend");
const { supabase } = require("./clients");

let _resend = null;
function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

async function sendEmail({ to, subject, html, text, attachments }) {
  const resend = getResend();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set — skipping:", subject);
    return;
  }
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM || "Archimind <noreply@example.com>",
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
      ...(attachments && attachments.length ? { attachments } : {}),
    });
  } catch (err) {
    console.error("[email] Send failed:", err.message);
  }
}

async function getAdminEmails() {
  const { data } = await supabase.auth.admin.listUsers();
  return (data?.users || [])
    .filter(u => u.app_metadata?.role === "admin")
    .map(u => u.email)
    .filter(Boolean);
}

async function getHrEmails() {
  const { data } = await supabase.auth.admin.listUsers();
  return (data?.users || [])
    .filter(u => u.app_metadata?.role === "hr")
    .map(u => u.email)
    .filter(Boolean);
}

// Escape user-supplied text before interpolating into notification email HTML,
// so a description/reason containing markup can't render as live content.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Notification settings ─────────────────────────────────────────────────────
// Per-event email routing for the five notifications, stored as JSON in
// app_settings (key "notification_settings"). New shape: each event maps to
// { admin: bool, hr: bool } — the event emails whichever roles are on.
// Backward-compatible: an old boolean value (or a missing key) is read using
// the per-event default below, so the new server understands old stored data.
const NOTIFICATION_KEYS = [
  "timesheet_submitted",
  "expense_submitted",
  "unlock_requested",
  "expense_decided",
  "timesheet_rejected",
];

// Default routing per event (used for missing keys and legacy boolean values).
const NOTIFICATION_DEFAULTS = {
  timesheet_submitted: { admin: true,  hr: false },
  expense_submitted:   { admin: true,  hr: false },
  unlock_requested:    { admin: true,  hr: false },
  expense_decided:     { admin: false, hr: false },
  timesheet_rejected:  { admin: false, hr: false },
};

// Normalise one stored value (object | boolean | undefined) to { admin, hr }.
function normaliseNotificationValue(key, stored) {
  const def = NOTIFICATION_DEFAULTS[key] || { admin: false, hr: false };
  if (stored && typeof stored === "object") {
    return { admin: stored.admin === true, hr: stored.hr === true };
  }
  if (stored === false) return { admin: false, hr: false }; // legacy "off"
  return { ...def }; // legacy true, or missing → default
}

async function getNotificationSettings() {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "notification_settings").maybeSingle();
  let stored = {};
  try { stored = data?.value ? JSON.parse(data.value) : {}; } catch { stored = {}; }
  const out = {};
  for (const k of NOTIFICATION_KEYS) out[k] = normaliseNotificationValue(k, stored[k]);
  return out;
}

// Deduped recipient email list for an event, based on its admin/hr toggles.
async function notificationRecipients(key) {
  const settings = await getNotificationSettings();
  const route = settings[key] || { admin: false, hr: false };
  const emails = [];
  if (route.admin) emails.push(...(await getAdminEmails()));
  if (route.hr)    emails.push(...(await getHrEmails()));
  return [...new Set(emails.filter(Boolean))];
}

async function getUserEmail(userId) {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    return data?.user?.email || null;
  } catch { return null; }
}

// Branded wrapper shared by notification emails.
function notificationEmailHtml(headerLabel, bodyHtml) {
  return `<div style="font-family:Arial,sans-serif;max-width:520px;"><div style="background:#4c6278;padding:16px 24px;"><span style="color:#fff;font-size:14px;font-weight:600;">Archimind — ${headerLabel}</span></div><div style="padding:24px;border:1px solid #dde4e8;border-top:none;">${bodyHtml}</div></div>`;
}

module.exports = {
  getResend,
  sendEmail,
  getAdminEmails,
  getHrEmails,
  escapeHtml,
  NOTIFICATION_KEYS,
  NOTIFICATION_DEFAULTS,
  normaliseNotificationValue,
  getNotificationSettings,
  notificationRecipients,
  getUserEmail,
  notificationEmailHtml,
};
