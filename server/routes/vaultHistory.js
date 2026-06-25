// Per-user log of questions asked in a vault. Server-only table (RLS deny-all);
// every row is scoped to req.user.id so a user only ever sees their own history.
// Extracted verbatim from index.js; paths and behaviour unchanged.
const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { supabase } = require("../helpers/clients");
const { serverError } = require("../helpers/serverError");

const router = express.Router();

// GET /api/vault-history?vault_id=... — this user's recent questions for a vault
router.get("/api/vault-history", requireAuth, async (req, res) => {
  try {
    const { vault_id } = req.query;
    if (!vault_id) return res.status(400).json({ error: "vault_id is required" });
    const { data, error } = await supabase
      .from("vault_question_history")
      .select("id, question, created_at")
      .eq("user_id", req.user.id)
      .eq("vault_id", vault_id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ questions: data || [] });
  } catch (err) {
    return serverError(res, err, "GET /api/vault-history");
  }
});

// POST /api/vault-history — save a question this user asked in a vault
router.post("/api/vault-history", requireAuth, async (req, res) => {
  try {
    const { vault_id, vault_name, question } = req.body || {};
    if (!vault_id || !question || !question.trim()) {
      return res.status(400).json({ error: "vault_id and question are required" });
    }
    const trimmed = question.trim().slice(0, 2000);
    // Drop any earlier identical question so re-asking bumps it to the top
    // (keeps the list a set of unique recent questions, newest first).
    await supabase
      .from("vault_question_history")
      .delete()
      .eq("user_id", req.user.id)
      .eq("vault_id", vault_id)
      .eq("question", trimmed);
    const { data, error } = await supabase
      .from("vault_question_history")
      .insert({
        user_id: req.user.id,
        vault_id,
        vault_name: vault_name || null,
        question: trimmed,
      })
      .select("id, question, created_at")
      .single();
    if (error) throw error;
    res.json({ question: data });
  } catch (err) {
    return serverError(res, err, "POST /api/vault-history");
  }
});

// DELETE /api/vault-history?vault_id=... — clear all of this user's history for a vault
router.delete("/api/vault-history", requireAuth, async (req, res) => {
  try {
    const { vault_id } = req.query;
    if (!vault_id) return res.status(400).json({ error: "vault_id is required" });
    const { error } = await supabase
      .from("vault_question_history")
      .delete()
      .eq("user_id", req.user.id)
      .eq("vault_id", vault_id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    return serverError(res, err, "DELETE /api/vault-history");
  }
});

// DELETE /api/vault-history/:id — remove a single history entry
router.delete("/api/vault-history/:id", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("vault_question_history")
      .delete()
      .eq("user_id", req.user.id)
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    return serverError(res, err, "DELETE /api/vault-history/:id");
  }
});

module.exports = router;
