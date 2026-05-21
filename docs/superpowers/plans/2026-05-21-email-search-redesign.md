# Email Search Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw-list email search with a Q&A-first interface that gives AI-generated summaries backed by cited emails, adds a right-hand preview pane, improves embedding quality, and scales to 15,000+ emails.

**Architecture:** New `POST /emails/ask` endpoint runs filter → semantic search → Gemini summarisation and returns a plain-English answer with supporting email IDs. The client renders this as an AI summary above a filtered email list with a fixed right-hand preview pane. A new paginated `GET /emails` replaces the current all-at-once load. Embedding is enriched at ingest with a structured Gemini summary that captures intent (confirmation, query, etc.) and stores an `email_type` classification.

**Tech Stack:** React (CRA), Express/Node.js, Supabase (PostgreSQL + pgvector), Google Gemini API (`gemini-2.5-flash`, `gemini-embedding-001`), `api()` wrapper in `client/src/api/client.js`.

---

## File Map

| File | What changes |
|------|-------------|
| Supabase SQL editor | Add `email_type` column; update `search_project_emails_hybrid` RPC |
| `server/index.js` | Replace `generateSemanticSummary` with `generateStructuredSummary`; add `sleep` helper; chunk ingest loop; chunk + update reembed; add paginated `GET /emails`; add `POST /emails/ask` |
| `client/src/components/ProjectsSection.jsx` | Rewrite `EmailsTab` component — new state, paginated fetch, Q&A mode, preview pane |

ArchiSync already batches at 20 emails per POST (`EMAIL_BATCH_SIZE = 20` in `Main.jsx`). No ArchiSync changes needed — the server-side chunking handles rate limiting transparently.

---

## Task 1: Database — email_type column

**Files:**
- Run in: Supabase SQL editor (Dashboard → SQL editor)

- [ ] **Step 1: Add email_type column**

Run in Supabase SQL editor:
```sql
ALTER TABLE project_emails
  ADD COLUMN IF NOT EXISTS email_type text
  CHECK (email_type IN ('confirmation','query','instruction','information','objection','other'));
```

- [ ] **Step 2: Verify column exists**

Run:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'project_emails' AND column_name = 'email_type';
```
Expected: one row with `column_name = email_type`.

- [ ] **Step 3: Commit note**

No git commit needed — this is a Supabase migration. Note in handover that the column now exists.

---

## Task 2: Database — update search_project_emails_hybrid RPC

**Files:**
- Run in: Supabase SQL editor → Functions (or SQL editor)

The existing RPC accepts `(p_project_id uuid, p_embedding vector, p_query_text text, p_limit int)`. We need to add an optional `p_email_ids uuid[]` parameter that, when provided, restricts results to those IDs.

- [ ] **Step 1: Find the current RPC definition**

In Supabase Dashboard → Database → Functions, find `search_project_emails_hybrid`. Copy the full SQL definition.

- [ ] **Step 2: Add p_email_ids parameter**

Replace the function with an updated version. The pattern to apply — add the parameter and WHERE clause to every place `project_id = p_project_id` appears in the vector_search and text_search CTEs:

```sql
CREATE OR REPLACE FUNCTION search_project_emails_hybrid(
  p_project_id uuid,
  p_embedding vector(768),
  p_query_text text,
  p_limit int,
  p_email_ids uuid[] DEFAULT NULL   -- NEW: when provided, restrict to these IDs
)
-- keep RETURNS TABLE, LANGUAGE, and body exactly as before,
-- but add this condition to EVERY CTE WHERE clause that filters by project_id:
--   AND (p_email_ids IS NULL OR id = ANY(p_email_ids))
-- Example — in vector_search CTE:
--   WHERE project_id = p_project_id
--     AND (p_email_ids IS NULL OR id = ANY(p_email_ids))
```

Apply the same `AND (p_email_ids IS NULL OR id = ANY(p_email_ids))` to the `text_search` CTE too. Keep all RRF logic unchanged.

- [ ] **Step 3: Verify RPC runs**

Test with a null p_email_ids (should behave identically to before):
```sql
SELECT * FROM search_project_emails_hybrid(
  '<any-valid-project-uuid>',
  array_fill(0::float, ARRAY[768])::vector,
  'test',
  5,
  NULL
);
```
Expected: returns rows (or empty) without error.

---

## Task 3: Server — generateStructuredSummary function

**Files:**
- Modify: `server/index.js` — replace `generateSemanticSummary` (~line 1515)

- [ ] **Step 1: Replace generateSemanticSummary with generateStructuredSummary**

Find `async function generateSemanticSummary(subject, body)` (~line 1515) and replace the entire function with:

```javascript
async function generateStructuredSummary(subject, fromName, fromAddress, body) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const prompt = `Analyse this email from an architectural practice.

Subject: ${subject}
From: ${fromName || ''} <${fromAddress || ''}>
Body: ${body.slice(0, 3000)}

Return JSON with exactly two fields:
1. "summary": 80-120 words capturing what was confirmed, decided, or requested; who sent it and their role (client, consultant, contractor, internal); any key dates, amounts, or reference numbers; related topics and technical synonyms for search.
2. "type": one of: confirmation, query, instruction, information, objection, other

Return only valid JSON. No preamble or explanation.`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 300 },
      }),
    });
    if (!response.ok) return { summary: "", type: "other" };
    const data = await response.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    const validTypes = ["confirmation","query","instruction","information","objection","other"];
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      type: validTypes.includes(parsed.type) ? parsed.type : "other",
    };
  } catch {
    return { summary: "", type: "other" };
  }
}
```

- [ ] **Step 2: Add sleep helper above generateStructuredSummary**

Add this function just above `generateStructuredSummary`:
```javascript
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

- [ ] **Step 3: Deploy to Railway and verify server starts**

Push to Railway. Check Railway logs — server should start without errors.

---

## Task 4: Server — update ingest endpoint

**Files:**
- Modify: `server/index.js` — ingest loop (~line 1575)

- [ ] **Step 1: Replace the ingest for-loop with chunked processing**

Find the section starting `for (const email of emails) {` (~line 1575) inside the ingest endpoint and replace it with:

```javascript
const INGEST_CHUNK_SIZE = 10;
const INGEST_CHUNK_DELAY_MS = 1200;
const RATE_LIMIT_WAIT_MS = 15000;

const chunks = [];
for (let i = 0; i < emails.length; i += INGEST_CHUNK_SIZE) {
  chunks.push(emails.slice(i, i + INGEST_CHUNK_SIZE));
}

for (let ci = 0; ci < chunks.length; ci++) {
  if (ci > 0) await sleep(INGEST_CHUNK_DELAY_MS);
  for (const email of chunks[ci]) {
    try {
      const cleanBody = stripReplyChain(email.body_text || "");
      let structured = { summary: "", type: "other" };
      try {
        structured = await generateStructuredSummary(
          email.subject || "",
          email.from_name || "",
          email.from_address || "",
          cleanBody
        );
      } catch (err) {
        if (err.message && err.message.includes("429")) {
          await sleep(RATE_LIMIT_WAIT_MS);
          try {
            structured = await generateStructuredSummary(
              email.subject || "",
              email.from_name || "",
              email.from_address || "",
              cleanBody
            );
          } catch { /* use defaults */ }
        }
      }

      const textForEmbedding = [
        structured.summary,
        email.subject || "",
        email.from_name || email.from_address || "",
        cleanBody,
      ].filter(Boolean).join("\n").trim();

      if (!textForEmbedding) { results.skipped++; continue; }

      const embedding = await generateEmbedding(textForEmbedding, "RETRIEVAL_DOCUMENT");

      const { error } = await supabase
        .from("project_emails")
        .upsert({
          project_id: req.params.id,
          message_id: email.message_id,
          subject: email.subject || null,
          from_address: email.from_address || null,
          from_name: email.from_name || null,
          to_addresses: email.to_addresses || [],
          cc_addresses: email.cc_addresses || [],
          sent_at: email.sent_at || null,
          body_text: email.body_text || null,
          has_attachments: email.has_attachments || false,
          attachment_names: email.attachment_names || [],
          email_type: structured.type,
          embedding,
        }, { onConflict: "project_id,message_id", ignoreDuplicates: false });

      if (error) throw error;
      results.inserted++;
    } catch (err) {
      results.errors.push({ message_id: email.message_id, error: err.message });
    }
  }
}
```

- [ ] **Step 2: Deploy and test with a small sync from ArchiSync**

Sync 2-3 test emails from ArchiSync. Check Railway logs — no rate limit errors. Check Supabase — new rows should have `email_type` set (not null).

---

## Task 5: Server — update reembed endpoint

**Files:**
- Modify: `server/index.js` — reembed endpoint (~line 1763)

- [ ] **Step 1: Replace the reembed for-loop**

Find the `for (const email of emails)` loop inside the reembed endpoint (~line 1774) and replace it with:

```javascript
const chunks = [];
for (let i = 0; i < emails.length; i += INGEST_CHUNK_SIZE) {
  chunks.push(emails.slice(i, i + INGEST_CHUNK_SIZE));
}

for (let ci = 0; ci < chunks.length; ci++) {
  if (ci > 0) await sleep(INGEST_CHUNK_DELAY_MS);
  for (const email of chunks[ci]) {
    try {
      const cleanBody = stripReplyChain(email.body_text || "");
      let structured = { summary: "", type: "other" };
      try {
        structured = await generateStructuredSummary(
          email.subject || "",
          email.from_name || "",
          email.from_address || "",
          cleanBody
        );
      } catch (err) {
        if (err.message && err.message.includes("429")) {
          await sleep(RATE_LIMIT_WAIT_MS);
          try {
            structured = await generateStructuredSummary(
              email.subject || "",
              email.from_name || "",
              email.from_address || "",
              cleanBody
            );
          } catch { /* use defaults */ }
        }
      }

      const textForEmbedding = [
        structured.summary,
        email.subject || "",
        email.from_name || email.from_address || "",
        cleanBody,
      ].filter(Boolean).join("\n").trim();

      if (!textForEmbedding) continue;

      const embedding = await generateEmbedding(textForEmbedding, "RETRIEVAL_DOCUMENT");
      const { error: updateError } = await supabase
        .from("project_emails")
        .update({ embedding, email_type: structured.type })
        .eq("id", email.id);

      if (updateError) throw updateError;
      updated++;
    } catch (err) {
      errors.push({ id: email.id, error: err.message });
    }
  }
}
```

Note: `INGEST_CHUNK_SIZE`, `INGEST_CHUNK_DELAY_MS`, and `RATE_LIMIT_WAIT_MS` are already defined from Task 4 — do not redefine them.

- [ ] **Step 2: Deploy and trigger reembed from the UI**

Push to Railway. In the Archimind app, navigate to the emails tab for a test project and click "Re-index emails". Verify in Supabase that `email_type` values are populated on existing rows after it runs.

---

## Task 6: Server — paginated GET /emails endpoint

**Files:**
- Modify: `server/index.js` — add new route before the existing `/emails/search` route

- [ ] **Step 1: Add the paginated GET endpoint**

Add this route in `server/index.js` just before `app.post("/api/projects/:id/emails/search"`:

```javascript
// GET /api/projects/:id/emails — paginated, server-side filtered
app.get("/api/projects/:id/emails", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      page = "1",
      limit = "50",
      from,
      date_from,
      date_to,
      subject,
      has_attachments,
      email_type,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    let q = supabase
      .from("project_emails")
      .select(
        "id, subject, from_address, from_name, to_addresses, cc_addresses, sent_at, has_attachments, attachment_names, email_type",
        { count: "exact" }
      )
      .eq("project_id", id)
      .order("sent_at", { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (from) q = q.or(`from_address.ilike.%${from}%,from_name.ilike.%${from}%`);
    if (date_from) q = q.gte("sent_at", date_from);
    if (date_to) q = q.lte("sent_at", date_to);
    if (subject) q = q.ilike("subject", `%${subject}%`);
    if (has_attachments === "true") q = q.eq("has_attachments", true);
    if (email_type) q = q.eq("email_type", email_type);

    const { data, error, count } = await q;
    if (error) throw error;

    res.json({ emails: data || [], total: count || 0, page: pageNum, limit: limitNum });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Test the endpoint manually**

Deploy to Railway. In browser (with auth token), test:
```
GET /api/projects/<project-id>/emails?page=1&limit=5
```
Expected: `{ emails: [...5 items], total: <n>, page: 1, limit: 5 }`.

Test with a filter:
```
GET /api/projects/<project-id>/emails?page=1&limit=5&email_type=confirmation
```
Expected: only emails with `email_type = confirmation` (or empty array if none re-embedded yet).

---

## Task 7: Server — POST /emails/ask endpoint

**Files:**
- Modify: `server/index.js` — add new route after the GET /emails route from Task 6

- [ ] **Step 1: Add the /emails/ask endpoint**

Add immediately after the `GET /emails` route:

```javascript
// POST /api/projects/:id/emails/ask — Q&A: find relevant emails and summarise
app.post("/api/projects/:id/emails/ask", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { question, filters = {}, limit = 20 } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ error: "question is required" });
    }

    // Step 1: Apply metadata filters to get email ID pool
    let q = supabase
      .from("project_emails")
      .select("id")
      .eq("project_id", id);

    if (filters.from) q = q.or(`from_address.ilike.%${filters.from}%,from_name.ilike.%${filters.from}%`);
    if (filters.date_from) q = q.gte("sent_at", filters.date_from);
    if (filters.date_to) q = q.lte("sent_at", filters.date_to);
    if (filters.subject) q = q.ilike("subject", `%${filters.subject}%`);
    if (filters.has_attachments === true) q = q.eq("has_attachments", true);
    if (filters.email_type) q = q.eq("email_type", filters.email_type);

    const { data: poolData, error: poolError } = await q;
    if (poolError) throw poolError;

    if (!poolData || poolData.length === 0) {
      return res.json({
        summary: null,
        supportingEmailIds: [],
        message: "No emails match your filters — try broadening the date range or removing filters.",
      });
    }

    const filteredIds = poolData.map(e => e.id);

    // Step 2: Expand query and embed
    const expandedQuery = await expandSearchQuery(question.trim());
    const queryEmbedding = await generateEmbedding(expandedQuery, "RETRIEVAL_QUERY");

    // Step 3: Hybrid semantic search restricted to filtered pool
    const { data: searchResults, error: searchError } = await supabase.rpc(
      "search_project_emails_hybrid",
      {
        p_project_id: id,
        p_embedding: queryEmbedding,
        p_query_text: question.trim(),
        p_limit: Math.min(limit * 3, 60),
        p_email_ids: filteredIds,
      }
    );
    if (searchError) throw searchError;

    const topResults = (searchResults || []).slice(0, limit);
    if (topResults.length === 0) {
      return res.json({
        summary: null,
        supportingEmailIds: [],
        message: "No relevant emails found for that question — try rephrasing.",
      });
    }

    const emailIds = topResults.map(r => r.id);

    // Step 4: Fetch email bodies for summarisation
    const { data: emailBodies, error: bodyError } = await supabase
      .from("project_emails")
      .select("id, subject, from_name, from_address, sent_at, body_text")
      .in("id", emailIds);
    if (bodyError) throw bodyError;

    // Step 5: Gemini summarisation
    const emailsText = (emailBodies || [])
      .map(e =>
        `Subject: ${e.subject || "(no subject)"}\nFrom: ${e.from_name || ""} <${e.from_address || ""}>\nDate: ${e.sent_at || ""}\nBody: ${(e.body_text || "").slice(0, 1200)}`
      )
      .join("\n\n---\n\n");

    let summary = null;
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    try {
      const prompt = `You are reviewing emails from an architectural practice project.
Question: ${question.trim()}

Based only on the emails provided below, answer the question directly. Summarise what was confirmed, agreed, or decided. Note any contradictions or unresolved points. If no clear answer is found, say so plainly. Keep the summary under 100 words.

Emails:
${emailsText}`;

      const geminiRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
        }),
      });
      if (geminiRes.ok) {
        const geminiData = await geminiRes.json();
        summary = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
      }
    } catch (e) {
      console.warn("Email Q&A summarisation failed:", e.message);
    }

    res.json({ summary, supportingEmailIds: emailIds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Deploy and test**

Deploy to Railway. Test with curl or a REST client:
```bash
curl -X POST https://<railway-url>/api/projects/<project-id>/emails/ask \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"question":"Did the client confirm any decisions?","filters":{},"limit":5}'
```
Expected: `{ summary: "...", supportingEmailIds: ["uuid", ...] }`.

If no emails are re-embedded yet, ask with `filters: {}` and a general question — you should still get results (the existing embeddings will be used).

---

## Task 8: Client — EmailsTab rewrite

**Files:**
- Modify: `client/src/components/ProjectsSection.jsx` — rewrite `EmailsTab` function (~line 2190)

This task rewrites the `EmailsTab` function body entirely. The functions `handleSelectEmail`, `handleDeleteEmail`, `handleDeleteAll`, and `handleReembed` are preserved (minor updates only). `EmailRow` and `EmailPreview` sub-components are updated at the end of this task.

- [ ] **Step 1: Replace the EmailsTab state block**

Find `function EmailsTab({ projectId }) {` (~line 2190) and replace everything from the opening `// ── State` comment down to (but not including) `function buildFilters()` with:

```javascript
  // ── State ──────────────────────────────────────────────────────────────────
  const [emails, setEmails] = useState([]);         // current page of emails
  const [totalEmails, setTotalEmails] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingEmails, setLoadingEmails] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selectedEmail, setSelectedEmail] = useState(null);
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [emailBody, setEmailBody] = useState(null);

  // Q&A mode
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [qaMode, setQaMode] = useState(false);            // true after a question is answered
  const [aiSummary, setAiSummary] = useState(null);
  const [supportingEmailIds, setSupportingEmailIds] = useState([]);
  const [qaMessage, setQaMessage] = useState(null);       // "no results" message
  const [qaError, setQaError] = useState(null);

  // Filters
  const [filterFrom, setFilterFrom] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const [filterHasAttachments, setFilterHasAttachments] = useState("");
  const [filterEmailType, setFilterEmailType] = useState("");

  // Admin
  const [reembedding, setReembedding] = useState(false);
  const [reembedResult, setReembedResult] = useState(null);
```

- [ ] **Step 2: Replace the mount useEffect and add loadEmails function**

Delete the old `useEffect` that loaded 1000 emails (~line 2219) and replace with:

```javascript
  const PAGE_SIZE = 50;

  function buildFilterParams() {
    const p = {};
    if (filterFrom.trim()) p.from = filterFrom.trim();
    if (filterDateFrom) p.date_from = filterDateFrom;
    if (filterDateTo) p.date_to = filterDateTo;
    if (filterSubject.trim()) p.subject = filterSubject.trim();
    if (filterHasAttachments === "yes") p.has_attachments = "true";
    if (filterEmailType) p.email_type = filterEmailType;
    return p;
  }

  async function loadEmails(pageNum, append = false) {
    if (append) setLoadingMore(true);
    else setLoadingEmails(true);
    try {
      const params = new URLSearchParams({ page: pageNum, limit: PAGE_SIZE, ...buildFilterParams() });
      const data = await api(`/api/projects/${projectId}/emails?${params}`);
      if (append) {
        setEmails(prev => [...prev, ...(data.emails || [])]);
      } else {
        setEmails(data.emails || []);
      }
      setTotalEmails(data.total || 0);
      setPage(pageNum);
    } catch (err) {
      console.error("loadEmails error:", err);
    } finally {
      setLoadingEmails(false);
      setLoadingMore(false);
    }
  }

  // Load on mount
  useEffect(() => {
    loadEmails(1);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload when filters change (not in QA mode)
  useEffect(() => {
    if (!qaMode) loadEmails(1);
  }, [filterFrom, filterDateFrom, filterDateTo, filterSubject, filterHasAttachments, filterEmailType]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Replace handleSearch with handleAsk**

Delete the old `handleSearch` and `applyFiltersToInbox` functions and replace with:

```javascript
  async function handleAsk() {
    if (!question.trim()) return;
    setAsking(true);
    setQaMode(false);
    setAiSummary(null);
    setSupportingEmailIds([]);
    setQaMessage(null);
    setQaError(null);
    setSelectedEmail(null);
    setEmailBody(null);
    try {
      const filters = {};
      if (filterFrom.trim()) filters.from = filterFrom.trim();
      if (filterDateFrom) filters.date_from = filterDateFrom;
      if (filterDateTo) filters.date_to = filterDateTo;
      if (filterSubject.trim()) filters.subject = filterSubject.trim();
      if (filterHasAttachments === "yes") filters.has_attachments = true;
      if (filterEmailType) filters.email_type = filterEmailType;

      const result = await api(`/api/projects/${projectId}/emails/ask`, {
        method: "POST",
        body: { question: question.trim(), filters, limit: 20 },
      });

      if (result.message && (!result.supportingEmailIds || result.supportingEmailIds.length === 0)) {
        setQaMessage(result.message);
        setQaMode(true);
        return;
      }

      // Fetch the supporting email metadata (we have IDs, need display fields)
      const params = new URLSearchParams({ page: 1, limit: 20 });
      const allData = await api(`/api/projects/${projectId}/emails?${params}`);
      // Filter client-side to supporting IDs (they're already in our page or we fetch fresh)
      // For simplicity: re-fetch just the emails we need via the paginated endpoint with no filters
      // then intersect — or just show what we have and let handleSelectEmail fetch the body.
      setAiSummary(result.summary);
      setSupportingEmailIds(result.supportingEmailIds || []);
      setQaMode(true);
    } catch (err) {
      setQaError(err.message);
    } finally {
      setAsking(false);
    }
  }
```

**Note:** The code block above has an incomplete fetch after getting supporting email IDs. Replace the lines after the early-return guard (after `setQaMode(true); return;`) with the complete version below. The `handleAsk` function from `// Fetch metadata` onwards should read:

```javascript
      // Fetch metadata for supporting emails. The ask endpoint returns IDs only;
      // load page 1 (limit 100) and filter client-side — safe since ≤20 IDs returned.
      const supportIds = new Set(result.supportingEmailIds || []);
      const params = new URLSearchParams({ page: 1, limit: 100 });
      const allData = await api(`/api/projects/${projectId}/emails?${params}`);
      const supportEmails = (allData.emails || []).filter(e => supportIds.has(e.id));

      setEmails(supportEmails);
      setAiSummary(result.summary);
      setSupportingEmailIds(result.supportingEmailIds || []);
      setQaMode(true);
```

- [ ] **Step 4: Update handleClearSearch**

Replace `handleClearSearch` with:

```javascript
  function handleClearResults() {
    setQaMode(false);
    setAiSummary(null);
    setSupportingEmailIds([]);
    setQaMessage(null);
    setQaError(null);
    setQuestion("");
    setSelectedEmail(null);
    setEmailBody(null);
    loadEmails(1);
  }
```

- [ ] **Step 5: Update clearFilters**

Replace `clearFilters` with:

```javascript
  function clearFilters() {
    setFilterFrom("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterSubject("");
    setFilterHasAttachments("");
    setFilterEmailType("");
    // useEffect will trigger loadEmails(1) on filter state change
  }
```

- [ ] **Step 6: Keep handleSelectEmail, handleDeleteEmail, handleDeleteAll, handleReembed unchanged**

These functions work as-is. Verify `handleDeleteEmail` removes from `emails` state (it does — no change needed).

- [ ] **Step 7: Rewrite the render return**

Find the `return (` statement of `EmailsTab` and replace the entire JSX return with a two-column layout:

```jsx
  const hasActiveFilters = filterFrom || filterDateFrom || filterDateTo || filterSubject || filterHasAttachments || filterEmailType;
  const emailTypeOptions = ["confirmation","query","instruction","information","objection","other"];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>

      {/* ── Question input bar ── */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #e8e2d9", background: "#faf8f5" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: AD_GREEN, textTransform: "uppercase", whiteSpace: "nowrap" }}>✦ Ask</span>
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAsk()}
            placeholder="Ask a question about your emails…"
            style={{ flex: 1, border: "1px solid #ddd8d0", padding: "7px 10px", fontSize: 12, color: ARC_NAVY, outline: "none", background: "#fff", fontFamily: "Inter, Arial, sans-serif" }}
          />
          <button
            onClick={handleAsk}
            disabled={asking || !question.trim()}
            style={{ background: asking ? "#999" : AD_GREEN, color: "#fff", border: "none", padding: "8px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", cursor: asking ? "default" : "pointer", whiteSpace: "nowrap" }}
          >
            {asking ? "Asking…" : "Ask"}
          </button>
          {qaMode && (
            <button
              onClick={handleClearResults}
              style={{ background: "transparent", border: "1px solid #ccc", padding: "7px 12px", fontSize: 11, color: "#666", cursor: "pointer" }}
            >
              Clear
            </button>
          )}
        </div>

        {/* ── Filter row ── */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input value={filterFrom} onChange={e => setFilterFrom(e.target.value)} placeholder="From…" style={{ border: "1px solid #ddd8d0", padding: "4px 8px", fontSize: 11, width: 120, color: ARC_NAVY, fontFamily: "Inter, Arial, sans-serif" }} />
          <input value={filterSubject} onChange={e => setFilterSubject(e.target.value)} placeholder="Subject…" style={{ border: "1px solid #ddd8d0", padding: "4px 8px", fontSize: 11, width: 140, color: ARC_NAVY, fontFamily: "Inter, Arial, sans-serif" }} />
          <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} style={{ border: "1px solid #ddd8d0", padding: "4px 8px", fontSize: 11, color: ARC_NAVY }} />
          <span style={{ fontSize: 10, color: "#999" }}>to</span>
          <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} style={{ border: "1px solid #ddd8d0", padding: "4px 8px", fontSize: 11, color: ARC_NAVY }} />
          <select value={filterHasAttachments} onChange={e => setFilterHasAttachments(e.target.value)} style={{ border: "1px solid #ddd8d0", padding: "4px 8px", fontSize: 11, color: ARC_NAVY }}>
            <option value="">Attachments: any</option>
            <option value="yes">Has attachments</option>
          </select>
          <select value={filterEmailType} onChange={e => setFilterEmailType(e.target.value)} style={{ border: "1px solid #ddd8d0", padding: "4px 8px", fontSize: 11, color: ARC_NAVY }}>
            <option value="">Type: any</option>
            {emailTypeOptions.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
          {hasActiveFilters && (
            <button onClick={clearFilters} style={{ background: "transparent", border: "none", fontSize: 11, color: AD_GREEN, cursor: "pointer", padding: "4px 6px" }}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* ── Main body: list + preview pane ── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>

        {/* ── Left: summary + email list ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid #e8e2d9" }}>

          {/* Q&A summary */}
          {qaMode && aiSummary && (
            <div style={{ padding: "12px 16px", background: "#f0f7f9", borderBottom: "1px solid #c5dde4" }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: AD_GREEN, textTransform: "uppercase", marginBottom: 4 }}>AI Summary</div>
              <p style={{ margin: 0, fontSize: 12, color: ARC_NAVY, lineHeight: 1.6 }}>{aiSummary}</p>
            </div>
          )}
          {qaMode && qaMessage && !aiSummary && (
            <div style={{ padding: "12px 16px", background: "#fff8f0", borderBottom: "1px solid #e8d8c0" }}>
              <p style={{ margin: 0, fontSize: 12, color: "#8a6040" }}>{qaMessage}</p>
            </div>
          )}
          {qaError && (
            <div style={{ padding: "12px 16px", background: "#fff0f0", borderBottom: "1px solid #e8c0c0" }}>
              <p style={{ margin: 0, fontSize: 12, color: "#c04040" }}>Error: {qaError}</p>
            </div>
          )}

          {/* Email count row */}
          <div style={{ padding: "6px 16px", fontSize: 10, color: "#999", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid #eee", background: "#faf8f5", flexShrink: 0 }}>
            {qaMode
              ? `${emails.length} supporting email${emails.length !== 1 ? "s" : ""}`
              : loadingEmails ? "Loading…" : `${totalEmails.toLocaleString()} email${totalEmails !== 1 ? "s" : ""}`}
          </div>

          {/* Email list */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loadingEmails ? (
              <div style={{ padding: 24, textAlign: "center", color: "#999", fontSize: 12 }}>Loading emails…</div>
            ) : emails.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "#999", fontSize: 12 }}>No emails found.</div>
            ) : (
              <>
                {emails.map(email => (
                  <EmailRow
                    key={email.id}
                    email={email}
                    selected={selectedEmail?.id === email.id}
                    onClick={() => handleSelectEmail(email)}
                    onDelete={() => handleDeleteEmail(email.id)}
                  />
                ))}
                {!qaMode && emails.length < totalEmails && (
                  <div style={{ padding: "12px 16px", textAlign: "center" }}>
                    <button
                      onClick={() => loadEmails(page + 1, true)}
                      disabled={loadingMore}
                      style={{ background: "transparent", border: "1px solid #ddd8d0", padding: "6px 16px", fontSize: 11, color: AD_GREEN, cursor: "pointer" }}
                    >
                      {loadingMore ? "Loading…" : `Load more (${totalEmails - emails.length} remaining)`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Right: preview pane ── */}
        <div style={{ width: 380, flexShrink: 0, overflowY: "auto", background: "#fff" }}>
          {selectedEmail ? (
            <EmailPreview
              email={selectedEmail}
              body={emailBody}
              loading={loadingEmail}
            />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#bbb", fontSize: 12 }}>
              Select an email to preview it
            </div>
          )}
        </div>

      </div>

      {/* ── Re-embed admin row ── */}
      <div style={{ padding: "8px 16px", borderTop: "1px solid #e8e2d9", background: "#faf8f5", display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={handleReembed}
          disabled={reembedding}
          style={{ background: "transparent", border: "1px solid #ddd8d0", padding: "4px 12px", fontSize: 10, color: "#888", cursor: reembedding ? "default" : "pointer", textTransform: "uppercase", letterSpacing: "0.06em" }}
        >
          {reembedding ? "Re-indexing…" : "Re-index emails"}
        </button>
        {reembedResult && <span style={{ fontSize: 11, color: "#888" }}>{reembedResult}</span>}
        <button
          onClick={handleDeleteAll}
          style={{ marginLeft: "auto", background: "transparent", border: "none", fontSize: 10, color: "#c04040", cursor: "pointer" }}
        >
          Delete all emails
        </button>
      </div>

    </div>
  );
```

- [ ] **Step 8: Update EmailRow sub-component**

Find the `function EmailRow(` sub-component and update its props and render to match the new call signature `{ email, selected, onClick, onDelete }`:

```jsx
function EmailRow({ email, selected, onClick, onDelete }) {
  const typeColors = {
    confirmation: "#0d6478", query: "#8a6040", instruction: "#5a4080",
    information: "#4a6040", objection: "#c04040", other: "#888",
  };
  return (
    <div
      onClick={onClick}
      style={{
        padding: "10px 16px",
        borderBottom: "1px solid #eee",
        cursor: "pointer",
        background: selected ? "#e8f4f7" : "#fff",
        borderLeft: selected ? `3px solid ${AD_GREEN}` : "3px solid transparent",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 2 }}>
        <span style={{ fontWeight: 600, fontSize: 12, color: ARC_NAVY }}>{email.from_name || email.from_address || "Unknown"}</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          {email.email_type && (
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: typeColors[email.email_type] || "#888", border: `1px solid ${typeColors[email.email_type] || "#888"}`, padding: "1px 5px", borderRadius: 2 }}>
              {email.email_type}
            </span>
          )}
          {email.has_attachments && <span style={{ fontSize: 10, color: "#888" }} title="Has attachments">📎</span>}
          <span style={{ fontSize: 10, color: "#999" }}>{email.sent_at ? new Date(email.sent_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}</span>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#555", marginBottom: 2 }}>{email.subject || "(no subject)"}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#999" }}>{email.from_address || ""}</span>
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{ background: "transparent", border: "none", fontSize: 10, color: "#ccc", cursor: "pointer", padding: "0 2px" }}
          title="Delete email"
        >✕</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Update EmailPreview sub-component**

Find `function EmailPreview(` and update to accept `{ email, body, loading }`:

```jsx
function EmailPreview({ email, body, loading }) {
  return (
    <div style={{ padding: 16, height: "100%", boxSizing: "border-box" }}>
      <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #eee" }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: ARC_NAVY, marginBottom: 6 }}>{email.subject || "(no subject)"}</div>
        <div style={{ fontSize: 11, color: "#666", lineHeight: 1.8 }}>
          <div><span style={{ color: "#999", width: 30, display: "inline-block" }}>From</span> {email.from_name ? `${email.from_name} <${email.from_address}>` : email.from_address}</div>
          {(email.to_addresses || []).length > 0 && (
            <div><span style={{ color: "#999", width: 30, display: "inline-block" }}>To</span> {email.to_addresses.join(", ")}</div>
          )}
          {(email.cc_addresses || []).length > 0 && (
            <div><span style={{ color: "#999", width: 30, display: "inline-block" }}>CC</span> {email.cc_addresses.join(", ")}</div>
          )}
          <div><span style={{ color: "#999", width: 30, display: "inline-block" }}>Date</span> {email.sent_at ? new Date(email.sent_at).toLocaleString("en-GB") : "—"}</div>
        </div>
      </div>
      {loading ? (
        <div style={{ color: "#999", fontSize: 12 }}>Loading…</div>
      ) : body?.error ? (
        <div style={{ color: "#c04040", fontSize: 12 }}>Could not load email body.</div>
      ) : body?.body_text ? (
        <pre style={{ fontSize: 11, color: "#444", whiteSpace: "pre-wrap", fontFamily: "Inter, Arial, sans-serif", lineHeight: 1.7, margin: 0 }}>
          {body.body_text}
        </pre>
      ) : (
        <div style={{ color: "#999", fontSize: 12 }}>No body content.</div>
      )}
    </div>
  );
}
```

- [ ] **Step 10: Deploy to Vercel and test**

Push to Vercel. Open the app, navigate to a project's Emails tab. Verify:
- Emails load paginated (50 at a time)
- Filters update the list without a page reload
- "Load more" button appears when there are more emails
- Clicking an email shows it in the right-hand preview pane
- Asking a question shows the AI summary + supporting emails
- "Clear" returns to browse mode

---

## Self-Review Notes

- All tasks reference `INGEST_CHUNK_SIZE`, `INGEST_CHUNK_DELAY_MS`, `RATE_LIMIT_WAIT_MS` — defined once in Task 4, used in Task 5. Implementer must not redefine them.
- Task 2 (RPC update) requires reading the existing RPC SQL from Supabase — exact SQL not reproducible here without access to the Supabase dashboard.
- The `handleAsk` workaround in Task 8 (loading 100 emails and filtering client-side for supporting IDs) is intentional. With ≤20 supporting emails this is efficient enough. A dedicated `/emails/by-ids` endpoint can be added later if needed.
- `emailBody` state stores the full email fetched by `handleSelectEmail`. `EmailPreview` receives it as `body` prop — null while loading, object when loaded.
- Colour constants `AD_GREEN`, `ARC_NAVY` are imported at the top of ProjectsSection.jsx — no new imports needed.
