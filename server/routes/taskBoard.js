// Drawing review rounds (PDF merge + annotate), team members, task columns,
// and the Kanban task board. Extracted verbatim from index.js; behaviour unchanged.
const express = require("express");
const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { requireAuth } = require("../middleware/auth");
const { supabase, r2, BUCKET } = require("../helpers/clients");
const { streamToBuffer } = require("../helpers/r2");
const { serverError } = require("../helpers/serverError");

const router = express.Router();

// ── Drawing review rounds ─────────────────────────────────────────────────────

async function mergePDFs(pdfBuffers) {
  const { PDFDocument } = require("pdf-lib");
  const merged = await PDFDocument.create();
  for (const buf of pdfBuffers) {
    try {
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    } catch (e) { console.error("pdf merge page error:", e.message); }
  }
  return Buffer.from(await merged.save());
}

// GET rounds for a task (includes latest status indicator)
router.get("/api/tasks/:id/review-rounds", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("task_review_rounds")
    .select("id, round_number, status, annotations, pdf_key, created_by, reviewed_by, completed_at, created_at")
    .eq("task_id", req.params.id)
    .order("round_number");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST create new round — receives array of base64 PDFs, merges, stores in R2
router.post("/api/tasks/:id/review-rounds", requireAuth, async (req, res) => {
  const { pdfs } = req.body; // [{filename, base64}]
  if (!pdfs?.length) return res.status(400).json({ error: "pdfs array required" });

  // Get next round number
  const { data: existing } = await supabase
    .from("task_review_rounds")
    .select("round_number")
    .eq("task_id", req.params.id)
    .order("round_number", { ascending: false })
    .limit(1);
  const roundNumber = existing?.length ? existing[0].round_number + 1 : 1;

  // Merge PDFs
  const buffers = pdfs.map(p => Buffer.from(p.base64, "base64"));
  const mergedBuf = await mergePDFs(buffers).catch(err => { throw err; });

  // Upload to R2
  const pdfKey = `task-reviews/${req.params.id}/round-${roundNumber}/merged.pdf`;
  await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: pdfKey, Body: mergedBuf, ContentType: "application/pdf" }));

  const { data, error } = await supabase
    .from("task_review_rounds")
    .insert({ task_id: req.params.id, round_number: roundNumber, status: "in_review", pdf_key: pdfKey, annotations: {}, created_by: req.user.id })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET merged PDF as base64 (served through our API to avoid R2 CORS issues)
router.get("/api/review-rounds/:id/pdf", requireAuth, async (req, res) => {
  const { data: round, error } = await supabase.from("task_review_rounds").select("pdf_key").eq("id", req.params.id).single();
  if (error || !round) return res.status(404).json({ error: "Round not found" });
  try {
    const result = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: round.pdf_key }));
    const buffer = await streamToBuffer(result.Body);
    res.json({ base64: buffer.toString("base64") });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// PATCH save annotations (called on every auto-save)
router.patch("/api/review-rounds/:id", requireAuth, async (req, res) => {
  const updates = { updated_at: new Date().toISOString() };
  if ("annotations" in req.body) updates.annotations = req.body.annotations;
  const { data, error } = await supabase.from("task_review_rounds").update(updates).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST complete review
router.post("/api/review-rounds/:id/complete", requireAuth, async (req, res) => {
  const { annotations } = req.body;
  const { data, error } = await supabase
    .from("task_review_rounds")
    .update({ status: "reviewed", reviewed_by: req.user.id, completed_at: new Date().toISOString(), ...(annotations ? { annotations } : {}) })
    .eq("id", req.params.id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET comments for a round
router.get("/api/review-rounds/:id/comments", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("task_review_comments")
    .select("*")
    .eq("round_id", req.params.id)
    .order("created_at");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST add comment
router.post("/api/review-rounds/:id/comments", requireAuth, async (req, res) => {
  const { comment_text, page_number } = req.body;
  if (!comment_text?.trim()) return res.status(400).json({ error: "comment_text required" });
  const { data, error } = await supabase
    .from("task_review_comments")
    .insert({ round_id: req.params.id, author_id: req.user.id, comment_text: comment_text.trim(), page_number: page_number || 1 })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE comment
router.delete("/api/review-comments/:id", requireAuth, async (req, res) => {
  const { error } = await supabase.from("task_review_comments").delete().eq("id", req.params.id).eq("author_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Team members (any auth'd user) ───────────────────────────────────────────

router.get("/api/team-members", requireAuth, async (req, res) => {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) return res.status(500).json({ error: error.message });
  const members = (data.users || []).map(u => ({
    id: u.id,
    full_name: u.user_metadata?.full_name || u.email,
  }));
  res.json(members);
});

// ── Task columns ──────────────────────────────────────────────────────────────

const DEFAULT_TASK_COLUMNS = ["To Do", "In Progress", "Review", "Done"];

router.get("/api/projects/:id/task-columns", requireAuth, async (req, res) => {
  const projectId = req.params.id;
  let { data, error } = await supabase
    .from("task_columns")
    .select("*")
    .eq("project_id", projectId)
    .order("order_index");
  if (error) return res.status(500).json({ error: error.message });

  // Auto-seed defaults on first load
  if (!data || data.length === 0) {
    const rows = DEFAULT_TASK_COLUMNS.map((name, i) => ({ project_id: projectId, name, order_index: i }));
    const { data: seeded, error: seedErr } = await supabase.from("task_columns").insert(rows).select("*").order("order_index");
    if (seedErr) return res.status(500).json({ error: seedErr.message });
    data = seeded;
  }
  res.json(data);
});

router.post("/api/projects/:id/task-columns", requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  // Get current max order_index
  const { data: existing } = await supabase.from("task_columns").select("order_index").eq("project_id", req.params.id).order("order_index", { ascending: false }).limit(1);
  const nextOrder = existing?.length ? (existing[0].order_index + 1) : 0;
  const { data, error } = await supabase.from("task_columns").insert({ project_id: req.params.id, name: name.trim(), order_index: nextOrder }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put("/api/task-columns/:id", requireAuth, async (req, res) => {
  const updates = {};
  if ("name" in req.body) updates.name = req.body.name?.trim() || null;
  if ("order_index" in req.body) updates.order_index = req.body.order_index;
  if (!Object.keys(updates).length) return res.status(400).json({ error: "nothing to update" });
  const { data, error } = await supabase.from("task_columns").update(updates).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete("/api/task-columns/:id", requireAuth, async (req, res) => {
  // Move tasks in this column to the first other column in the same project
  const { data: col } = await supabase.from("task_columns").select("project_id").eq("id", req.params.id).single();
  if (col) {
    const { data: others } = await supabase.from("task_columns").select("id").eq("project_id", col.project_id).neq("id", req.params.id).order("order_index").limit(1);
    if (others?.length) {
      await supabase.from("tasks").update({ column_id: others[0].id }).eq("column_id", req.params.id).eq("is_deleted", false);
    }
  }
  const { error } = await supabase.from("task_columns").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

router.get("/api/projects/:id/tasks", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("project_id", req.params.id)
    .eq("is_deleted", false)
    .order("order_index");
  if (error) return res.status(500).json({ error: error.message });
  const tasks = data || [];
  if (!tasks.length) return res.json(tasks);

  // Attach latest review round status to each task
  const taskIds = tasks.map(t => t.id);
  const { data: rounds } = await supabase
    .from("task_review_rounds")
    .select("task_id, status, round_number")
    .in("task_id", taskIds)
    .order("round_number", { ascending: false });
  const latestRound = {};
  for (const r of (rounds || [])) {
    if (!latestRound[r.task_id]) latestRound[r.task_id] = r;
  }
  res.json(tasks.map(t => ({ ...t, _review: latestRound[t.id] || null })));
});

router.post("/api/projects/:id/tasks", requireAuth, async (req, res) => {
  const { column_id, title, description, assignee_id, priority, due_date } = req.body;
  if (!column_id || !title?.trim()) return res.status(400).json({ error: "column_id and title required" });
  const { data: existing } = await supabase.from("tasks").select("order_index").eq("column_id", column_id).eq("is_deleted", false).order("order_index", { ascending: false }).limit(1);
  const nextOrder = existing?.length ? (existing[0].order_index + 1) : 0;
  const { data, error } = await supabase.from("tasks").insert({
    project_id: req.params.id, column_id, title: title.trim(),
    description: description || null, assignee_id: assignee_id || null,
    priority: priority || "medium", due_date: due_date || null,
    created_by: req.user.id, order_index: nextOrder,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put("/api/tasks/:id", requireAuth, async (req, res) => {
  const updates = { updated_at: new Date().toISOString() };
  if ("column_id"    in req.body) updates.column_id    = req.body.column_id;
  if ("title"        in req.body) updates.title        = req.body.title?.trim();
  if ("description"  in req.body) updates.description  = req.body.description || null;
  if ("assignee_id"  in req.body) updates.assignee_id  = req.body.assignee_id || null;
  if ("priority"     in req.body) updates.priority     = req.body.priority;
  if ("due_date"     in req.body) updates.due_date     = req.body.due_date || null;
  if ("order_index"  in req.body) updates.order_index  = req.body.order_index;
  const { data, error } = await supabase.from("tasks").update(updates).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete("/api/tasks/:id", requireAuth, async (req, res) => {
  const { error } = await supabase.from("tasks").update({ is_deleted: true, updated_at: new Date().toISOString() }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
