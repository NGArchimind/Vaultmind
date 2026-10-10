// Project Map — the browsable, askable map of a project built from its synced
// emails. Reading is open to any signed-in user; building, sign-off and editing
// are admin-only. Background reading + rules: helpers/projectMap.js, lib/projectMap.js.
const express = require("express");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");
const { supabase } = require("../helpers/clients");
const { serverError } = require("../helpers/serverError");
const {
  geminiJson, loadMapItems, currentDateOf, replaceCurrent, touchItem, isMapRunning, kickMapRun,
} = require("../helpers/projectMap");
const { CATEGORIES, CATEGORY_IDS, buildMapContext, buildAskPrompt, parseAskResponse } = require("../lib/projectMap");

const router = express.Router();

async function countEmails(projectId, failed) {
  let q = supabase
    .from("project_emails")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  q = failed
    ? q.not("map_error", "is", null)
    : q.is("map_processed_at", null).is("map_error", null);
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

async function getItem(projectId, itemId) {
  const { data, error } = await supabase
    .from("project_map_items")
    .select("*")
    .eq("id", itemId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getEntry(projectId, entryId) {
  const { data, error } = await supabase
    .from("project_map_entries")
    .select("*")
    .eq("id", entryId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

router.get("/api/projects/:id/map", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [items, unreadEmails, failedEmails] = await Promise.all([
      loadMapItems(id), countEmails(id, false), countEmails(id, true),
    ]);
    res.json({ categories: CATEGORIES, items, unreadEmails, failedEmails, running: isMapRunning(id) });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// Start reading unread emails into the map (runs in the background).
router.post("/api/projects/:id/map/process", requireAuth, requireAdmin, rateLimit(10, 60_000), async (req, res) => {
  try {
    if (req.body?.retryFailed) {
      const { error } = await supabase
        .from("project_emails")
        .update({ map_error: null })
        .eq("project_id", req.params.id)
        .not("map_error", "is", null);
      if (error) throw error;
    }
    kickMapRun(req.params.id);
    res.json({ running: true });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.post("/api/projects/:id/map/ask", requireAuth, rateLimit(20, 60_000), async (req, res) => {
  const question = String(req.body?.question || "").trim().slice(0, 500);
  if (!question) return res.status(400).json({ error: "question required" });
  try {
    const items = await loadMapItems(req.params.id);
    if (items.length === 0) return res.json({ found: false, answer: "", itemIds: [] });
    const { text, included } = buildMapContext(items.map(it => ({
      category: it.category, title: it.title, current_value: it.current_value, status: it.status,
      current_date: currentDateOf(it),
      pending: (it.project_map_entries || []).filter(e => e.state === "pending"),
    })));
    const raw = await geminiJson(buildAskPrompt({ question, contextText: text }), { thinkingBudget: 2048 });
    const parsed = parseAskResponse(raw, included);
    res.json({ found: parsed.found, answer: parsed.answer, itemIds: parsed.items.map(n => items[n - 1].id) });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── Admin sign-off on a pending change ────────────────────────────────────────

// decision: "accept" (becomes current), "reject" (kept in history as not adopted),
// "split" (not the same topic — becomes its own item).
router.post("/api/projects/:id/map/entries/:eid/decide", requireAuth, requireAdmin, async (req, res) => {
  const { decision } = req.body || {};
  if (!["accept", "reject", "split"].includes(decision)) return res.status(400).json({ error: "decision must be accept, reject or split" });
  try {
    const { id, eid } = req.params;
    const entry = await getEntry(id, eid);
    if (!entry) return res.status(404).json({ error: "Entry not found" });
    if (entry.state !== "pending") return res.status(409).json({ error: "This change has already been decided" });
    const decided_at = new Date().toISOString();

    if (decision === "reject") {
      const { error } = await supabase.from("project_map_entries").update({ state: "rejected", decided_at }).eq("id", eid);
      if (error) throw error;
      await touchItem(entry.item_id);
    } else if (decision === "accept") {
      const { error: oldError } = await supabase
        .from("project_map_entries")
        .update({ state: "superseded" })
        .eq("item_id", entry.item_id)
        .eq("state", "current");
      if (oldError) throw oldError;
      const { error } = await supabase.from("project_map_entries").update({ state: "current", decided_at }).eq("id", eid);
      if (error) throw error;
      await touchItem(entry.item_id, { current_value: entry.value, status: "confirmed" });
    } else {
      const parent = await getItem(id, entry.item_id);
      const { data: row, error: itemError } = await supabase
        .from("project_map_items")
        .insert({ project_id: id, category: parent.category, title: entry.title || parent.title, current_value: entry.value })
        .select("id")
        .single();
      if (itemError) throw itemError;
      const { error } = await supabase
        .from("project_map_entries")
        .update({ item_id: row.id, state: "current", decided_at })
        .eq("id", eid);
      if (error) {
        await supabase.from("project_map_items").delete().eq("id", row.id);
        throw error;
      }
    }
    res.json({ ok: true });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// ── Admin editing ─────────────────────────────────────────────────────────────

// Edit title / category / value, or mark confirmed. A changed value is recorded
// as a manual entry so the previous wording stays in the history.
router.patch("/api/projects/:id/map/items/:iid", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id, iid } = req.params;
    const item = await getItem(id, iid);
    if (!item) return res.status(404).json({ error: "Item not found" });
    const { title, category, value, status } = req.body || {};

    const fields = {};
    if (typeof title === "string" && title.trim()) fields.title = title.trim().slice(0, 120);
    if (category !== undefined) {
      if (!CATEGORY_IDS.includes(category)) return res.status(400).json({ error: "Unknown category" });
      fields.category = category;
    }
    if (status !== undefined) {
      if (!["unconfirmed", "confirmed"].includes(status)) return res.status(400).json({ error: "Unknown status" });
      fields.status = status;
    }

    const newValue = typeof value === "string" ? value.trim().slice(0, 1000) : "";
    if (newValue && newValue !== item.current_value) {
      await replaceCurrent(id, item, {
        title: fields.title || item.title, value: newValue, quote: "", stated_by: req.user.email || "Admin",
      }, {
        type: "manual", id: null, date: new Date().toISOString().slice(0, 10), label: "Edited by admin", stated_by: "",
      }, { ...fields, status: "confirmed" });
    } else if (Object.keys(fields).length > 0) {
      await touchItem(iid, fields);
    }
    res.json({ ok: true });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

// Merge a duplicate into another item: its whole history moves across and the
// target keeps its own current value.
router.post("/api/projects/:id/map/items/:iid/merge", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id, iid } = req.params;
    const intoId = req.body?.into_item_id;
    if (!intoId || intoId === iid) return res.status(400).json({ error: "into_item_id required" });
    const [from, into] = await Promise.all([getItem(id, iid), getItem(id, intoId)]);
    if (!from || !into) return res.status(404).json({ error: "Item not found" });

    const { error: demoteError } = await supabase
      .from("project_map_entries")
      .update({ state: "superseded" })
      .eq("item_id", iid)
      .eq("state", "current");
    if (demoteError) throw demoteError;
    const { error: moveError } = await supabase
      .from("project_map_entries")
      .update({ item_id: intoId })
      .eq("item_id", iid);
    if (moveError) throw moveError;
    const { error: deleteError } = await supabase.from("project_map_items").delete().eq("id", iid);
    if (deleteError) throw deleteError;
    await touchItem(intoId);
    res.json({ ok: true });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.delete("/api/projects/:id/map/items/:iid", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from("project_map_items")
      .delete()
      .eq("id", req.params.iid)
      .eq("project_id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

module.exports = router;
