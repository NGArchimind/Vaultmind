// Quiz endpoints — Approved Documents (AI-generated) and CSCS (PDF-parsed).
// Extracted verbatim from index.js; paths and behaviour unchanged.
const express = require("express");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { supabase, r2, BUCKET } = require("../helpers/clients");
const { serverError } = require("../helpers/serverError");
const { GEMINI_BASE } = require("../helpers/gemini");

const router = express.Router();

// GET /api/quiz/questions — fetch questions for quiz
// Query params: type ('approved_docs'|'cscs'), vault_name (optional), document_name (optional)
router.get("/api/quiz/questions", requireAuth, async (req, res) => {
  try {
    const { type, vault_name, document_name } = req.query;
    if (!type) return res.status(400).json({ error: "type is required" });

    let query = supabase.from("quiz_questions").select("*").eq("type", type);
    if (vault_name) query = query.eq("vault_name", vault_name);
    if (document_name) query = query.eq("document_name", document_name);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ questions: data });
  } catch (err) {
    return serverError(res, err, "GET /api/quiz/questions");
  }
});

// GET /api/quiz/settings — read-only quiz config for any signed-in user
// (mirrors the admin route below, but without requireAdmin so regular users
//  can discover which vault holds the Approved Documents questions)
router.get("/api/quiz/settings", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("key, value")
      .eq("key", "quiz_ad_vault_name")
      .single();
    if (error && error.code !== "PGRST116") throw error; // PGRST116 = no rows
    res.json({ quiz_ad_vault_name: data ? data.value : null });
  } catch (err) {
    return serverError(res, err, "GET /api/quiz/settings");
  }
});

// GET /api/admin/quiz/settings — get quiz configuration
router.get("/api/admin/quiz/settings", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("key, value")
      .eq("key", "quiz_ad_vault_name")
      .single();
    if (error && error.code !== "PGRST116") throw error; // PGRST116 = no rows
    res.json({ quiz_ad_vault_name: data ? data.value : null });
  } catch (err) {
    return serverError(res, err, "GET /api/admin/quiz/settings");
  }
});

// PUT /api/admin/quiz/settings — set the AD quiz vault
router.put("/api/admin/quiz/settings", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { quiz_ad_vault_name } = req.body;
    if (!quiz_ad_vault_name) return res.status(400).json({ error: "quiz_ad_vault_name required" });

    const { error } = await supabase.from("app_settings").upsert({
      key: "quiz_ad_vault_name",
      value: quiz_ad_vault_name,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    return serverError(res, err, "PUT /api/admin/quiz/settings");
  }
});

// POST /api/quiz/answer — record a quiz answer
router.post("/api/quiz/answer", requireAuth, async (req, res) => {
  try {
    const { quiz_type, is_correct } = req.body;
    if (!quiz_type || is_correct === undefined) {
      return res.status(400).json({ error: "quiz_type and is_correct required" });
    }
    if (typeof is_correct !== "boolean") {
      return res.status(400).json({ error: "is_correct must be a boolean" });
    }

    const userId = req.user.id;

    // Fetch current row (if any)
    const { data: existing, error: fetchError } = await supabase
      .from("quiz_stats")
      .select("id, correct_count, incorrect_count")
      .eq("user_id", userId)
      .eq("quiz_type", quiz_type)
      .single();
    if (fetchError && fetchError.code !== "PGRST116") throw fetchError;

    const correct_count = (existing?.correct_count ?? 0) + (is_correct ? 1 : 0);
    const incorrect_count = (existing?.incorrect_count ?? 0) + (is_correct ? 0 : 1);

    const { error } = await supabase.from("quiz_stats").upsert({
      user_id: userId,
      quiz_type,
      correct_count,
      incorrect_count,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,quiz_type" });
    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    return serverError(res, err, "POST /api/quiz/answer");
  }
});

// GET /api/admin/quiz/stats — all users' quiz tallies (admin only)
router.get("/api/admin/quiz/stats", requireAuth, requireAdmin, async (req, res) => {
  try {
    // Fetch all stats rows
    const { data: stats, error: statsErr } = await supabase
      .from("quiz_stats")
      .select("user_id, quiz_type, correct_count, incorrect_count");
    if (statsErr) throw statsErr;

    // Fetch all users for email lookup
    const { data: usersData, error: usersErr } = await supabase.auth.admin.listUsers();
    if (usersErr) throw usersErr;

    const emailMap = {};
    usersData.users.forEach(u => { emailMap[u.id] = u.email; });

    // Collate into one row per user
    const byUser = {};
    stats.forEach(row => {
      if (!byUser[row.user_id]) {
        byUser[row.user_id] = {
          user_id: row.user_id,
          email: emailMap[row.user_id] || "(deleted user)",
          ad_correct: 0, ad_incorrect: 0,
          cscs_correct: 0, cscs_incorrect: 0,
        };
      }
      if (row.quiz_type === "approved_docs") {
        byUser[row.user_id].ad_correct = row.correct_count;
        byUser[row.user_id].ad_incorrect = row.incorrect_count;
      } else if (row.quiz_type === "cscs") {
        byUser[row.user_id].cscs_correct = row.correct_count;
        byUser[row.user_id].cscs_incorrect = row.incorrect_count;
      }
    });

    res.json({ stats: Object.values(byUser) });
  } catch (err) {
    return serverError(res, err, "GET /api/admin/quiz/stats");
  }
});

// POST /api/admin/quiz/generate — generate questions for one AD document via Gemini
router.post("/api/admin/quiz/generate", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { vault_name, document_name } = req.body;
    if (!vault_name || !document_name) {
      return res.status(400).json({ error: "vault_name and document_name required" });
    }

    // 1. Fetch the PDF from R2
    const key = `${vault_name}/${document_name}`;
    let pdfBuffer;
    try {
      const pdfResult = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      const chunks = [];
      for await (const chunk of pdfResult.Body) chunks.push(chunk);
      pdfBuffer = Buffer.concat(chunks);
    } catch (r2Err) {
      if (r2Err.name === "NoSuchKey") {
        return res.status(404).json({ error: `Document not found in storage: ${key}` });
      }
      throw r2Err;
    }

    // 2. Extract text using mupdf — same pattern as /api/extract-text
    let extractedText = "";
    try {
      const mupdf = await import("mupdf");
      const doc = new mupdf.PDFDocument(pdfBuffer);
      const pageCount = doc.countPages();
      const pages = [];

      for (let i = 0; i < pageCount; i++) {
        const page = doc.loadPage(i);
        try {
          const structured = page.toStructuredText("preserve-whitespace");
          const text = structured.asText();
          pages.push({ page: i + 1, text: text.trim() });
        } catch (_) {
          pages.push({ page: i + 1, text: "" });
        }
      }

      extractedText = pages.map(p => `[Page ${p.page}]\n${p.text}`).join("\n\n");
    } catch (mupdfErr) {
      console.warn("mupdf text extraction failed in /api/admin/quiz/generate:", mupdfErr.message);
    }

    if (!extractedText.trim()) {
      return res.status(422).json({ error: "Could not extract text from this PDF." });
    }

    // 3. Ask Gemini to generate questions
    const prompt = `You are a building regulations expert. Based on the following document text, generate 25 multiple choice quiz questions.

Each question must:
- Test specific, actionable knowledge (dimensions, thresholds, classifications, explicit rules)
- Have exactly 4 options labelled A, B, C, D with exactly one correct answer
- Include a brief explanation (1-2 sentences) of why the answer is correct, citing the relevant clause

Return ONLY a valid JSON array with no markdown, code fences, or commentary. Use exactly this format:
[{
  "question_text": "...",
  "options": [
    {"label": "A", "text": "...", "is_correct": false},
    {"label": "B", "text": "...", "is_correct": true},
    {"label": "C", "text": "...", "is_correct": false},
    {"label": "D", "text": "...", "is_correct": false}
  ],
  "explanation": "...",
  "source_clause": "..."
}]

Document text:
${extractedText.slice(0, 80000)}`;

    const geminiRes = await fetch(`${GEMINI_BASE}/gemini-2.5-flash:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4 },
      }),
    });
    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return res.status(502).json({ error: "Gemini error: " + errText });
    }
    const geminiJson = await geminiRes.json();
    const candidate = geminiJson.candidates?.[0];
    if (!candidate) {
      return res.status(502).json({ error: "Gemini returned no candidates", detail: geminiJson.promptFeedback || null });
    }
    if (candidate.finishReason && candidate.finishReason !== "STOP") {
      return res.status(502).json({ error: `Gemini stopped early: ${candidate.finishReason}` });
    }
    const rawText = candidate.content?.parts?.[0]?.text || "";

    let questions;
    try {
      const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      questions = JSON.parse(cleaned);
    } catch (parseErr) {
      return res.status(502).json({ error: "Failed to parse Gemini response as JSON", raw: rawText.slice(0, 500) });
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(502).json({ error: "Gemini returned no questions" });
    }
    const validQuestions = questions.filter(q =>
      q.question_text && Array.isArray(q.options) && q.options.length === 4
    );
    if (validQuestions.length === 0) {
      return res.status(502).json({ error: "Gemini returned no valid questions (expected options array of length 4)" });
    }

    // 4. Clear existing questions for this document then insert new ones
    const { error: deleteErr } = await supabase.from("quiz_questions")
      .delete()
      .eq("type", "approved_docs")
      .eq("vault_name", vault_name)
      .eq("document_name", document_name);
    if (deleteErr) throw deleteErr;

    const rows = validQuestions.map(q => ({
      type: "approved_docs",
      vault_name,
      document_name,
      question_text: q.question_text,
      options: q.options,
      explanation: q.explanation || null,
      source_clause: q.source_clause || null,
    }));

    const { error: insertErr } = await supabase.from("quiz_questions").insert(rows);
    if (insertErr) throw insertErr;

    res.json({ ok: true, count: rows.length });
  } catch (err) {
    return serverError(res, err, "POST /api/admin/quiz/generate");
  }
});

// DELETE /api/admin/quiz/questions — clear questions for a document
router.delete("/api/admin/quiz/questions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { vault_name, document_name, type } = req.body;
    const VALID_TYPES = new Set(["approved_docs", "cscs"]);
    if (!type || !VALID_TYPES.has(type)) return res.status(400).json({ error: "type must be 'approved_docs' or 'cscs'" });
    if (type === "approved_docs" && !vault_name) return res.status(400).json({ error: "vault_name required when type is approved_docs" });

    let query = supabase.from("quiz_questions").delete().eq("type", type);
    if (vault_name) query = query.eq("vault_name", vault_name);
    if (document_name) query = query.eq("document_name", document_name);

    const { error } = await query;
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    return serverError(res, err, "DELETE /api/admin/quiz/questions");
  }
});

// POST /api/admin/quiz/upload-cscs — upload and parse CSCS question PDF
router.post("/api/admin/quiz/upload-cscs", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { base64 } = req.body;
    if (!base64) return res.status(400).json({ error: "base64 PDF required" });

    // 1. Extract text from PDF using mupdf — same pattern as /api/admin/quiz/generate
    const pdfBuffer = Buffer.from(base64, "base64");
    let fullText = "";
    try {
      const mupdf = await import("mupdf");
      const doc = new mupdf.PDFDocument(pdfBuffer);
      const pageCount = doc.countPages();
      const pages = [];

      for (let i = 0; i < pageCount; i++) {
        const page = doc.loadPage(i);
        try {
          const structured = page.toStructuredText("preserve-whitespace");
          const text = structured.asText();
          pages.push({ page: i + 1, text: text.trim() });
        } catch (_) {
          pages.push({ page: i + 1, text: "" });
        }
      }

      fullText = pages.map(p => `[Page ${p.page}]\n${p.text}`).join("\n\n");
    } catch (mupdfErr) {
      console.warn("mupdf text extraction failed in /api/admin/quiz/upload-cscs:", mupdfErr.message);
    }

    if (!fullText.trim()) {
      return res.status(422).json({ error: "Could not extract text from this PDF." });
    }

    // 2. Parse Q&A format
    // Handles patterns like:
    //   1. Question text
    //   a) Option A   OR   A. Option A   OR   (a) Option A
    //   b) Option B
    //   c) Option C
    //   d) Option D
    //   Answer: b   OR   Correct answer: B
    const questions = [];
    const lines = fullText.split("\n").map(l => l.trim()).filter(Boolean);
    let current = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect new question: starts with number + period/paren
      const qMatch = line.match(/^(\d+)[.)]\s+(.+)/);
      if (qMatch) {
        if (current && current.options.length === 4) questions.push(current);
        current = { question_text: qMatch[2], options: [], answer_label: null };
        continue;
      }

      // Detect option: a) / (a) / A. / A)
      const optMatch = line.match(/^[(\[]?([a-dA-D])[).\]]\s+(.+)/);
      if (optMatch && current) {
        current.options.push({ label: optMatch[1].toUpperCase(), text: optMatch[2], is_correct: false });
        continue;
      }

      // Detect answer line
      const ansMatch = line.match(/^(?:answer|correct answer|ans)[.:]\s*([a-dA-D])/i);
      if (ansMatch && current) {
        current.answer_label = ansMatch[1].toUpperCase();
        continue;
      }

      // Multi-line question text — append to current question if no options yet
      if (current && current.options.length === 0 && !line.match(/^[(\[]?[a-dA-D][).\]]/)) {
        current.question_text += " " + line;
      }
    }
    if (current && current.options.length === 4) questions.push(current);

    // 3. Mark correct answers
    const validQuestions = questions.filter(q => q.answer_label && q.options.length === 4);
    validQuestions.forEach(q => {
      q.options.forEach(opt => { opt.is_correct = opt.label === q.answer_label; });
    });

    if (validQuestions.length === 0) {
      return res.status(422).json({ error: "No questions could be parsed from this PDF. Check the format." });
    }

    // 4. Clear existing CSCS questions and insert new ones
    const { error: deleteErr } = await supabase.from("quiz_questions").delete().eq("type", "cscs");
    if (deleteErr) throw deleteErr;

    const rows = validQuestions.map(q => ({
      type: "cscs",
      vault_name: null,
      document_name: "CSCS Health & Safety Test",
      question_text: q.question_text,
      options: q.options,
      explanation: null,
      source_clause: null,
    }));

    const { error: insertErr } = await supabase.from("quiz_questions").insert(rows);
    if (insertErr) throw insertErr;

    res.json({ ok: true, count: rows.length });
  } catch (err) {
    return serverError(res, err, "POST /api/admin/quiz/upload-cscs");
  }
});

module.exports = router;
