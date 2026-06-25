// Projects domain — project CRUD, consultants, u-values, notes, todos,
// categories, project-products, transmittals/revisions (incl. transmittalPrefix),
// plus the AI-touching sub-features: drawings semantic search, agreements
// extract/ask, and email ingest/ask/search/reembed. Extracted VERBATIM from
// index.js (no logic change). NOTE: the AI sub-features call Gemini + embeddings
// — staging-test them when the Projects features are next refined.
const express = require("express");
const { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const ExcelJS = require("exceljs");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");
const { supabase, r2, BUCKET } = require("../helpers/clients");
const { listAllKeys, streamToBuffer } = require("../helpers/r2");
const { serverError } = require("../helpers/serverError");
const { indexDrawing, GEMINI_BASE } = require("../helpers/gemini");

const router = express.Router();

// ── Project routes ────────────────────────────────────────────────────────────

router.get("/api/projects", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, job_number, client, location, stage, status, created_at, custom_drawing_types")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ projects: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.get("/api/projects/:id", requireAuth, async (req, res) => {
  try {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (projectError) throw projectError;

    const { data: consultants, error: consultantsError } = await supabase
      .from("project_consultants")
      .select("*")
      .eq("project_id", req.params.id)
      .order("created_at");
    if (consultantsError) throw consultantsError;

    const { data: uvalues, error: uvaluesError } = await supabase
      .from("project_uvalues")
      .select("*")
      .eq("project_id", req.params.id);
    if (uvaluesError) throw uvaluesError;

    const { data: notes, error: notesError } = await supabase
      .from("project_notes")
      .select("*")
      .eq("project_id", req.params.id)
      .order("sort_order");
    if (notesError) throw notesError;

    res.json({ project, consultants, uvalues, notes });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.post("/api/projects", requireAuth, async (req, res) => {
  const { name, job_number, client, location, stage, description, status = "active", project_lead } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });

  try {
    const { data: project, error } = await supabase
      .from("projects")
      .insert({ name, job_number, client, location, stage, description, status, project_lead })
      .select()
      .single();
    if (error) throw error;

    const DEFAULT_UVALUES = [
      { element: "Roof", target: null, achieved: null, notes: null },
      { element: "External Wall", target: null, achieved: null, notes: null },
      { element: "Ground Floor", target: null, achieved: null, notes: null },
      { element: "Party Wall", target: null, achieved: null, notes: null },
      { element: "Windows / Glazing", target: null, achieved: null, notes: null },
      { element: "Doors", target: null, achieved: null, notes: null },
      { element: "Rooflights", target: null, achieved: null, notes: null },
    ];
    const uvalueRows = DEFAULT_UVALUES.map(u => ({ ...u, project_id: project.id }));
    await supabase.from("project_uvalues").insert(uvalueRows);

    res.json({ project });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.patch("/api/projects/:id", requireAuth, async (req, res) => {
  const { name, job_number, client, location, stage, description, status, project_lead } = req.body;
  try {
    const { data, error } = await supabase
      .from("projects")
      .update({ name, job_number, client, location, stage, description, status, project_lead, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ project: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.delete("/api/projects/:id", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── Consultants ───────────────────────────────────────────────────────────────

router.post("/api/projects/:id/consultants", requireAuth, async (req, res) => {
  const { discipline, company, contact_name, email, phone } = req.body;
  try {
    const { data, error } = await supabase
      .from("project_consultants")
      .insert({ project_id: req.params.id, discipline, company, contact_name, email, phone })
      .select()
      .single();
    if (error) throw error;
    res.json({ consultant: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.patch("/api/projects/:id/consultants/:cid", requireAuth, async (req, res) => {
  const { discipline, company, contact_name, email, phone } = req.body;
  try {
    const { data, error } = await supabase
      .from("project_consultants")
      .update({ discipline, company, contact_name, email, phone })
      .eq("id", req.params.cid)
      .eq("project_id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ consultant: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.delete("/api/projects/:id/consultants/:cid", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("project_consultants")
      .delete()
      .eq("id", req.params.cid)
      .eq("project_id", req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── U-values ──────────────────────────────────────────────────────────────────

router.patch("/api/projects/:id/uvalues/:uid", requireAuth, async (req, res) => {
  const { target, achieved, notes } = req.body;
  try {
    const { data, error } = await supabase
      .from("project_uvalues")
      .update({ target, achieved, notes })
      .eq("id", req.params.uid)
      .eq("project_id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ uvalue: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.post("/api/projects/:id/uvalues", requireAuth, async (req, res) => {
  const { element, target, achieved, notes } = req.body;
  if (!element) return res.status(400).json({ error: "element required" });
  try {
    const { data, error } = await supabase
      .from("project_uvalues")
      .insert({ project_id: req.params.id, element, target, achieved, notes })
      .select()
      .single();
    if (error) throw error;
    res.json({ uvalue: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.delete("/api/projects/:id/uvalues/:uid", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("project_uvalues")
      .delete()
      .eq("id", req.params.uid)
      .eq("project_id", req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── Project notes ─────────────────────────────────────────────────────────────

router.post("/api/projects/:id/notes", requireAuth, async (req, res) => {
  const { label, value, sort_order = 0 } = req.body;
  try {
    const { data, error } = await supabase
      .from("project_notes")
      .insert({ project_id: req.params.id, label, value, sort_order })
      .select()
      .single();
    if (error) throw error;
    res.json({ note: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.patch("/api/projects/:id/notes/:nid", requireAuth, async (req, res) => {
  const { label, value, sort_order } = req.body;
  try {
    const { data, error } = await supabase
      .from("project_notes")
      .update({ label, value, sort_order })
      .eq("id", req.params.nid)
      .eq("project_id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ note: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.delete("/api/projects/:id/notes/:nid", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("project_notes")
      .delete()
      .eq("id", req.params.nid)
      .eq("project_id", req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── Todos ─────────────────────────────────────────────────────────────────────

router.get("/api/projects/:id/todos", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("project_todos")
      .select("*")
      .eq("project_id", req.params.id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.json({ todos: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.post("/api/projects/:id/todos", requireAuth, async (req, res) => {
  const { description, assigned_to, due_date, status = "open" } = req.body;
  if (!description) return res.status(400).json({ error: "description required" });
  try {
    const { data, error } = await supabase
      .from("project_todos")
      .insert({ project_id: req.params.id, description, assigned_to, due_date: due_date || null, status })
      .select()
      .single();
    if (error) throw error;
    res.json({ todo: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.patch("/api/projects/:id/todos/:tid", requireAuth, async (req, res) => {
  const { description, assigned_to, due_date, status } = req.body;
  try {
    const { data, error } = await supabase
      .from("project_todos")
      .update({ description, assigned_to, due_date: due_date || null, status })
      .eq("id", req.params.tid)
      .eq("project_id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ todo: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.delete("/api/projects/:id/todos/:tid", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("project_todos")
      .delete()
      .eq("id", req.params.tid)
      .eq("project_id", req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── Transmittal system ────────────────────────────────────────────────────────
//
// Data model:
//   project_transmittal_issues   — one row per issue event (project_id, issue_date)
//   project_transmittal_revisions — one row per drawing per issue (issue_id, drawing_number, revision)
//   project_transmittal_settings — one row per project (notes, bforward_overrides as jsonb)
//
// B' Forward is auto-calculated as the highest revision across all issue columns
// for each drawing. It can be manually overridden (stored in bforward_overrides)
// and is flagged visually in the frontend when overridden.
//
// Revision sequence: P01, P02... → T01, T02... → C01, C02...
// Out-of-sequence detection is handled in ArchiSync before upload.

// ── Revision sequence helpers ─────────────────────────────────────────────────

// Default stage order — can be extended via admin settings in future
const DEFAULT_STAGE_ORDER = ["P", "T", "C"];

// Parse a revision string into { stage, num } e.g. "P03" → { stage: "P", num: 3 }
function parseRevision(rev) {
  if (!rev) return null;
  const match = String(rev).trim().match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;
  return { stage: match[1].toUpperCase(), num: parseInt(match[2], 10) };
}

// Compare two revisions using DEFAULT_STAGE_ORDER.
// Returns negative if a < b, 0 if equal, positive if a > b.
// Returns null if either cannot be parsed.
function compareRevisions(a, b, stageOrder = DEFAULT_STAGE_ORDER) {
  const pa = parseRevision(a);
  const pb = parseRevision(b);
  if (!pa || !pb) return null;
  const ia = stageOrder.indexOf(pa.stage);
  const ib = stageOrder.indexOf(pb.stage);
  // Unknown stages go to end
  const sa = ia === -1 ? 999 : ia;
  const sb = ib === -1 ? 999 : ib;
  if (sa !== sb) return sa - sb;
  return pa.num - pb.num;
}

// Check if newRev is the expected next revision after currentRev.
// Returns { ok: true } or { ok: false, reason: string }
function checkRevisionSequence(currentRev, newRev, stageOrder = DEFAULT_STAGE_ORDER) {
  if (!currentRev) return { ok: true }; // first revision, anything goes
  const pc = parseRevision(currentRev);
  const pn = parseRevision(newRev);
  if (!pc || !pn) return { ok: true }; // unparseable — don't block

  const ic = stageOrder.indexOf(pc.stage);
  const in_ = stageOrder.indexOf(pn.stage);

  if (pc.stage === pn.stage) {
    // Same stage — next number must be exactly +1
    if (pn.num === pc.num + 1) return { ok: true };
    if (pn.num <= pc.num) return { ok: false, reason: `Revision ${newRev} is behind current revision ${currentRev}` };
    return { ok: false, reason: `Revision ${newRev} skips from ${currentRev} — expected ${pc.stage}${String(pc.num + 1).padStart(2, "0")}` };
  }

  // Stage change — must move to next stage at 01
  const expectedNextStageIdx = ic + 1;
  if (in_ === expectedNextStageIdx && pn.num === 1) return { ok: true };

  const expectedStage = stageOrder[expectedNextStageIdx];
  if (expectedStage) {
    return { ok: false, reason: `Revision ${newRev} is out of sequence — expected ${expectedStage}01 after ${currentRev}` };
  }

  return { ok: false, reason: `Revision ${newRev} is beyond the known stage sequence` };
}

// GET /api/revision-sequence — return current stage order (practice-wide)
// For now returns the default. In future this can be stored in a settings table.
router.get("/api/revision-sequence", requireAuth, async (req, res) => {
  res.json({ stages: DEFAULT_STAGE_ORDER });
});

// POST /api/revision-check — check if a revision is in sequence
// Body: { drawing_number, project_id, new_revision }
router.post("/api/revision-check", requireAuth, async (req, res) => {
  const { drawing_number, project_id, new_revision } = req.body;
  if (!drawing_number || !project_id || !new_revision) {
    return res.status(400).json({ error: "drawing_number, project_id and new_revision required" });
  }
  try {
    const { data: drawing } = await supabase
      .from("project_drawings")
      .select("revision")
      .eq("project_id", project_id)
      .eq("drawing_number", drawing_number)
      .single();

    const currentRev = drawing?.revision || null;
    const result = checkRevisionSequence(currentRev, new_revision);
    res.json({ current_revision: currentRev, new_revision, ...result });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── recordTransmittalIssue — called after sync or manual trigger ──────────────
// Only creates a new issue record if there are actual changes (created/updated drawings).
async function recordTransmittalIssue(projectId, syncResults) {
  const changedNumbers = (syncResults || [])
    .filter(r => r.action === "updated" || r.action === "created")
    .map(r => r.drawing_number)
    .filter(Boolean);

  if (changedNumbers.length === 0) return;

  const issueDate = new Date().toISOString().slice(0, 10);

  // Create the issue record
  const { data: issue, error: issueError } = await supabase
    .from("project_transmittal_issues")
    .insert({ project_id: projectId, issue_date: issueDate })
    .select()
    .single();
  if (issueError) throw issueError;

  // Fetch current revisions for all changed drawings
  const { data: drawings, error: drawingsError } = await supabase
    .from("project_drawings")
    .select("drawing_number, revision")
    .eq("project_id", projectId)
    .in("drawing_number", changedNumbers);
  if (drawingsError) throw drawingsError;

  // Insert a revision row for each changed drawing
  const revRows = drawings.map(d => ({
    issue_id: issue.id,
    drawing_number: d.drawing_number,
    revision: d.revision || "",
  }));

  if (revRows.length > 0) {
    const { error: revError } = await supabase
      .from("project_transmittal_revisions")
      .insert(revRows);
    if (revError) throw revError;
  }

}

// ── GET /api/projects/:id/transmittal — full transmittal data for frontend render
router.get("/api/projects/:id/transmittal", requireAuth, async (req, res) => {
  try {
    const projectId = req.params.id;

    // Project info
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("name, job_number, location")
      .eq("id", projectId)
      .single();
    if (projectError) throw projectError;

    // All drawings
    const { data: drawings, error: drawingsError } = await supabase
      .from("project_drawings")
      .select("id, title, drawing_number, revision, drawing_type")
      .eq("project_id", projectId)
      .order("drawing_number", { ascending: true });
    if (drawingsError) throw drawingsError;

    // All issues in date order
    const { data: issues, error: issuesError } = await supabase
      .from("project_transmittal_issues")
      .select("id, issue_date")
      .eq("project_id", projectId)
      .order("issue_date", { ascending: true });
    if (issuesError) throw issuesError;

    // All revisions for those issues
    let revisions = [];
    if (issues.length > 0) {
      const issueIds = issues.map(i => i.id);
      const { data: revData, error: revError } = await supabase
        .from("project_transmittal_revisions")
        .select("issue_id, drawing_number, revision")
        .in("issue_id", issueIds);
      if (revError) throw revError;
      revisions = revData;
    }

    // Build revision lookup: revMap[issueId][drawingNumber] = revision
    const revMap = {};
    for (const r of revisions) {
      if (!revMap[r.issue_id]) revMap[r.issue_id] = {};
      revMap[r.issue_id][r.drawing_number] = r.revision;
    }

    // Transmittal settings (notes + B' Forward overrides)
    const { data: settings } = await supabase
      .from("project_transmittal_settings")
      .select("notes, bforward_overrides")
      .eq("project_id", projectId)
      .single();

    const bforwardOverrides = settings?.bforward_overrides || {};

    // Calculate auto B' Forward for each drawing:
    // highest revision seen across all issues for that drawing
    const autoBforward = {};
    for (const drawing of drawings) {
      const dn = drawing.drawing_number;
      if (!dn) continue;
      let highest = null;
      for (const issue of issues) {
        const rev = revMap[issue.id]?.[dn];
        if (rev) {
          if (!highest || compareRevisions(rev, highest) > 0) {
            highest = rev;
          }
        }
      }
      autoBforward[dn] = highest || "";
    }

    res.json({
      project,
      drawings,
      issues,
      revMap,
      autoBforward,
      bforwardOverrides,
      notes: settings?.notes || "",
    });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── POST /api/projects/:id/transmittal/issue — save PDF snapshot to R2
// Does NOT create a new issue column — columns are only created by ArchiSync.
router.post("/api/projects/:id/transmittal/issue", requireAuth, async (req, res) => {
  const { html } = req.body;
  if (!html) return res.status(400).json({ error: "html required" });
  try {
    const prefix = `projects/${req.params.id}/documents/transmittals/`;
    const dateStr = new Date().toISOString().slice(0, 10);
    const baseKey = `${prefix}schedule_${dateStr}`;
    const existingKeys = await listAllKeys(prefix);
    let key = `${baseKey}.html`;
    if (existingKeys.includes(key)) {
      let n = 2;
      while (existingKeys.includes(`${baseKey}_${n}.html`)) n++;
      key = `${baseKey}_${n}.html`;
    }
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key,
      Body: Buffer.from(html, "utf-8"),
      ContentType: "text/html",
    }));
    res.json({ saved: true, key });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── PATCH /api/projects/:id/transmittal/revisions — edit a single revision cell
// Body: { issue_id, drawing_number, revision }
// This is the emergency correction path — all cells editable with client-side warning.
router.patch("/api/projects/:id/transmittal/revisions", requireAuth, async (req, res) => {
  const { issue_id, drawing_number, revision } = req.body;
  if (!issue_id || !drawing_number) return res.status(400).json({ error: "issue_id and drawing_number required" });
  try {
    // Verify the issue belongs to this project
    const { data: issue, error: issueError } = await supabase
      .from("project_transmittal_issues")
      .select("id, project_id")
      .eq("id", issue_id)
      .eq("project_id", req.params.id)
      .single();
    if (issueError || !issue) return res.status(404).json({ error: "Issue not found for this project" });

    // Upsert the revision row
    const { data, error } = await supabase
      .from("project_transmittal_revisions")
      .upsert(
        { issue_id, drawing_number, revision: revision || "" },
        { onConflict: "issue_id,drawing_number" }
      )
      .select()
      .single();
    if (error) throw error;
    res.json({ revision: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── PATCH /api/projects/:id/transmittal/settings — save notes and/or B' Forward overrides
router.patch("/api/projects/:id/transmittal/settings", requireAuth, async (req, res) => {
  const { notes, bforward_overrides } = req.body;
  try {
    const upsertData = {
      project_id: req.params.id,
      updated_at: new Date().toISOString(),
    };
    if (notes !== undefined) upsertData.notes = notes;
    if (bforward_overrides !== undefined) upsertData.bforward_overrides = bforward_overrides;

    const { data, error } = await supabase
      .from("project_transmittal_settings")
      .upsert(upsertData, { onConflict: "project_id" })
      .select()
      .single();
    if (error) throw error;
    res.json({ settings: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── GET /api/projects/:id/transmittal/export/excel — generate Excel on demand
router.get("/api/projects/:id/transmittal/export/excel", requireAuth, async (req, res) => {
  try {
    const projectId = req.params.id;

    // Fetch all the same data as the GET /transmittal route
    const { data: project } = await supabase
      .from("projects")
      .select("name, job_number, location")
      .eq("id", projectId)
      .single();

    const { data: drawings } = await supabase
      .from("project_drawings")
      .select("id, title, drawing_number, revision, drawing_type")
      .eq("project_id", projectId)
      .order("drawing_number", { ascending: true });

    const { data: issues } = await supabase
      .from("project_transmittal_issues")
      .select("id, issue_date")
      .eq("project_id", projectId)
      .order("issue_date", { ascending: true });

    let revisions = [];
    if (issues && issues.length > 0) {
      const issueIds = issues.map(i => i.id);
      const { data: revData } = await supabase
        .from("project_transmittal_revisions")
        .select("issue_id, drawing_number, revision")
        .in("issue_id", issueIds);
      revisions = revData || [];
    }

    const revMap = {};
    for (const r of revisions) {
      if (!revMap[r.issue_id]) revMap[r.issue_id] = {};
      revMap[r.issue_id][r.drawing_number] = r.revision;
    }

    const { data: settings } = await supabase
      .from("project_transmittal_settings")
      .select("notes, bforward_overrides")
      .eq("project_id", projectId)
      .single();

    const bforwardOverrides = settings?.bforward_overrides || {};

    // Calculate B' Forward
    const autoBforward = {};
    for (const drawing of (drawings || [])) {
      const dn = drawing.drawing_number;
      if (!dn) continue;
      let highest = null;
      for (const issue of (issues || [])) {
        const rev = revMap[issue.id]?.[dn];
        if (rev && (!highest || compareRevisions(rev, highest) > 0)) highest = rev;
      }
      autoBforward[dn] = highest || "";
    }

    // Build Excel workbook
    const wb = new ExcelJS.Workbook();
    wb.creator = "Archimind";

    const NAVY    = "FF1a2332";
    const TEAL    = "FF2d6a4f";
    const SALMON  = "FFFFC0CB";
    const LGREY   = "FFF5F5F5";
    const HDRFILL = "FFE8E8E8";
    const WHITE   = "FFFFFFFF";
    const BORDCLR = "FFB0B0B0";

    function sf(argb) { return { type: "pattern", pattern: "solid", fgColor: { argb } }; }
    function bdr() { const s = { style: "thin", color: { argb: BORDCLR } }; return { top: s, left: s, bottom: s, right: s }; }
    function f(bold = false, size = 8, color = NAVY) { return { name: "Arial", size, bold, color: { argb: color } }; }

    const ws = wb.addWorksheet("Drawing Schedule");
    ws.pageSetup = {
      paperSize: 9, orientation: "landscape", fitToPage: true,
      fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    };

    // Fixed columns: Title (A), Drawing No (B), B'Forward (C), then issue date columns
    ws.getColumn(1).width = 48;
    ws.getColumn(2).width = 28;
    ws.getColumn(3).width = 10;
    const issueStartCol = 4;
    const totalIssues = (issues || []).length;
    for (let i = 0; i < totalIssues; i++) {
      ws.getColumn(issueStartCol + i).width = 8;
    }

    // Row 1: Banner
    ws.getRow(1).height = 20;
    const bannerEndCol = Math.max(issueStartCol + totalIssues - 1, 4);
    ws.mergeCells(1, 1, 1, bannerEndCol);
    Object.assign(ws.getCell(1, 1), {
      value: "Architectural Design and Technology",
      font: { name: "Arial", size: 11, bold: false, italic: true, color: { argb: "FFFFFFFF" } },
      fill: sf(TEAL),
      alignment: { horizontal: "center", vertical: "middle" },
    });

    // Row 2: Job number | Project description
    ws.getRow(2).height = 13;
    ws.getCell(2, 1).value = project?.job_number ? `Job Number - ${project.job_number}` : "Job Number -";
    ws.getCell(2, 1).font = f(true, 8);

    // Row 3: Site
    ws.getRow(3).height = 12;
    ws.getCell(3, 1).value = project?.location ? `Site - ${project.location}` : "";
    ws.getCell(3, 1).font = f(false, 8);

    // Row 4: Project name
    ws.getRow(4).height = 16;
    ws.getCell(4, 1).value = project?.name || "";
    ws.getCell(4, 1).font = { name: "Arial", size: 12, bold: true, color: { argb: NAVY } };

    // Row 5: Date of Issue label + Day values
    ws.getRow(5).height = 12;
    ws.getCell(5, 3).value = "Date of Issue";
    ws.getCell(5, 3).font = f(true, 8);
    (issues || []).forEach((issue, i) => {
      const d = new Date(issue.issue_date);
      const cell = ws.getCell(5, issueStartCol + i);
      cell.value = String(d.getUTCDate()).padStart(2, "0");
      cell.font = f(false, 8);
      cell.fill = sf(HDRFILL);
      cell.alignment = { horizontal: "center" };
      cell.border = bdr();
    });

    // Row 6: Month
    ws.getRow(6).height = 12;
    ws.getCell(6, 3).value = "Month";
    ws.getCell(6, 3).font = f(false, 8);
    (issues || []).forEach((issue, i) => {
      const d = new Date(issue.issue_date);
      const cell = ws.getCell(6, issueStartCol + i);
      cell.value = String(d.getUTCMonth() + 1).padStart(2, "0");
      cell.font = f(false, 8);
      cell.fill = sf(HDRFILL);
      cell.alignment = { horizontal: "center" };
      cell.border = bdr();
    });

    // Row 7: Year
    ws.getRow(7).height = 12;
    ws.getCell(7, 3).value = "Year";
    ws.getCell(7, 3).font = f(false, 8);
    (issues || []).forEach((issue, i) => {
      const d = new Date(issue.issue_date);
      const cell = ws.getCell(7, issueStartCol + i);
      cell.value = String(d.getUTCFullYear()).slice(2);
      cell.font = f(false, 8);
      cell.fill = sf(HDRFILL);
      cell.alignment = { horizontal: "center" };
      cell.border = bdr();
    });

    // Row 8: Column headers
    ws.getRow(8).height = 14;
    const headers = [
      { val: "Drawing Title", align: "left" },
      { val: "Drawing No", align: "center" },
      { val: "B' Forward", align: "center" },
    ];
    headers.forEach((h, i) => {
      const cell = ws.getCell(8, i + 1);
      cell.value = h.val;
      cell.font = f(true, 8);
      cell.fill = sf(HDRFILL);
      cell.border = bdr();
      cell.alignment = { horizontal: h.align, vertical: "middle" };
    });
    (issues || []).forEach((_, i) => {
      const cell = ws.getCell(8, issueStartCol + i);
      cell.value = "Amdts";
      cell.font = f(true, 8);
      cell.fill = sf(HDRFILL);
      cell.border = bdr();
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });

    // Drawing rows grouped by drawing_type
    const groups = {};
    for (const d of (drawings || [])) {
      const grp = (d.drawing_type || "Other").trim();
      if (!groups[grp]) groups[grp] = [];
      groups[grp].push(d);
    }

    let currentRow = 9;
    let drawIdx = 0;

    for (const [groupName, groupDrawings] of Object.entries(groups)) {
      ws.getRow(currentRow).height = 13;
      const grpEndCol = Math.max(issueStartCol + totalIssues - 1, issueStartCol);
      try { ws.mergeCells(currentRow, 1, currentRow, grpEndCol); } catch (_) {}
      const gh = ws.getCell(currentRow, 1);
      gh.value = groupName;
      gh.font = f(true, 8);
      gh.fill = sf(HDRFILL);
      gh.border = bdr();
      gh.alignment = { vertical: "middle" };
      currentRow++;

      for (const d of groupDrawings) {
        ws.getRow(currentRow).height = 12;
        const rowFill = drawIdx % 2 === 0 ? WHITE : LGREY;
        const dn = d.drawing_number;

        const bfOverride = bforwardOverrides[dn];
        const bfValue = bfOverride?.manual ? bfOverride.value : (autoBforward[dn] || "");

        const titleCell = ws.getCell(currentRow, 1);
        titleCell.value = d.title || "";
        titleCell.font = f(false, 8);
        titleCell.fill = sf(rowFill);
        titleCell.border = bdr();
        titleCell.alignment = { vertical: "middle" };

        const numCell = ws.getCell(currentRow, 2);
        numCell.value = dn || "";
        numCell.font = f(false, 8);
        numCell.fill = sf(rowFill);
        numCell.border = bdr();
        numCell.alignment = { horizontal: "center", vertical: "middle" };

        const bfCell = ws.getCell(currentRow, 3);
        bfCell.value = bfValue;
        bfCell.font = f(true, 8);
        bfCell.fill = sf(bfOverride?.manual ? SALMON : rowFill);
        bfCell.border = bdr();
        bfCell.alignment = { horizontal: "center", vertical: "middle" };

        (issues || []).forEach((issue, i) => {
          const rev = revMap[issue.id]?.[dn] || "";
          const isLatest = i === (issues.length - 1);
          const cell = ws.getCell(currentRow, issueStartCol + i);
          cell.value = rev;
          cell.font = f(!!rev && isLatest, 8);
          cell.fill = sf(isLatest ? SALMON : rowFill);
          cell.border = bdr();
          cell.alignment = { horizontal: "center", vertical: "middle" };
        });

        currentRow++;
        drawIdx++;
      }

      // Spacer row between groups
      ws.getRow(currentRow).height = 5;
      currentRow++;
    }

    // Notes row if present
    if (settings?.notes) {
      currentRow++;
      ws.getRow(currentRow).height = 12;
      ws.getCell(currentRow, 1).value = settings.notes;
      ws.getCell(currentRow, 1).font = f(false, 8);
    }

    const xlsxBuffer = await wb.xlsx.writeBuffer();
    const projectName = (project?.name || "drawing-schedule").replace(/[^a-zA-Z0-9-_]/g, "_");
    res.json({
      base64: Buffer.from(xlsxBuffer).toString("base64"),
      name: `${projectName}_drawing_schedule.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── Transmittals (Supabase legacy — kept for compatibility) ───────────────────

router.get("/api/projects/:id/transmittals", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("project_transmittals")
      .select("*")
      .eq("project_id", req.params.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ transmittals: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.post("/api/projects/:id/transmittals", requireAuth, async (req, res) => {
  const { reference, issued_to, issued_by, issue_date, notes, drawing_ids } = req.body;
  if (!reference) return res.status(400).json({ error: "reference required" });
  try {
    const { data, error } = await supabase
      .from("project_transmittals")
      .insert({
        project_id: req.params.id,
        reference,
        issued_to,
        issued_by,
        issue_date: issue_date || null,
        notes,
        drawing_ids: drawing_ids || [],
      })
      .select()
      .single();
    if (error) throw error;
    res.json({ transmittal: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── DELETE /api/projects/:id/transmittal/issues/:issueId — delete an entire issue column
// Admin only. Must be registered BEFORE the legacy transmittals/:tid route to avoid param collision.
router.delete("/api/projects/:id/transmittal/issues/:issueId", requireAuth, requireAdmin, async (req, res) => {
  const { id: projectId, issueId } = req.params;
  try {
    const { data: issue, error: issueError } = await supabase
      .from("project_transmittal_issues")
      .select("id, project_id, issue_date")
      .eq("id", issueId)
      .eq("project_id", projectId)
      .single();
    if (issueError || !issue) return res.status(404).json({ error: "Issue not found for this project" });

    const { error: revError } = await supabase
      .from("project_transmittal_revisions")
      .delete()
      .eq("issue_id", issueId);
    if (revError) throw revError;

    const { error: delError } = await supabase
      .from("project_transmittal_issues")
      .delete()
      .eq("id", issueId)
      .eq("project_id", projectId);
    if (delError) throw delError;

    res.json({ deleted: true, issue_date: issue.issue_date });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── DELETE /api/projects/:id/transmittals/files?keys=key1,key2 — batch delete R2 snapshots
// Must be registered BEFORE transmittals/:tid to avoid "files" being matched as :tid.
router.delete("/api/projects/:id/transmittals/files", requireAuth, requireAdmin, async (req, res) => {
  const { keys: keysParam } = req.query;
  if (!keysParam) return res.status(400).json({ error: "keys query param required" });
  const keys = keysParam.split(",").map(k => decodeURIComponent(k.trim())).filter(Boolean);
  if (keys.length === 0) return res.status(400).json({ error: "No keys provided" });
  const expectedPrefix = transmittalPrefix(req.params.id);
  const invalid = keys.filter(k => !k.startsWith(expectedPrefix));
  if (invalid.length > 0) return res.status(403).json({ error: "Forbidden — keys outside project transmittals folder" });
  try {
    for (const key of keys) {
      await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    }
    res.json({ deleted: keys.length });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.delete("/api/projects/:id/transmittals/:tid", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("project_transmittals")
      .delete()
      .eq("id", req.params.tid)
      .eq("project_id", req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── Project product categories ────────────────────────────────────────────────

const DEFAULT_CATEGORIES = [
  "External Walls", "Internal Partitions", "Roofing & Waterproofing",
  "Fire Stopping & Compartmentation", "Insulation", "Structural Frame",
  "Floors & Ceilings", "Curtain Walling", "Linings", "Doors & Ironmongery",
  "Windows & Glazing", "Drainage & Plumbing", "Mechanical & Ventilation",
  "Electrical", "Finishes & Fixtures", "Uncategorised",
];

router.get("/api/projects/:id/categories", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("project_product_categories")
      .select("*")
      .eq("project_id", req.params.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;

    if (data.length === 0) {
      const rows = DEFAULT_CATEGORIES.map((name, i) => ({
        project_id: req.params.id,
        name,
        sort_order: i,
      }));
      const { data: seeded, error: seedError } = await supabase
        .from("project_product_categories")
        .insert(rows)
        .select();
      if (seedError) throw seedError;
      return res.json({ categories: seeded });
    }

    res.json({ categories: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.post("/api/projects/:id/categories", requireAuth, async (req, res) => {
  const { name, sort_order = 0 } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  try {
    const { data, error } = await supabase
      .from("project_product_categories")
      .insert({ project_id: req.params.id, name, sort_order })
      .select()
      .single();
    if (error) throw error;
    res.json({ category: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.delete("/api/projects/:id/categories/:cid", requireAuth, async (req, res) => {
  try {
    let uncategorisedId = null;
    const { data: existing } = await supabase
      .from("project_product_categories")
      .select("id")
      .eq("project_id", req.params.id)
      .eq("name", "Uncategorised")
      .single();

    if (existing) {
      uncategorisedId = existing.id;
    } else {
      const { data: created, error: createError } = await supabase
        .from("project_product_categories")
        .insert({ project_id: req.params.id, name: "Uncategorised", sort_order: 999 })
        .select()
        .single();
      if (createError) throw createError;
      uncategorisedId = created.id;
    }

    if (req.params.cid !== uncategorisedId) {
      await supabase
        .from("project_products")
        .update({ category_id: uncategorisedId })
        .eq("project_id", req.params.id)
        .eq("category_id", req.params.cid);
    }

    const { error } = await supabase
      .from("project_product_categories")
      .delete()
      .eq("id", req.params.cid)
      .eq("project_id", req.params.id);
    if (error) throw error;

    res.json({ deleted: true });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── Project products (assignments) ────────────────────────────────────────────

router.get("/api/projects/:id/products", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("project_products")
      .select(`
        id,
        project_id,
        product_id,
        category_id,
        notes,
        created_at,
        products (
          id,
          name,
          manufacturer,
          product_type,
          file_key
        )
      `)
      .eq("project_id", req.params.id)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const productIds = data.map(r => r.product_id).filter(Boolean);
    let attributesMap = {};
    if (productIds.length > 0) {
      const { data: attrs } = await supabase
        .from("product_attributes")
        .select("product_id, attribute, value, unit")
        .in("product_id", productIds);
      if (attrs) {
        for (const a of attrs) {
          if (!attributesMap[a.product_id]) attributesMap[a.product_id] = [];
          attributesMap[a.product_id].push({ attribute: a.attribute, value: a.value, unit: a.unit });
        }
      }
    }

    const enriched = data.map(r => ({
      ...r,
      products: r.products ? {
        ...r.products,
        attributes: attributesMap[r.product_id] || [],
      } : null,
    }));

    res.json({ products: enriched });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.post("/api/projects/:id/products", requireAuth, async (req, res) => {
  const { product_id, category_id, notes } = req.body;
  if (!product_id) return res.status(400).json({ error: "product_id required" });
  try {
    const { data, error } = await supabase
      .from("project_products")
      .insert({ project_id: req.params.id, product_id, category_id: category_id || null, notes: notes || null })
      .select(`
        id, project_id, product_id, category_id, notes, created_at,
        products ( id, name, manufacturer, product_type, file_key )
      `)
      .single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Product already assigned to this project" });
      throw error;
    }
    res.json({ product: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.patch("/api/projects/:id/products/:pid", requireAuth, async (req, res) => {
  const { category_id, notes } = req.body;
  try {
    const { data, error } = await supabase
      .from("project_products")
      .update({ category_id: category_id || null, notes: notes !== undefined ? notes : undefined })
      .eq("id", req.params.pid)
      .eq("project_id", req.params.id)
      .select(`
        id, project_id, product_id, category_id, notes, created_at,
        products ( id, name, manufacturer, product_type, file_key )
      `)
      .single();
    if (error) throw error;
    res.json({ product: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.delete("/api/projects/:id/products/:pid", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("project_products")
      .delete()
      .eq("id", req.params.pid)
      .eq("project_id", req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── Transmittal PDF — save snapshot to R2 and return key ─────────────────────

// ── Transmittal files listing (PDF snapshots) ─────────────────────────────────
// GET /api/projects/:id/transmittals/files
function transmittalPrefix(projectId) {
  return `projects/${projectId}/documents/transmittals/`;
}

router.get("/api/projects/:id/transmittals/files", requireAuth, async (req, res) => {
  try {
    const prefix = transmittalPrefix(req.params.id);
    const keys = await listAllKeys(prefix);
    const files = keys
      .map(key => {
        const name = key.replace(prefix, "");
        if (!name.endsWith(".html")) return null;
        const label = name
          .replace("schedule_", "Issue — ")
          .replace(".html", "")
          .replace(/_(\d+)$/, " ($1)");
        return { key, name, label, type: "pdf-snapshot" };
      })
      .filter(Boolean)
      .sort((a, b) => b.name.localeCompare(a.name));
    res.json({ files });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// GET /api/projects/:id/transmittals/download?key=...
router.get("/api/projects/:id/transmittals/download", requireAuth, async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: "key required" });
  const expectedPrefix = transmittalPrefix(req.params.id);
  if (!key.startsWith(expectedPrefix)) return res.status(403).json({ error: "Forbidden" });
  try {
    const result = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const buffer = await streamToBuffer(result.Body);
    const name = key.split("/").pop();
    res.json({ base64: buffer.toString("base64"), name, contentType: "text/html" });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

module.exports = router;
