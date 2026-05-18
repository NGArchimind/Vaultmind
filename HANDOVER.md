# Archimind — Session Handover
**Date:** 2026-05-18
**Project:** Archimind / Vaultmind — Q&A answer quality and citation UX refinement

---

## Project Overview

Archimind is a personal AI-powered document intelligence tool for architectural practice. Built by Nathan Green (architect, non-coder). Monorepo at `C:\Users\ngree\Archimind\Vaultmind`.

- **Client:** React (CRA), `client/` — deployed on Vercel
- **Server:** Express/Node.js, `server/` — deployed on Railway
- **Storage:** Cloudflare R2 (PDFs + vault indexes), Supabase (auth + data)
- **AI:** Google Gemini API (`gemini-2.5-flash`, embeddings via `gemini-embedding-001`)
- **Auth:** Always use `supabase.auth.getUser(token)` — never `jwt.verify`

**Colour palette (constants.js):** `AD_GREEN = "#0d6478"`, `ARC_NAVY = "#1e2a35"`, `ARC_TERRACOTTA = "#c25a45"`, `LIBRARY_BLUE` constant exists — never hardcode `#2a6496`.

---

## 3-Pass Q&A Pipeline

All query logic is in `askQuestion()` in `client/src/App.js`.

**Pass 1 — Index scoring (`scoringPrompt`, ~line 747):**
Sends the vault's heading index to Gemini and asks it to score which sections are most relevant. Returns JSON `{ selectedDocs: [{ docName, sections: [{ heading, pageHint, probability }] }] }`. Filters out boilerplate, TOC pages, and crowded pages before scoring.

**Pass 2 — Page extraction:**
Fetches the actual PDF files from R2 for the scored documents. Extracts specific pages based on the scored page hints. Falls back to first 2 PDFs if scoring returns no matches — **this fallback is a known issue** (see Outstanding Issues below).

**Pass 3 — Answer synthesis (`answerPrompt`, line 1027):**
Sends extracted page content to Gemini with a detailed prompt specifying exact output format. Returns the final answer text.

---

## Citation System

**How citations link to PDFs:**
- `citationPageMap` state is built during Pass 1, keyed by `docName` and `docName||heading`
- Each entry: `{ page, vaultId, fileName }` — resolved in Pass 2 when the actual PDFs are fetched
- When user clicks "↗ open" on a citation card, `handleCitationClick` looks up the map and opens the PDF viewer at the correct page

**Citation fuzzy matching (fixed this session):**
The citation click handler (`~line 1077`) now does three-level matching:
1. Exact key match on `docName` and `docName||heading`
2. Part-letter extraction: extracts "K" from "Approved Document K" or "AD Part K - ..." and matches on that
3. Normalised string overlap as final fallback

This fixes the case where Gemini writes "Approved Document K" in the answer but the actual filename is "AD Part K - Protection from falling collision and impact 2013".

**PDF viewer:**
Inline iframe using PDF.js (CDN v3.11.174). Two-pass heading search: Pass 1 searches ±20 pages of the hint page; Pass 2 searches the rest of the document skipping early pages (TOC zone). This avoids false positives on table of contents pages.

---

## Answer Format

The `answerPrompt` (line 1027 of `App.js`) is a single long string. It has been refined extensively this session. **Do not edit it with the Edit tool** — the string is too long and contains special characters. Use a Python replacement script instead (write to file, run, delete). See pattern from this session below.

### Current prompt structure

**## Summary**
Answer the question directly, as if summarising for a colleague. No preamble, no "it depends", no explanation of the regulatory framework — just the key requirements and standards. No specific dimensions (those go in Practical Conclusion). If a table would help, create a synthesised overview table collated from all findings — NOT a copy of a source document table, and NO citation on it.

**## Detailed Analysis**
One citation block per unique document + section. Format:
- PART 1: `*Document Name | Section title*` (citation header)
- PART 2: Full verbatim text of the clause(s)
- PART 3: Brief italic explanation only if relevance is not obvious

Rules:
- Group same-document, same-section clauses together — do not create separate blocks per clause number
- Skip clauses that repeat a dimension/requirement already cited
- Skip pure cross-reference clauses (those whose only content is "see Approved Document X")
- Document Name in citations MUST be the exact filename as it appears in the source

**## Contradictions & Conflicts**
Substantive analysis of genuine conflicts between documents. Quote both sides with citations, explain the conflict, give a practical resolution. If no conflicts: "No contradictions identified."

**## Practical Conclusion**
Short follow-on from the Summary — the specific numbers. Key dimensions, thresholds, and requirements only. No citations, no document names, no explanation. Maximum a short paragraph or tight bullet list.

### Table rules in prompt (10 rules)
1. Title on its own line in bold: `**Table X — Title**`
2. Every row and column — no omissions. Pipe characters on every row.
3. Separator row after header: `| --- | --- | --- |`
4. Highlighted rows prefixed with `>>`: `>> | cell | cell |`
5. No blockquote (`>`) wrapping
6. One citation immediately BEFORE the table title (in Detailed Analysis only)
7. Combine multi-page tables into one
8. Table notes as plain italic text BELOW the table — never inside as rows
9. Near-identical tables: reproduce most complete, note others below
10. Strip PDF artefacts: `$^{1}$`, `$^{(1)}$`, `^{1}` — omit entirely

### System message (line 1032 of App.js)
```
You are an expert building regulations consultant writing for architectural specialists. 
Answer using ONLY the provided document pages. Always output in this exact order: 
(1) ## Summary, (2) ## Detailed Analysis, (3) ## Contradictions & Conflicts, 
(4) ## Practical Conclusion. Never change this order. Every citation MUST start and end 
with asterisks: *Document | Clause (Section)*. Draw from ALL provided documents.
```

---

## AnswerRenderer Component

**File:** `client/src/components/common/AnswerRenderer.jsx`

Parses the Gemini answer text line by line and renders it as React elements. Key behaviours:

- **Citation detection:** Lines matching `*text|text*` (starts with `*`, ends with `*`, contains `|`) are rendered as `CitationLine` cards. Requires `|` to avoid false positives on italic text.
- **CitationLine card:** Shows document name (cleaned: `.pdf` removed, `__` replaced with ` — `), section heading below it, and `↗ open` button in teal. The "Citation" label was **removed** this session — the card now shows just the document name and section.
- **`formatInline()`:** Handles `**bold**`, `*italic*` (single `*` without `|`), and `` `code` `` inline.
- **Table parsing:** Lines starting with `|` or `>>` are buffered and rendered as styled HTML tables. `>>` prefix highlights a row. Table title detection looks for bold/plain "Table N" or "Figure N" lines immediately before the table.
- **Headings:** `## ` triggers special styling for Summary (green border box) and Practical Conclusion (green border + top border + extra margin). `### ` is terracotta uppercase. `# ` is large navy.

**AnswerRenderer prop is `text=` not `answer=`.** Always use `text=` when rendering AI answers.

---

## Key State Variables (App.js)

| State | Purpose |
|---|---|
| `vaultIndex` | Index object for currently selected vault. Non-null = INDEXED badge shows. Cleared on PDF upload/delete. |
| `citationPageMap` | Built in Pass 1. Maps docName → {page, vaultId, fileName} for citation click handling. |
| `followUpVaultId` | Vault selected in "Ask another vault" dropdown. **Reset to "" at start of every `askQuestion` call** (fixed this session). |
| `followUpQuestion` | Text in follow-up textarea. **Reset to "" after successful answer** (fixed this session — was previously pre-filled with last question). |
| `conversationHistory` | Last 5 Q&A pairs, sent to Pass 1 scoring for context. Can contaminate results if a bad answer is stored. No permanent fix yet — workaround is page refresh to clear. |
| `timedOut` | True after Gemini timeout. Shows retry button. Cleared at start of next `askQuestion`. |

---

## Bugs Fixed This Session

### 1. Citation "open" links not working
**Root cause:** Gemini writes "Approved Document K" in answers but actual filenames are "AD Part K - Protection from falling collision and impact 2013". Exact string lookup failed.  
**Fix:** `handleCitationClick` now extracts the part letter (K, M, N, O, A, B...) from both the citation name and the map keys, and matches on that. Falls back to normalised string overlap.

### 2. "Vault not indexed" after timeout
**Root cause:** When a follow-up vault query was made and Railway was under load (e.g. after a timeout), the API call to fetch the vault's index threw a network error. The `.catch(() => null)` silently converted this to `null`, which was then misidentified as "vault not indexed."  
**Fix:** The index fetch now uses `.then(data => ({ ok: true, data })).catch(() => ({ ok: false }))`. API errors now show "Could not connect to vault — please try again." Only a genuine null response (vault not indexed in R2) shows "That vault has not been indexed yet."

### 3. `followUpVaultId` persisting across queries
**Root cause:** If a vault was selected in the follow-up dropdown, it stayed selected indefinitely, potentially causing unexpected follow-up queries on subsequent main question submissions.  
**Fix:** `setFollowUpVaultId("")` added to the start of `askQuestion()`. `setFollowUpQuestion("")` now set after successful answers (was previously `setFollowUpQuestion(q)`, pre-filling the follow-up textarea with the last question).

### 4. Conversation history contaminating answers
**Root cause:** A catastrophically bad answer (said "documents don't contain guarding information") was stored in `conversationHistory` and fed into subsequent Pass 1 scoring, corrupting results.  
**No code fix yet** — workaround is page refresh to clear state. A permanent fix would be: don't store answers in conversation history if they appear to have failed (e.g. contain "do not contain information regarding").

### 5. Summary table was copying source documents
**Fix (prompt):** Summary table instruction changed — Gemini now creates a synthesised overview table collating key data from the full analysis, not a copy of a source document table. No citation on it.

### 6. "Citation" label on citation cards
**Fix (AnswerRenderer):** The italic green "Citation" label was removed from `CitationLine`. The card now shows just the document name, section, and open button.

---

## Outstanding Issues

### 1. Pass 2 fallback to first 2 PDFs (HIGH PRIORITY)
**Location:** `App.js` ~line 856
```javascript
const docsToFetch = docsNeeded.length > 0 ? docsNeeded : effectivePdfs.slice(0, 2);
```
When Pass 1 scoring returns doc names that don't match any PDF filename, `docsNeeded` is empty and the code silently falls back to the first 2 PDFs alphabetically. This caused a catastrophic failure (answer said documents had no guarding information) because AD A and AD B Vol 1 were fetched instead of AD K.  
**Proposed fix:** Remove the silent fallback. Either (a) show an error "Could not match scored documents to vault files — please re-index", or (b) fall back to ALL PDFs rather than just 2.

### 2. Conversation history contamination (MEDIUM)
**Issue:** Bad/failed answers stored in `conversationHistory` pollute subsequent queries via Pass 1 scoring context.  
**Proposed fix:** After each `askQuestion`, check if the answer contains hallucination signals (e.g. "do not contain information") and if so, remove it from `conversationHistory` rather than storing it.

### 3. Cross-reference-only clauses still appearing in Detailed Analysis (LOW)
**Issue:** AD M Vol 1 clause 0.14 and AD M Vol 2 relationship clause still appear in some answers despite the filtering rule. Gemini is not applying the rule consistently.  
**Proposed fix:** Strengthen the rule further, or add explicit examples of what counts as a pure cross-reference.

### 4. Multiple clause blocks from same document not combining (LOW)
**Issue:** AD K clauses 1.38, 1.39, 1.40, 1.41 etc. each get their own citation block even though they address the same general requirement (guarding of stairs).  
**Current rule:** "combine same-document, same-section clauses." These are different section numbers, so Gemini treats them as separate. May need a rule about combining when the subject matter is the same.

### 5. Table column extraction for wide tables (KNOWN LIMITATION)
**Issue:** PDF text extraction (mupdf) linearises text and doesn't preserve column boundaries for wide/complex tables. Gemini only sees one column's worth of data for tables like AD B Table 3.2 (stair widths for simultaneous evacuation).  
**No easy fix** — would require a different PDF extraction approach (e.g. using a table-aware PDF parser).

### 6. Conversation history — no clear mechanism to reset between topics (LOW)
**Issue:** `conversationHistory` accumulates across all queries in a session. If Nathan switches topics (e.g. from guarding to ventilation), the old context can confuse Pass 1.  
**Proposed fix:** Add a "New Question" / "Clear History" button, or auto-clear history when the vault is switched.

---

## How to Edit the answerPrompt

The `answerPrompt` is a single very long string on line 1027 of `App.js`. The Edit tool cannot handle it reliably. Use this pattern:

```python
# fix_promptN.py
path = r"C:\Users\ngree\Archimind\Vaultmind\client\src\App.js"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

old = "exact string to find (use \\n for newlines in the string)"
new = "replacement string"

if old in content:
    content = content.replace(old, new, 1)
    print("Updated.")
else:
    print("ERROR: not found.")

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
```

Run with: `cd "C:\Users\ngree\Archimind\Vaultmind" && python fix_promptN.py && rm fix_promptN.py`

Use `python -c "..."` to verify changes afterwards. Em dashes in the prompt are unicode (`—`) — check with `repr()` if a replacement fails.

---

## Deployment

- **Client changes** (App.js, AnswerRenderer.jsx, any `client/src/`) → push to Vercel
- **Server changes** (`server/index.js`) → push to Railway
- Nathan uses GitHub Desktop for version control

---

## Working With Nathan

- Always explain the issue in plain English before making any change. Wait for explicit approval ("go ahead", "yes") before touching any file.
- Nathan is an architect, not a developer. Use analogies. Avoid jargon. When you use a technical term, immediately explain it.
- After every fix, state clearly: "client only → push to Vercel", "server only → push to Railway", or "both."
- Read every file before editing it.
- Large rewrites: write to disk and reference the path rather than pasting inline.
