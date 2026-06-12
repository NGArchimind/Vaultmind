# Agreements & Confirmations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-project Agreements & Confirmations database — extracted from minutes/email text via Gemini, reviewed by the user before saving, browsable with filters, and searchable via natural language Q&A (both inline on the tab and via the bottom bar).

**Architecture:** Two new DB tables (`project_agreements` + `project_agreement_entries`) with a parent/child relationship forming a timeline per agreement. Six new server endpoints handle CRUD, Gemini extraction, and Q&A. Two new React components (tab content + review modal) are added to the project section. The existing QABar is updated to include agreements in its context.

**Tech Stack:** Express/Node.js (server/index.js), React (CRA), Supabase/PostgreSQL, Google Gemini API (gemini-2.5-flash via direct fetch), `api()` client wrapper, design tokens from constants.js.

---

## File Map

| File | Action |
|---|---|
| Supabase SQL console | Run migration (Task 1) |
| `server/index.js` | Add 6 endpoints after existing todos routes (~line 1418) (Tasks 2–5) |
| `client/src/components/AgreementsReviewModal.jsx` | Create new (Task 6) |
| `client/src/components/AgreementsTab.jsx` | Create new (Task 7) |
| `client/src/components/ProjectsSection.jsx` | Add tab + update QABar (Tasks 8–9) |

---

## Codebase Patterns to Follow

- **All client→server calls:** use `api()` from `../api/client` — never raw fetch on the client
- **Server Gemini calls:** direct fetch to `${GEMINI_BASE}/gemini-2.5-flash:generateContent` with `x-goog-api-key: process.env.GEMINI_API_KEY` — `GEMINI_BASE` is already defined at line 130 of server/index.js
- **Auth:** `requireAuth` middleware on every route
- **RLS:** always `USING (true) WITH CHECK (true)` — never `WITH CHECK (auth.role() = 'authenticated')`
- **Colors:** import `PROJECTS_FULL`, `DESIGN_TEXT`, `DESIGN_MUTED` from `../constants` — never hardcode hex values
- **Supabase client:** already initialised as `supabase` at the top of server/index.js

---

## Task 1: SQL Migration

**Files:** Supabase dashboard → SQL Editor

- [ ] **Step 1: Run the migration**

Open the Supabase dashboard → SQL Editor → New query. Paste and run:

```sql
CREATE TABLE IF NOT EXISTS project_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  current_text text NOT NULL,
  date_agreed date NOT NULL,
  confirmed_by text NOT NULL DEFAULT '',
  others_present text NOT NULL DEFAULT '',
  source_type text NOT NULL DEFAULT 'manual' CHECK (source_type IN ('minutes','email','manual')),
  source_id uuid,
  source_label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_agreement_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES project_agreements(id) ON DELETE CASCADE,
  text text NOT NULL,
  date_agreed date NOT NULL,
  confirmed_by text NOT NULL DEFAULT '',
  others_present text NOT NULL DEFAULT '',
  source_type text NOT NULL DEFAULT 'manual' CHECK (source_type IN ('minutes','email','manual')),
  source_label text NOT NULL DEFAULT '',
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE project_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access" ON project_agreements USING (true) WITH CHECK (true);

ALTER TABLE project_agreement_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access" ON project_agreement_entries USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Verify**

In Supabase → Table Editor, confirm both `project_agreements` and `project_agreement_entries` tables appear with the correct columns.

---

## Task 2: Server — GET and POST /agreements

**Files:** Modify `server/index.js` — add after the existing todos block (~line 1418, after the `app.delete("/api/projects/:id/todos/:tid"` handler)

- [ ] **Step 1: Add the GET endpoint**

```javascript
// ── Agreements ────────────────────────────────────────────────────────────────

app.get("/api/projects/:id/agreements", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("project_agreements")
      .select(`*, project_agreement_entries(*)`)
      .eq("project_id", req.params.id)
      .order("date_agreed", { ascending: false });
    if (error) throw error;
    const agreements = (data || []).map(a => ({
      ...a,
      entries: (a.project_agreement_entries || []).sort((x, y) => new Date(x.created_at) - new Date(y.created_at)),
    }));
    res.json({ agreements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Add the POST endpoint (create new agreement)**

```javascript
app.post("/api/projects/:id/agreements", requireAuth, async (req, res) => {
  const { current_text, date_agreed, confirmed_by = "", others_present = "", source_type = "manual", source_label = "", source_id = null } = req.body;
  if (!current_text || !date_agreed) return res.status(400).json({ error: "current_text and date_agreed required" });
  try {
    const { data: agreement, error: agError } = await supabase
      .from("project_agreements")
      .insert({ project_id: req.params.id, current_text, date_agreed, confirmed_by, others_present, source_type, source_label, source_id })
      .select()
      .single();
    if (agError) throw agError;
    const { error: entError } = await supabase
      .from("project_agreement_entries")
      .insert({ agreement_id: agreement.id, text: current_text, date_agreed, confirmed_by, others_present, source_type, source_label, source_id });
    if (entError) throw entError;
    res.json({ agreement });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Commit**

```
git add server/index.js
git commit -m "feat: add GET and POST /api/projects/:id/agreements endpoints"
```

---

## Task 3: Server — Entries and Delete

**Files:** Modify `server/index.js` — add immediately after Task 2's endpoints

- [ ] **Step 1: Add POST /agreements/:aid/entries (add update to existing agreement)**

```javascript
app.post("/api/projects/:id/agreements/:aid/entries", requireAuth, async (req, res) => {
  const { text, date_agreed, confirmed_by = "", others_present = "", source_type = "manual", source_label = "" } = req.body;
  if (!text || !date_agreed) return res.status(400).json({ error: "text and date_agreed required" });
  try {
    const { error: entError } = await supabase
      .from("project_agreement_entries")
      .insert({ agreement_id: req.params.aid, text, date_agreed, confirmed_by, others_present, source_type, source_label });
    if (entError) throw entError;
    const { data: agreement, error: agError } = await supabase
      .from("project_agreements")
      .update({ current_text: text, date_agreed, confirmed_by, others_present, source_type, source_label, updated_at: new Date().toISOString() })
      .eq("id", req.params.aid)
      .eq("project_id", req.params.id)
      .select()
      .single();
    if (agError) throw agError;
    res.json({ agreement });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Add DELETE /agreements/:aid**

```javascript
app.delete("/api/projects/:id/agreements/:aid", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("project_agreements")
      .delete()
      .eq("id", req.params.aid)
      .eq("project_id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Commit**

```
git add server/index.js
git commit -m "feat: add agreement entries and delete endpoints"
```

---

## Task 4: Server — Extract Endpoint (Gemini + possible match detection)

**Files:** Modify `server/index.js` — add after Task 3's endpoints

- [ ] **Step 1: Add POST /agreements/extract**

Note: this route must be defined BEFORE `/api/projects/:id/agreements/:aid/entries` in the file or Express will try to match `"extract"` as `:aid`. Add it immediately after the GET and POST endpoints from Task 2 (before Task 3's `:aid` routes).

```javascript
app.post("/api/projects/:id/agreements/extract", requireAuth, async (req, res) => {
  const { text, source_label = "", source_type = "minutes" } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });
  try {
    const { data: existing } = await supabase
      .from("project_agreements")
      .select("id, current_text")
      .eq("project_id", req.params.id);

    const today = new Date().toISOString().slice(0, 10);
    const prompt = `You are reviewing meeting minutes or an email from an architectural practice. Extract all genuine agreements, decisions, and confirmations. Return ONLY a JSON array.

Rules:
- Include only explicit decisions: phrases like "agreed", "confirmed", "to proceed with", "it was decided", "will be"
- Exclude: action points (tasks assigned to someone), questions, general discussion, cross-references like "see attached", vague statements
- For each item extract: the agreement text (concise and self-contained), who confirmed it (name if stated, else ""), who else was present (comma-separated names, else ""), and the date it was agreed (YYYY-MM-DD format — use ${today} if not stated)

Return this exact JSON format with no other text:
[{"text":"...","confirmed_by":"...","others_present":"...","date_agreed":"YYYY-MM-DD"}]

If no genuine agreements are found, return: []

Text to analyse:
${text.slice(0, 12000)}`;

    const response = await fetch(`${GEMINI_BASE}/gemini-2.5-flash:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0 } }),
    });
    if (!response.ok) throw new Error(`Gemini ${response.status}`);
    const geminiData = await response.json();
    const raw = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    let candidates = [];
    if (jsonMatch) { try { candidates = JSON.parse(jsonMatch[0]); } catch (e) { candidates = []; } }

    // Keyword overlap: flag candidates that likely update an existing agreement
    const stopWords = new Set(["the","a","an","to","is","was","be","will","of","in","and","or","for","with","that","this","it","on","at","by","as","are","been","has","have"]);
    function sigWords(str) {
      return (str || "").toLowerCase().match(/\b\w{4,}\b/g)?.filter(w => !stopWords.has(w)) || [];
    }
    const withMatches = candidates.map(c => {
      const cSet = new Set(sigWords(c.text));
      let possible_match_id = null;
      for (const ag of (existing || [])) {
        const overlap = sigWords(ag.current_text).filter(w => cSet.has(w)).length;
        if (overlap >= 3) { possible_match_id = ag.id; break; }
      }
      return { ...c, possible_match_id };
    });

    res.json({ candidates: withMatches, source_label, source_type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Verify route order**

In server/index.js, confirm the order of agreements routes is:
1. `GET /api/projects/:id/agreements`
2. `POST /api/projects/:id/agreements`
3. `POST /api/projects/:id/agreements/extract`  ← must be before `:aid` routes
4. `POST /api/projects/:id/agreements/:aid/entries`
5. `DELETE /api/projects/:id/agreements/:aid`

- [ ] **Step 3: Commit**

```
git add server/index.js
git commit -m "feat: add agreements extract endpoint with Gemini extraction and match detection"
```

---

## Task 5: Server — Q&A Endpoint

**Files:** Modify `server/index.js` — add after Task 4's endpoint

- [ ] **Step 1: Add POST /agreements/ask**

```javascript
app.post("/api/projects/:id/agreements/ask", requireAuth, async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: "question required" });
  try {
    const { data, error } = await supabase
      .from("project_agreements")
      .select(`*, project_agreement_entries(*)`)
      .eq("project_id", req.params.id)
      .order("date_agreed", { ascending: false });
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.json({ answer: "No agreements have been recorded for this project yet." });
    }

    const ctx = data.map(a => {
      const entries = (a.project_agreement_entries || []).sort((x, y) => new Date(x.created_at) - new Date(y.created_at));
      const history = entries.length > 1
        ? `\n  Previous: ${entries.slice(0, -1).map(e => `"${e.text}" (${e.date_agreed})`).join(" → ")}`
        : "";
      return `- "${a.current_text}" — confirmed by ${a.confirmed_by || "unknown"} on ${a.date_agreed}${a.others_present ? `, others present: ${a.others_present}` : ""} [source: ${a.source_type}${a.source_label ? ` — ${a.source_label}` : ""}]${history}`;
    }).join("\n");

    const prompt = `You are a project assistant for an architectural practice. Answer the question using only the project agreements listed below. Cite agreements directly by quoting them (e.g. "As agreed on 14 May 2026 — door frames to be oak veneer..."). If no agreements are relevant to the question, say so plainly. Do not make up information not in the list.

AGREEMENTS:
${ctx}

QUESTION: ${question}`;

    const response = await fetch(`${GEMINI_BASE}/gemini-2.5-flash:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 1500 } }),
    });
    if (!response.ok) throw new Error(`Gemini ${response.status}`);
    const geminiRes = await response.json();
    const answer = geminiRes?.candidates?.[0]?.content?.parts?.[0]?.text || "No answer could be generated.";
    res.json({ answer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Deploy server to Railway and verify**

Push to Railway. Open a project in Archimind, open browser devtools Network tab, confirm no 404s on agreements routes.

- [ ] **Step 3: Commit**

```
git add server/index.js
git commit -m "feat: add agreements Q&A endpoint"
```

---

## Task 6: AgreementsReviewModal.jsx

**Files:** Create `client/src/components/AgreementsReviewModal.jsx`

- [ ] **Step 1: Create the component**

```jsx
import { useState } from "react";
import { api } from "../api/client";
import { PROJECTS_FULL, DESIGN_TEXT } from "../constants";
import { Spinner } from "./common/Spinner";

export default function AgreementsReviewModal({ projectId, candidates, sourceLabel, sourceType, onSave, onClose }) {
  const [decisions, setDecisions] = useState({});
  const [saving, setSaving] = useState(false);

  function decide(idx, choice) {
    setDecisions(prev => ({ ...prev, [idx]: prev[idx] === choice ? null : choice }));
  }

  const agreedItems = candidates.filter((_, i) => decisions[i] === "agreed");
  const discardedCount = candidates.filter((_, i) => decisions[i] === "discarded").length;
  const pendingCount = candidates.filter((_, i) => !decisions[i]).length;

  async function save() {
    if (agreedItems.length === 0 || saving) return;
    setSaving(true);
    try {
      for (const c of agreedItems) {
        if (c.possible_match_id) {
          await api(`/api/projects/${projectId}/agreements/${c.possible_match_id}/entries`, {
            method: "POST",
            body: { text: c.text, date_agreed: c.date_agreed, confirmed_by: c.confirmed_by, others_present: c.others_present, source_type: sourceType, source_label: sourceLabel },
          });
        } else {
          await api(`/api/projects/${projectId}/agreements`, {
            method: "POST",
            body: { current_text: c.text, date_agreed: c.date_agreed, confirmed_by: c.confirmed_by, others_present: c.others_present, source_type: sourceType, source_label: sourceLabel },
          });
        }
      }
      onSave();
    } catch (e) { console.error(e); }
    setSaving(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 6, width: "min(780px, 95vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.22)" }}>

        <div style={{ background: PROJECTS_FULL, padding: "14px 24px", flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.65)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>Agreements & Confirmations Found</div>
          <div style={{ fontSize: 14, color: "#fff", fontWeight: 600 }}>{candidates.length} item{candidates.length !== 1 ? "s" : ""} extracted — review each one</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 3 }}>{sourceLabel} · Agree to save, disagree to discard</div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px", background: "#f8f8fa", display: "flex", flexDirection: "column", gap: 8 }}>
          {candidates.map((c, i) => {
            const state = decisions[i];
            const isAgreed = state === "agreed";
            const isDiscarded = state === "discarded";
            return (
              <div key={i} style={{ background: "#fff", border: `1px solid ${isAgreed ? "#c8e6d4" : c.possible_match_id ? "#f0c060" : "#e4e4e8"}`, borderRadius: 5, padding: "12px 16px", opacity: isDiscarded ? 0.55 : 1, display: "flex", alignItems: "flex-start", gap: 14 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, color: DESIGN_TEXT, marginBottom: 4, textDecoration: isDiscarded ? "line-through" : "none", fontSize: 13 }}>{c.text}</div>
                  <div style={{ fontSize: 11, color: "#9a9088", marginBottom: c.possible_match_id ? 6 : 0 }}>
                    {c.confirmed_by && `Confirmed by ${c.confirmed_by}`}{c.others_present && ` · Others: ${c.others_present}`}
                  </div>
                  {c.possible_match_id && (
                    <div style={{ fontSize: 11, background: "#fef9ec", color: "#a06020", padding: "4px 8px", borderRadius: 3, border: "1px solid #f0e0a0", display: "inline-block" }}>
                      ⚠ Possible update to an existing agreement — will be added to its timeline if agreed
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                  {isAgreed && <span style={{ fontSize: 10, color: "#3e7e58", fontWeight: 600, background: "#e8f4ee", padding: "2px 8px", borderRadius: 3, letterSpacing: "0.05em" }}>AGREED</span>}
                  {isDiscarded && <span style={{ fontSize: 10, color: "#9a9088", fontWeight: 600, background: "#f0ede8", padding: "2px 8px", borderRadius: 3, letterSpacing: "0.05em" }}>DISCARDED</span>}
                  <button onClick={() => decide(i, "agreed")} style={{ background: isAgreed ? PROJECTS_FULL : "#f0ede8", color: isAgreed ? "#fff" : "#6a5a48", border: isAgreed ? "none" : "1px solid #e4e4e8", padding: "6px 14px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✓{!isAgreed && " Agree"}</button>
                  <button onClick={() => decide(i, "discarded")} style={{ background: isDiscarded ? "#c0392b" : "#f0ede8", color: isDiscarded ? "#fff" : "#6a5a48", border: isDiscarded ? "none" : "1px solid #e4e4e8", padding: "6px 14px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✕{!isDiscarded && " Disagree"}</button>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ background: "#fff", borderTop: "1px solid #e4e4e8", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: "#9a9088" }}>{agreedItems.length} agreed · {discardedCount} discarded · {pendingCount} pending</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ background: "#f0ede8", color: "#6a5a48", border: "1px solid #e4e4e8", padding: "7px 18px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            <button onClick={save} disabled={agreedItems.length === 0 || saving}
              style={{ background: agreedItems.length > 0 ? PROJECTS_FULL : "#f8f8fa", color: agreedItems.length > 0 ? "#fff" : "#9a9088", border: "none", padding: "7px 18px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: agreedItems.length > 0 ? "pointer" : "default" }}>
              {saving ? <Spinner size={11} /> : `Save agreed (${agreedItems.length})`}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```
git add client/src/components/AgreementsReviewModal.jsx
git commit -m "feat: add AgreementsReviewModal component"
```

---

## Task 7: AgreementsTab.jsx

**Files:** Create `client/src/components/AgreementsTab.jsx`

- [ ] **Step 1: Create the component**

```jsx
import { useState, useEffect } from "react";
import { api } from "../api/client";
import { PROJECTS_FULL, DESIGN_TEXT, DESIGN_MUTED } from "../constants";
import { Spinner } from "./common/Spinner";
import AgreementsReviewModal from "./AgreementsReviewModal";

export default function AgreementsTab({ projectId }) {
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  const [filterSource, setFilterSource] = useState("all");
  const [filterPerson, setFilterPerson] = useState("all");
  const [filterKeyword, setFilterKeyword] = useState("");

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newText, setNewText] = useState("");
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [newConfirmedBy, setNewConfirmedBy] = useState("");
  const [newOthers, setNewOthers] = useState("");
  const [saving, setSaving] = useState(false);

  const [showExtractInput, setShowExtractInput] = useState(false);
  const [extractText, setExtractText] = useState("");
  const [extractLabel, setExtractLabel] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [showReview, setShowReview] = useState(false);

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    try {
      const { agreements: data } = await api(`/api/projects/${projectId}/agreements`);
      setAgreements(data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function ask() {
    if (!question.trim() || asking) return;
    setAsking(true); setAnswer(null);
    try {
      const { answer: a } = await api(`/api/projects/${projectId}/agreements/ask`, {
        method: "POST", body: { question: question.trim() },
      });
      setAnswer(a);
    } catch (e) { setAnswer("Error: " + e.message); }
    setAsking(false);
  }

  async function addManual() {
    if (!newText.trim() || !newDate || saving) return;
    setSaving(true);
    try {
      await api(`/api/projects/${projectId}/agreements`, {
        method: "POST",
        body: { current_text: newText.trim(), date_agreed: newDate, confirmed_by: newConfirmedBy.trim(), others_present: newOthers.trim(), source_type: "manual" },
      });
      setNewText(""); setNewDate(new Date().toISOString().slice(0, 10)); setNewConfirmedBy(""); setNewOthers(""); setShowAddForm(false);
      await load();
    } catch (e) { console.error(e); }
    setSaving(false);
  }

  async function extract() {
    if (!extractText.trim() || extracting) return;
    setExtracting(true);
    try {
      const { candidates: c } = await api(`/api/projects/${projectId}/agreements/extract`, {
        method: "POST",
        body: { text: extractText.trim(), source_label: extractLabel.trim() || "Minutes", source_type: "minutes" },
      });
      if ((c || []).length > 0) {
        setCandidates(c); setShowReview(true); setShowExtractInput(false); setExtractText(""); setExtractLabel("");
      } else {
        alert("No agreements found in this text — try pasting more of the minutes.");
      }
    } catch (e) { console.error(e); }
    setExtracting(false);
  }

  async function deleteAgreement(id) {
    if (!window.confirm("Delete this agreement and all its history?")) return;
    try {
      await api(`/api/projects/${projectId}/agreements/${id}`, { method: "DELETE" });
      setAgreements(prev => prev.filter(a => a.id !== id));
    } catch (e) { console.error(e); }
  }

  const people = [...new Set(agreements.map(a => a.confirmed_by).filter(Boolean))].sort();

  const filtered = agreements.filter(a => {
    if (filterSource !== "all" && a.source_type !== filterSource) return false;
    if (filterPerson !== "all" && a.confirmed_by !== filterPerson) return false;
    if (filterKeyword.trim() && !a.current_text.toLowerCase().includes(filterKeyword.toLowerCase())) return false;
    return true;
  });

  const selectStyle = { border: "1px solid #e4e4e8", borderRadius: 4, padding: "5px 10px", fontSize: 11, color: "#6a5a48", background: "#fff", fontFamily: "Inter, Arial, sans-serif" };
  const inputStyle = { border: "1px solid #e4e4e8", borderRadius: 4, padding: "5px 10px", fontSize: 11, color: "#3a3632", background: "#fff", fontFamily: "Inter, Arial, sans-serif", outline: "none" };

  if (loading) return <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9a9088", fontSize: 13, padding: 24 }}><Spinner size={13} /> Loading agreements…</div>;

  return (
    <div style={{ fontFamily: "Inter, Arial, sans-serif" }}>

      {/* Q&A bar */}
      <div style={{ background: PROJECTS_FULL, padding: "12px 20px", display: "flex", alignItems: "center", gap: 10, marginBottom: 0 }}>
        <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0 }}>Ask</span>
        <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === "Enter" && ask()}
          placeholder="Ask anything about agreements on this project…"
          style={{ flex: 1, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 4, padding: "7px 12px", color: "#fff", fontSize: 12, outline: "none", fontFamily: "Inter, Arial, sans-serif" }} />
        <button onClick={ask} disabled={!question.trim() || asking}
          style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", padding: "6px 16px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: question.trim() && !asking ? "pointer" : "default", flexShrink: 0 }}>
          {asking ? <Spinner size={11} /> : "Ask"}
        </button>
        {answer && <button onClick={() => { setAnswer(null); setQuestion(""); }} style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.8)", padding: "6px 12px", borderRadius: 4, fontSize: 11, cursor: "pointer", flexShrink: 0 }}>Clear</button>}
      </div>

      {/* Inline answer */}
      {answer && (
        <div style={{ background: "#f0f7f4", border: "1px solid #c8e6d4", borderTop: "none", padding: "14px 20px" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: PROJECTS_FULL, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Answer</div>
          <div style={{ fontSize: 13, color: "#3a3632", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{answer}</div>
        </div>
      )}

      {/* Filter bar */}
      <div style={{ background: "#f8f8fa", borderBottom: "1px solid #e4e4e8", padding: "10px 20px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", marginRight: 4 }}>Filter</span>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)} style={selectStyle}>
          <option value="all">All sources</option>
          <option value="minutes">Minutes</option>
          <option value="email">Email</option>
          <option value="manual">Manual</option>
        </select>
        <select value={filterPerson} onChange={e => setFilterPerson(e.target.value)} style={selectStyle}>
          <option value="all">All people</option>
          {people.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <input value={filterKeyword} onChange={e => setFilterKeyword(e.target.value)} placeholder="Keyword…" style={{ ...inputStyle, width: 130 }} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={() => { setShowExtractInput(v => !v); setShowAddForm(false); }}
            style={{ background: PROJECTS_FULL, color: "#fff", border: "none", padding: "5px 14px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            ✎ Review Minutes
          </button>
          <button onClick={() => { setShowAddForm(v => !v); setShowExtractInput(false); }}
            style={{ background: "#f0ede8", color: "#6a5a48", border: "1px solid #e4e4e8", padding: "5px 14px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            + Add Agreement
          </button>
        </div>
      </div>

      {/* Extract input panel */}
      {showExtractInput && (
        <div style={{ background: "#fff", border: "1px solid #e4e4e8", borderTop: "none", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: "#6a5a48", fontWeight: 500 }}>Paste meeting minutes or email text below. The AI will extract agreements for you to review.</div>
          <input value={extractLabel} onChange={e => setExtractLabel(e.target.value)} placeholder="Source name (e.g. Design Team Meeting 14 May 2026)" style={{ ...inputStyle, width: "100%" }} />
          <textarea value={extractText} onChange={e => setExtractText(e.target.value)} placeholder="Paste minutes or email text here…"
            style={{ ...inputStyle, width: "100%", minHeight: 120, resize: "vertical", padding: "8px 12px", fontSize: 12 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={extract} disabled={!extractText.trim() || extracting}
              style={{ background: extractText.trim() ? PROJECTS_FULL : "#f8f8fa", color: extractText.trim() ? "#fff" : "#9a9088", border: "none", padding: "7px 18px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: extractText.trim() ? "pointer" : "default" }}>
              {extracting ? <><Spinner size={11} /> Extracting…</> : "Extract Agreements"}
            </button>
            <button onClick={() => setShowExtractInput(false)} style={{ background: "#f0ede8", color: "#6a5a48", border: "1px solid #e4e4e8", padding: "7px 14px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Manual add form */}
      {showAddForm && (
        <div style={{ background: "#fff", border: "1px solid #e4e4e8", borderTop: "none", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: "#6a5a48", fontWeight: 500 }}>Add an agreement manually</div>
          <textarea value={newText} onChange={e => setNewText(e.target.value)} placeholder="Agreement text…"
            style={{ ...inputStyle, width: "100%", minHeight: 72, resize: "vertical", padding: "8px 12px", fontSize: 12 }} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} style={{ ...inputStyle, width: 160 }} />
            <input value={newConfirmedBy} onChange={e => setNewConfirmedBy(e.target.value)} placeholder="Confirmed by…" style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
            <input value={newOthers} onChange={e => setNewOthers(e.target.value)} placeholder="Others present (comma-separated)…" style={{ ...inputStyle, flex: 2, minWidth: 180 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addManual} disabled={!newText.trim() || !newDate || saving}
              style={{ background: newText.trim() ? PROJECTS_FULL : "#f8f8fa", color: newText.trim() ? "#fff" : "#9a9088", border: "none", padding: "7px 18px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: newText.trim() ? "pointer" : "default" }}>
              {saving ? <Spinner size={11} /> : "Save Agreement"}
            </button>
            <button onClick={() => setShowAddForm(false)} style={{ background: "#f0ede8", color: "#6a5a48", border: "1px solid #e4e4e8", padding: "7px 14px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Agreement cards */}
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.length === 0 && (
          <div style={{ color: "#9a9088", fontSize: 13, padding: "24px 0", textAlign: "center" }}>
            {agreements.length === 0 ? "No agreements recorded yet. Use \"Review Minutes\" to extract from minutes or \"+ Add Agreement\" to add one manually." : "No agreements match the current filters."}
          </div>
        )}
        {filtered.map(a => {
          const isExpanded = expandedId === a.id;
          const sourceBadgeStyle = { padding: "1px 7px", borderRadius: 10, fontWeight: 600, fontSize: 10 };
          const sourceBadge = a.source_type === "minutes"
            ? <span style={{ ...sourceBadgeStyle, background: "#e8f0f8", color: "#2a6496" }}>📝 Minutes</span>
            : a.source_type === "email"
            ? <span style={{ ...sourceBadgeStyle, background: "#fef3e8", color: "#a06020" }}>📧 Email</span>
            : <span style={{ ...sourceBadgeStyle, background: "#f0ede8", color: "#6a5a48" }}>✎ Manual</span>;
          return (
            <div key={a.id} style={{ border: "1px solid #e4e4e8", borderRadius: 5, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <div style={{ background: "#fff", padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: DESIGN_TEXT, marginBottom: 5, fontSize: 13 }}>{a.current_text}</div>
                    <div style={{ fontSize: 11, color: "#9a9088", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      <span>📅 {new Date(a.date_agreed).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                      {a.confirmed_by && <span>👤 {a.confirmed_by}</span>}
                      {a.others_present && <span>👥 {a.others_present}</span>}
                      {sourceBadge}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                    {a.source_type !== "manual" && (
                      <button disabled={a.source_type === "minutes"}
                        style={{ fontSize: 11, color: a.source_type === "minutes" ? "#b0a8a0" : "#2a6496", background: "none", border: `1px solid ${a.source_type === "minutes" ? "#e4e4e8" : "#b8d0e8"}`, padding: "3px 10px", borderRadius: 3, cursor: a.source_type === "minutes" ? "not-allowed" : "pointer", fontWeight: 500 }}>
                        Open source
                      </button>
                    )}
                    <button onClick={() => setExpandedId(isExpanded ? null : a.id)}
                      style={{ background: "none", border: "none", color: "#9a9088", fontSize: 16, cursor: "pointer", padding: "0 4px" }}>
                      {isExpanded ? "▲" : "▼"}
                    </button>
                    <button onClick={() => deleteAgreement(a.id)}
                      style={{ background: "none", border: "none", color: "#c0a8a0", fontSize: 13, cursor: "pointer", padding: "0 4px" }}>✕</button>
                  </div>
                </div>
              </div>
              {isExpanded && a.entries && a.entries.length > 1 && (
                <div style={{ background: "#f8f8fa", borderTop: "1px solid #e4e4e8", padding: "10px 16px 10px 32px" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Update history</div>
                  <div style={{ borderLeft: "2px solid #e4e4e8", paddingLeft: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                    {a.entries.slice(0, -1).reverse().map((e, i) => (
                      <div key={e.id || i}>
                        <div style={{ fontSize: 11, color: "#6a5a48" }}>"{e.text}"</div>
                        <div style={{ fontSize: 10, color: "#b0a8a0", marginTop: 2 }}>{new Date(e.date_agreed).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {e.confirmed_by || "unknown"}{e.source_label ? ` · ${e.source_label}` : ""}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {isExpanded && (!a.entries || a.entries.length <= 1) && (
                <div style={{ background: "#f8f8fa", borderTop: "1px solid #e4e4e8", padding: "10px 16px 10px 32px" }}>
                  <div style={{ fontSize: 11, color: "#b0a8a0" }}>No update history — this is the original agreement.</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showReview && (
        <AgreementsReviewModal
          projectId={projectId}
          candidates={candidates}
          sourceLabel={extractLabel || "Minutes"}
          sourceType="minutes"
          onSave={async () => { setShowReview(false); setCandidates([]); await load(); }}
          onClose={() => { setShowReview(false); setCandidates([]); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```
git add client/src/components/AgreementsTab.jsx
git commit -m "feat: add AgreementsTab component"
```

---

## Task 8: ProjectsSection.jsx — Add Agreements Tab

**Files:** Modify `client/src/components/ProjectsSection.jsx`

- [ ] **Step 1: Add import at the top of the file**

Find the existing component imports near the top of the file (look for `import TaskBoard` or similar). Add:

```javascript
import AgreementsTab from "./AgreementsTab";
```

- [ ] **Step 2: Add "Agreements" to the tab list**

Find this array in the file (search for `{ id: "tasks", label: "To Do" }`):

```javascript
{ id: "tasks", label: "To Do" },
```

Add immediately after it:

```javascript
{ id: "agreements", label: "Agreements" },
```

- [ ] **Step 3: Add the tab render**

Find the line that renders the tasks tab:

```javascript
{activeTab === "tasks" && <TaskBoard projectId={projectId} />}
```

Add immediately after it:

```javascript
{activeTab === "agreements" && <AgreementsTab projectId={projectId} />}
```

- [ ] **Step 4: Verify in browser**

Open a project. Confirm "Agreements" tab appears. Click it. Confirm the tab loads with the Q&A bar, filter bar, and empty state message.

- [ ] **Step 5: Commit**

```
git add client/src/components/ProjectsSection.jsx
git commit -m "feat: add Agreements tab to project section"
```

---

## Task 9: Update QABar — Include Agreements in Bottom Bar Context

**Files:** Modify `client/src/components/ProjectsSection.jsx` — QABar component only (starts around line 1489)

- [ ] **Step 1: Add agreements state variable**

Find this block in QABar's state declarations (search for `const [matchedTasks, setMatchedTasks]`):

```javascript
const [matchedTasks, setMatchedTasks] = useState([]);
```

Add immediately after:

```javascript
const [qaAgreements, setQaAgreements] = useState([]);
```

- [ ] **Step 2: Add agreements fetch to the existing useEffect**

Find the `Promise.all` call inside the QABar `useEffect` (it already fetches products, categories, todos, team members, transmittal). Add the agreements fetch to the array:

```javascript
const [{ products }, { categories }, todosRes, membersRes, transmittalRes, agreementsRes] = await Promise.all([
  api(`/api/projects/${projectId}/products`),
  api(`/api/projects/${projectId}/categories`),
  api(`/api/projects/${projectId}/todos`),
  api(`/api/team-members`),
  api(`/api/projects/${projectId}/transmittal`),
  api(`/api/projects/${projectId}/agreements`),
]);
```

Then add after the existing `setTransmittal(transmittalRes);` line:

```javascript
setQaAgreements(agreementsRes.agreements || []);
```

- [ ] **Step 3: Add agreements context to the ask() function**

In the `ask()` function, find where `tasksContext` and `transmittalContext` are built (after `productsContext`). Add immediately after `transmittalContext`:

```javascript
const agreementsContext = qaAgreements.length === 0
  ? "No agreements recorded."
  : qaAgreements.map(a => {
      const history = (a.entries || []).length > 1
        ? ` (previously: ${(a.entries || []).slice(0, -1).map(e => `"${e.text}" on ${e.date_agreed}`).join(", ")})`
        : "";
      return `"${a.current_text}" — confirmed by ${a.confirmed_by || "unknown"} on ${a.date_agreed}${a.others_present ? `, others: ${a.others_present}` : ""}${history}`;
    }).join("\n");
```

- [ ] **Step 4: Add agreements section to the ctx template literal**

Find the `TRANSMITTAL / DRAWING ISSUE HISTORY:` section in the `ctx` template literal. Add immediately after it:

```javascript
AGREEMENTS & CONFIRMATIONS:
${agreementsContext}
```

- [ ] **Step 5: Update the system prompt to mention agreements**

Find the system prompt string. Update the first sentence to include agreements:

Change:
```
You are a project assistant for an architectural practice. You have full access to the project data provided — including project info, consultants, U-values, notes, specified products (with full technical attributes), the tasks/to-do list, transmittal issue history, the drawing register, and extracted content from indexed drawings.
```

To:
```
You are a project assistant for an architectural practice. You have full access to the project data provided — including project info, consultants, U-values, notes, specified products (with full technical attributes), the tasks/to-do list, transmittal issue history, agreed confirmations and decisions, the drawing register, and extracted content from indexed drawings.
```

- [ ] **Step 6: Verify in browser**

Open a project with at least one agreement saved. Use the bottom bar to ask "What has been agreed about [topic]?". Confirm the answer references the agreements.

- [ ] **Step 7: Commit and deploy**

```
git add client/src/components/ProjectsSection.jsx
git commit -m "feat: include agreements in Projects bottom bar Q&A context"
```

Deploy client to Vercel, server to Railway.

---

## Final Verification Checklist

- [ ] New "Agreements" tab appears in project section
- [ ] "+ Add Agreement" form saves a manual agreement and it appears in the list
- [ ] Expand arrow shows update history (shows "no history" message for first entry)
- [ ] "Review Minutes" button opens the text input panel
- [ ] Pasting minutes text and clicking "Extract Agreements" calls the API and opens the review modal
- [ ] Agree/disagree toggles work; "Save agreed (N)" saves and refreshes the list
- [ ] Amber warning appears when a candidate matches an existing agreement
- [ ] Inline Q&A on Agreements tab returns an answer
- [ ] Bottom bar Q&A includes agreements when answering questions from any project tab
- [ ] Filters (source, person, keyword) narrow the list correctly
- [ ] Delete removes an agreement after confirmation
