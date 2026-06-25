// Expenses — staff expense claims + line items, receipts, and admin review.
// Also holds the admin notification / timesheet-reminder / HR-report SETTINGS
// routes (grouped here in the original file). Extracted verbatim from index.js.
const express = require("express");
const { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");
const { supabase, r2, BUCKET } = require("../helpers/clients");
const { serverError } = require("../helpers/serverError");
const { sendEmail, escapeHtml, notificationEmailHtml, notificationRecipients, getUserEmail, getNotificationSettings, normaliseNotificationValue, NOTIFICATION_KEYS } = require("../helpers/email");
const { claimTotalPence } = require("../lib/expenseClaims");
const { buildClaimPdf } = require("../lib/expenseClaimPdf");
const { getReminderSettings, runTimesheetReminders, getHrReportSettings, runHrReport, notifyClaimDecision } = require("../helpers/schedulers");

const router = express.Router();

// ── Expenses ──────────────────────────────────────────────────────────────────

const VALID_EXPENSE_TYPES = ["train", "mileage", "meals", "taxi", "parking"];

async function getMileageRatePpm() {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "mileage_rate_ppm").maybeSingle();
  return parseInt(data?.value) || 45;
}

// Fetch a receipt object from R2 as { bytes, contentType } (used to assemble claim PDFs).
async function fetchReceipt(key) {
  const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = []; for await (const c of obj.Body) chunks.push(c);
  return { bytes: Buffer.concat(chunks), contentType: obj.ContentType || "application/octet-stream" };
}

// ── Expense claims (staff) ─────────────────────────────────────────────────────

// GET /api/expense-claims — all of this user's claims (newest first) with line items
router.get("/api/expense-claims", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("expense_claims")
    .select("*, project_expenses(*, projects(id, name, job_number))")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return serverError(res, error, "GET /api/expense-claims");
  res.json((data || []).map(c => ({ ...c, total_pence: claimTotalPence(c.project_expenses) })));
});

// POST /api/expense-claims — return this user's open draft claim, creating one if needed
router.post("/api/expense-claims", requireAuth, async (req, res) => {
  const { data: existing } = await supabase.from("expense_claims")
    .select("id").eq("user_id", req.user.id).eq("status", "draft").maybeSingle();
  if (existing) return res.json(existing);
  const { data, error } = await supabase.from("expense_claims")
    .insert({ user_id: req.user.id, status: "draft" }).select().single();
  if (error) return serverError(res, error, "POST /api/expense-claims");
  res.json(data);
});

// POST /api/expense-claims/:id/submit — lock the claim and notify admins
router.post("/api/expense-claims/:id/submit", requireAuth, async (req, res) => {
  const { data: claim } = await supabase.from("expense_claims")
    .select("*, project_expenses(*, projects(id, name, job_number))")
    .eq("id", req.params.id).single();
  if (!claim) return res.status(404).json({ error: "Not found" });
  if (claim.user_id !== req.user.id) return res.status(403).json({ error: "Not authorised" });
  if (!["draft", "rejected"].includes(claim.status)) return res.status(403).json({ error: "Claim already submitted" });
  const items = claim.project_expenses || [];
  if (items.length === 0) return res.status(400).json({ error: "Add at least one expense before submitting" });

  const { data, error } = await supabase.from("expense_claims")
    .update({ status: "submitted", submitted_at: new Date().toISOString(), rejection_reason: null, updated_at: new Date().toISOString() })
    .eq("id", req.params.id).select().single();
  if (error) return serverError(res, error, "submit claim");

  const recipients = await notificationRecipients("expense_submitted");
  if (recipients.length) {
    const total = `£${(claimTotalPence(items) / 100).toFixed(2)}`;
    const rows = items.map(i => {
      const proj = i.projects?.job_number ? `${i.projects.job_number} — ${i.projects.name}` : (i.projects?.name || "—");
      return `<tr><td style="padding:4px 8px;border-top:1px solid #eee;">${escapeHtml(proj)}</td><td style="padding:4px 8px;border-top:1px solid #eee;">${escapeHtml(i.description || "")}</td><td style="padding:4px 8px;border-top:1px solid #eee;text-align:right;">£${((i.amount_pence || 0) / 100).toFixed(2)}</td></tr>`;
    }).join("");
    let attachments;
    try {
      const { pdfBytes, unembeddable } = await buildClaimPdf({ claim: data, items, submitterEmail: req.user.email, fetchReceipt });
      attachments = [{ filename: "expense-claim.pdf", content: Buffer.from(pdfBytes).toString("base64") }];
      for (const u of unembeddable) attachments.push({ filename: u.filename, content: Buffer.from(u.bytes).toString("base64") });
    } catch (e) {
      console.error("[expense-claim PDF] build failed:", e.message);
    }
    await sendEmail({
      to: recipients,
      subject: `Expense claim — ${req.user.email.split("@")[0]} · ${items.length} item(s) · ${total}`,
      html: notificationEmailHtml("Expenses", `<p style="margin:0 0 12px;font-size:15px;color:#262830;"><strong>${escapeHtml(req.user.email)}</strong> submitted an expense claim of <strong>${total}</strong> (${items.length} item(s)). The full claim and receipts are attached as a PDF.</p><table style="width:100%;border-collapse:collapse;font-size:13px;"><tr><td style="padding:4px 8px;color:#6a8a9a;">Project</td><td style="padding:4px 8px;color:#6a8a9a;">Description</td><td style="padding:4px 8px;color:#6a8a9a;text-align:right;">Amount</td></tr>${rows}</table>`),
      text: `${req.user.email} submitted an expense claim of ${total} (${items.length} items).`,
      attachments,
    });
  }
  res.json(data);
});

// GET /api/expenses/settings  — must be before /api/expenses/:id
router.get("/api/expenses/settings", requireAuth, async (req, res) => {
  res.json({ mileage_rate_ppm: await getMileageRatePpm() });
});

// POST /api/expenses
router.post("/api/expenses", requireAuth, rateLimit(10, 60_000), async (req, res) => {
  const { project_id, expense_type, expense_date, amount_pence, miles, description, claim_id } = req.body;
  if (!project_id) return res.status(400).json({ error: "project_id required" });
  if (!claim_id) return res.status(400).json({ error: "claim_id required" });
  if (!VALID_EXPENSE_TYPES.includes(expense_type)) return res.status(400).json({ error: "Invalid expense_type" });
  if (!expense_date || !/^\d{4}-\d{2}-\d{2}$/.test(expense_date)) return res.status(400).json({ error: "expense_date required (YYYY-MM-DD)" });
  const expD = new Date(expense_date + "T12:00:00Z");
  if (isNaN(expD.getTime())) return res.status(400).json({ error: "Invalid expense_date" });
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (expD > tomorrow) return res.status(400).json({ error: "expense_date cannot be in the future" });
  if (!description?.trim()) return res.status(400).json({ error: "description required" });

  // The line item must attach to one of this user's editable (draft/rejected) claims.
  const { data: claim } = await supabase.from("expense_claims").select("user_id, status").eq("id", claim_id).maybeSingle();
  if (!claim || claim.user_id !== req.user.id) return res.status(403).json({ error: "Invalid claim" });
  if (!["draft", "rejected"].includes(claim.status)) return res.status(403).json({ error: "Claim already submitted" });

  let computedPence;
  let computedMiles = null;
  if (expense_type === "mileage") {
    const m = Number(miles);
    if (!m || m <= 0) return res.status(400).json({ error: "miles required for mileage expenses" });
    const rate = await getMileageRatePpm();
    computedPence = Math.round(m * rate);
    computedMiles = m;
  } else {
    const p = Number(amount_pence);
    if (!p || p <= 0) return res.status(400).json({ error: "amount_pence required" });
    computedPence = Math.round(p);
  }

  const { data, error } = await supabase
    .from("project_expenses")
    .insert({
      user_id: req.user.id,
      claim_id,
      project_id,
      expense_type,
      expense_date,
      amount_pence: computedPence,
      miles: computedMiles,
      description: description.trim(),
      status: "pending",
    })
    .select("*, projects(id, name, job_number)")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PUT /api/expenses/:id
router.put("/api/expenses/:id", requireAuth, async (req, res) => {
  const { data: existing } = await supabase.from("project_expenses").select("user_id, expense_type, miles, expense_claims(status)").eq("id", req.params.id).single();
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.user_id !== req.user.id) return res.status(403).json({ error: "Not authorised" });
  if (!["draft", "rejected"].includes(existing.expense_claims?.status)) return res.status(403).json({ error: "Only items in a draft or returned claim can be edited" });

  const newType = req.body.expense_type || existing.expense_type;
  if ("expense_type" in req.body && !VALID_EXPENSE_TYPES.includes(req.body.expense_type)) {
    return res.status(400).json({ error: "Invalid expense_type" });
  }

  const updates = { updated_at: new Date().toISOString() };
  if ("expense_type"  in req.body) updates.expense_type  = req.body.expense_type;
  if ("expense_date"  in req.body) updates.expense_date  = req.body.expense_date;
  if ("description"   in req.body) updates.description   = req.body.description?.trim();
  if ("project_id"    in req.body) updates.project_id    = req.body.project_id;

  if (newType === "mileage") {
    const newMiles = "miles" in req.body ? Number(req.body.miles) : existing.miles;
    const rate = await getMileageRatePpm();
    updates.amount_pence = Math.round(newMiles * rate);
    updates.miles = newMiles;
  } else if ("amount_pence" in req.body) {
    updates.amount_pence = Math.round(Number(req.body.amount_pence));
    updates.miles = null;
  }

  const { data, error } = await supabase.from("project_expenses").update(updates).eq("id", req.params.id).select("*, projects(id, name, job_number)").single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/expenses/:id
router.delete("/api/expenses/:id", requireAuth, async (req, res) => {
  const { data: existing } = await supabase.from("project_expenses").select("user_id, receipt_key, expense_claims(status)").eq("id", req.params.id).single();
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.user_id !== req.user.id) return res.status(403).json({ error: "Not authorised" });
  if (!["draft", "rejected"].includes(existing.expense_claims?.status)) return res.status(403).json({ error: "Only items in a draft or returned claim can be deleted" });

  if (existing.receipt_key) {
    try { await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: existing.receipt_key })); }
    catch (e) { console.error("R2 receipt delete error:", e.message); }
  }
  const { error } = await supabase.from("project_expenses").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// A receipt must be a PDF or image. Detect the real type from the file's
// magic bytes rather than trusting the client-supplied mimeType.
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024; // 10 MB
function sniffReceiptType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.slice(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (buf.slice(4, 8).toString("latin1") === "ftyp") {
    const brand = buf.slice(8, 12).toString("latin1");
    if (["heic", "heif", "mif1", "heix"].includes(brand)) return "image/heic";
  }
  return null;
}

// POST /api/expenses/:id/receipt
router.post("/api/expenses/:id/receipt", requireAuth, async (req, res) => {
  const { content, filename } = req.body;
  if (!content || !filename) return res.status(400).json({ error: "content and filename required" });
  const { data: existing } = await supabase.from("project_expenses").select("user_id, expense_claims(status)").eq("id", req.params.id).single();
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.user_id !== req.user.id) return res.status(403).json({ error: "Not authorised" });
  if (!["draft", "rejected"].includes(existing.expense_claims?.status)) return res.status(403).json({ error: "Only items in a draft or returned claim can have receipts updated" });

  const buffer = Buffer.from(content.replace(/^data:[^;]+;base64,/, ""), "base64");
  if (buffer.length > MAX_RECEIPT_BYTES) return res.status(400).json({ error: "Receipt must be 10 MB or smaller" });
  const detectedType = sniffReceiptType(buffer);
  if (!detectedType) return res.status(400).json({ error: "Receipt must be a PDF or image (JPG, PNG, WEBP or HEIC)" });

  const key = `expenses/${req.user.id}/${req.params.id}/${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: detectedType }));
  const { error } = await supabase.from("project_expenses").update({ receipt_key: key, updated_at: new Date().toISOString() }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, key });
});

// GET /api/expenses/:id/receipt
router.get("/api/expenses/:id/receipt", requireAuth, async (req, res) => {
  const { data: existing } = await supabase.from("project_expenses").select("user_id, receipt_key").eq("id", req.params.id).single();
  if (!existing?.receipt_key) return res.status(404).json({ error: "No receipt" });
  const isOwner = existing.user_id === req.user.id;
  const isAdm   = req.user?.app_metadata?.role === "admin";
  if (!isOwner && !isAdm) return res.status(403).json({ error: "Not authorised" });
  try {
    const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: existing.receipt_key }));
    const chunks = []; for await (const c of obj.Body) chunks.push(c);
    res.set("Content-Type", obj.ContentType || "application/octet-stream");
    res.set("Content-Disposition", `attachment; filename="${existing.receipt_key.split("/").pop()}"`);
    res.send(Buffer.concat(chunks));
  } catch (e) {
    res.status(500).json({ error: "Could not retrieve receipt" });
  }
});

// ── Admin expenses ─────────────────────────────────────────────────────────────

// GET /api/admin/expenses/settings  — must be before /api/admin/expenses/:id
router.get("/api/admin/expenses/settings", requireAuth, requireAdmin, async (req, res) => {
  res.json({ mileage_rate_ppm: await getMileageRatePpm() });
});

// PUT /api/admin/expenses/settings
router.put("/api/admin/expenses/settings", requireAuth, requireAdmin, async (req, res) => {
  const rate = parseInt(req.body.mileage_rate_ppm);
  if (!Number.isInteger(rate) || rate < 1 || rate > 200) {
    return res.status(400).json({ error: "mileage_rate_ppm must be an integer between 1 and 200" });
  }
  const { error } = await supabase.from("app_settings").upsert(
    { key: "mileage_rate_ppm", value: String(rate), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, mileage_rate_ppm: rate });
});

// GET /api/admin/notification-settings
router.get("/api/admin/notification-settings", requireAuth, requireAdmin, async (req, res) => {
  res.json(await getNotificationSettings());
});

// PUT /api/admin/notification-settings
router.put("/api/admin/notification-settings", requireAuth, requireAdmin, async (req, res) => {
  const incoming = req.body || {};
  const settings = {};
  for (const k of NOTIFICATION_KEYS) settings[k] = normaliseNotificationValue(k, incoming[k]);
  const { error } = await supabase.from("app_settings").upsert(
    { key: "notification_settings", value: JSON.stringify(settings), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json(settings);
});

// GET /api/admin/timesheet-reminder
router.get("/api/admin/timesheet-reminder", requireAuth, requireAdmin, async (req, res) => {
  res.json(await getReminderSettings());
});

// PUT /api/admin/timesheet-reminder
router.put("/api/admin/timesheet-reminder", requireAuth, requireAdmin, async (req, res) => {
  const b = req.body || {};
  const cur = await getReminderSettings();
  const settings = {
    enabled: typeof b.enabled === "boolean" ? b.enabled : cur.enabled,
    day: [1, 2, 3, 4, 5].includes(Number(b.day)) ? Number(b.day) : cur.day,
    time: /^([01]\d|2[0-3]):(00|30)$/.test(b.time) ? b.time : cur.time,
    track_from: /^\d{4}-\d{2}-\d{2}$/.test(b.track_from) ? b.track_from : cur.track_from,
  };
  const { error } = await supabase.from("app_settings").upsert(
    { key: "timesheet_reminder", value: JSON.stringify(settings), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json(settings);
});

// POST /api/admin/timesheet-reminder/test → send only to the requesting admin
router.post("/api/admin/timesheet-reminder/test", requireAuth, requireAdmin, async (req, res) => {
  try {
    const sent = await runTimesheetReminders(req.user.id);
    res.json({ ok: true, sent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/hr-report
router.get("/api/admin/hr-report", requireAuth, requireAdmin, async (req, res) => {
  res.json(await getHrReportSettings());
});

// PUT /api/admin/hr-report
router.put("/api/admin/hr-report", requireAuth, requireAdmin, async (req, res) => {
  const b = req.body || {};
  const cur = await getHrReportSettings();
  const settings = {
    enabled: typeof b.enabled === "boolean" ? b.enabled : cur.enabled,
    day: [1, 2, 3, 4, 5].includes(Number(b.day)) ? Number(b.day) : cur.day,
    time: /^([01]\d|2[0-3]):(00|30)$/.test(b.time) ? b.time : cur.time,
    coverage: ["previous", "current"].includes(b.coverage) ? b.coverage : cur.coverage,
  };
  const { error } = await supabase.from("app_settings").upsert(
    { key: "hr_report", value: JSON.stringify(settings), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json(settings);
});

// POST /api/admin/hr-report/test → generate now and send only to the requesting admin
router.post("/api/admin/hr-report/test", requireAuth, requireAdmin, async (req, res) => {
  try {
    const sent = await runHrReport(req.user.email);
    res.json({ ok: true, sent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Admin expense claims ───────────────────────────────────────────────────────

// GET /api/admin/expense-claims?status=submitted
router.get("/api/admin/expense-claims", requireAuth, requireAdmin, async (req, res) => {
  const { status } = req.query;
  let query = supabase
    .from("expense_claims")
    .select("*, project_expenses(*, projects(id, name, job_number))")
    .order("submitted_at", { ascending: false })
    .limit(500);
  if (status && status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) return serverError(res, error, "GET /api/admin/expense-claims");
  res.json((data || []).map(c => ({ ...c, total_pence: claimTotalPence(c.project_expenses) })));
});

// POST /api/admin/expense-claims/:id/approve
router.post("/api/admin/expense-claims/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabase.from("expense_claims")
    .update({ status: "approved", reviewed_by: req.user.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", req.params.id).select("*, project_expenses(amount_pence)").single();
  if (error) return serverError(res, error, "approve claim");
  await notifyClaimDecision(data, "approved");
  res.json(data);
});

// POST /api/admin/expense-claims/:id/reject
router.post("/api/admin/expense-claims/:id/reject", requireAuth, requireAdmin, async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: "reason required" });
  const { data, error } = await supabase.from("expense_claims")
    .update({ status: "rejected", rejection_reason: reason.trim(), reviewed_by: req.user.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", req.params.id).select("*, project_expenses(amount_pence)").single();
  if (error) return serverError(res, error, "reject claim");
  await notifyClaimDecision(data, "rejected", reason.trim());
  res.json(data);
});

// GET /api/admin/expense-claims/:id/pdf — assembled claim PDF (summary + receipts)
router.get("/api/admin/expense-claims/:id/pdf", requireAuth, requireAdmin, async (req, res) => {
  const { data: claim } = await supabase.from("expense_claims")
    .select("*, project_expenses(*, projects(id, name, job_number))")
    .eq("id", req.params.id).single();
  if (!claim) return res.status(404).json({ error: "Not found" });
  try {
    const submitterEmail = await getUserEmail(claim.user_id);
    const { pdfBytes } = await buildClaimPdf({ claim, items: claim.project_expenses || [], submitterEmail, fetchReceipt });
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `inline; filename="expense-claim-${String(claim.id).slice(0, 8)}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (e) {
    return serverError(res, e, "GET /api/admin/expense-claims/:id/pdf");
  }
});

module.exports = router;
