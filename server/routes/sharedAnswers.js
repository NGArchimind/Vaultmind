// Shared Answers — create a shareable answer link, and the intentionally PUBLIC
// read route (no requireAuth) used by the share page. Extracted verbatim.
const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { supabase } = require("../helpers/clients");
const { serverError } = require("../helpers/serverError");

const router = express.Router();

router.post("/api/shared-answers", requireAuth, async (req, res) => {
  try {
    const { question, answer, vault_name } = req.body;
    if (!question || !answer) return res.status(400).json({ error: "question and answer are required" });
    const { data, error } = await supabase
      .from("shared_answers")
      .insert({ question, answer, vault_name, created_by: req.user.id })
      .select("id")
      .single();
    if (error) throw error;
    res.json({ id: data.id });
  } catch (err) {
    return serverError(res, err, "POST /api/shared-answers");
  }
});

router.get("/api/shared-answers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from("shared_answers")
      .select("question, answer, vault_name, expires_at")
      .eq("id", id)
      .single();
    if (error?.code === 'PGRST116' || !data) return res.status(404).json({ error: "not_found" });
    if (error) throw error;
    if (!data.expires_at || new Date(data.expires_at) < new Date()) return res.status(404).json({ error: "not_found" });
    res.json(data);
  } catch (err) {
    return serverError(res, err, "GET /api/shared-answers/:id");
  }
});

module.exports = router;
