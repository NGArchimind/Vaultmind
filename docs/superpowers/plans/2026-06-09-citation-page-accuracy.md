# Citation Page Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every citation click opens the PDF at the exact correct page, determined definitively from the vault index — no estimates, no fallbacks, no wrong pages.

**Architecture:** The vault index, built during document indexing using mupdf `[Page X]` markers, holds the authoritative physical page number for every heading. We store the index used for the last answer in React state (`lastAnswerIndex`), then look up the heading's page from that index at click time using a 4-level matching algorithm. This replaces all page estimation heuristics.

**Tech Stack:** React (App.js), JavaScript. All changes client-side — Vercel deploy only.

---

## Root Cause Diagnosis

The citation system has three compounding bugs:

1. **Wrong normalisation in vault index correction** (`normalizeHeading`): strips ALL non-alphanumeric characters, so `"1.1 General"` → `"11 general"` and `"11 General"` → `"11 general"` — same key. Different headings collide; the wrong page wins. This is causing wrong pages to be extracted in Pass 2 and therefore rubbish answers.

2. **Pass 2 overwrites doc-level page to firstExtractedPage**: after extraction, the code sets `citationPageMap[docName].page = result.pageNumbers[0]`. With general provisions pages now starting early in the document, this becomes page 1 or 2, so every citation that misses a heading-level match opens at the front.

3. **The vault index is never used at click time**: the accurate heading pages in `lastAnswerIndex.documents[].headings[].pageHint` are available but not consulted when a citation is clicked. Instead we rely on Gemini's Pass 1 estimates, which can be several pages off.

---

## Files Modified

| File | Changes |
|------|---------|
| `client/src/App.js` | Add `lastAnswerIndex` state; fix `normalizeHeading`; add `findPageInVaultIndex`; update `handleCitationClick`; remove Pass 2 doc-level overwrite; store `activeIndex` after question answers; revert `[p.X]` from answerPrompt |
| `fix_prompt_revert.py` | Temporary script to revert `[p.X]` from the answerPrompt (single long line — cannot use Edit tool) |

`AnswerRenderer.jsx` — no further changes needed. The `rawHeading` passthrough added earlier is fine and future-proof.

---

## Task 1: Fix the normaliseHeading function

**File:** `client/src/App.js` — the `normalizeHeading` const inside `askQuestion()` (~line 857)

The current version strips all non-alphanumeric characters, merging clause numbers: `"1.1"` → `"11"`. The fix keeps dots so clause numbers are preserved.

- [ ] **Step 1: Read the current normalizeHeading line**

```
Current (WRONG):
const normalizeHeading = s => s.toLowerCase().replace(/[^a-z0-9\s]+/g, '').replace(/\s+/g, ' ').trim();

Fixed:
const normalizeHeading = s => s.toLowerCase().replace(/[^a-z0-9.\s]+/g, ' ').replace(/\s+/g, ' ').trim();
```

The only change is `[^a-z0-9\s]+` → `[^a-z0-9.\s]+` — the dot is now kept in the allowed character set, and non-matching characters become spaces rather than being deleted (prevents accidental number merging like `"K2"` from `"K-2"`).

- [ ] **Step 2: Apply edit using Edit tool**

Old string to match exactly:
```
const normalizeHeading = s => s.toLowerCase().replace(/[^a-z0-9\s]+/g, '').replace(/\s+/g, ' ').trim();
```

New string:
```
const normalizeHeading = s => s.toLowerCase().replace(/[^a-z0-9.\s]+/g, ' ').replace(/\s+/g, ' ').trim();
```

---

## Task 2: Remove Pass 2 doc-level citation key overwrite

**File:** `client/src/App.js` — inside the page extraction loop, ~lines 1112–1124

This block sets `citationPageMap[docName].page = result.pageNumbers[0]` (first extracted page). With general provisions pages at the front of documents, this becomes page 1 or 2. Remove it entirely — the page will come from the vault index at click time.

- [ ] **Step 1: Find and remove the entire block**

The block to remove is this comment + code:
```javascript
          // Update citation map: replace Pass 1 pageHint estimate with actual first extracted page.
          // The heading-level keys (docName||heading) are left untouched — they stay accurate for
          // headings that do match. Only the docName-level fallback key is updated, so a failed
          // heading lookup opens at the start of the real extracted section rather than somewhere
          // unrelated in the document.
          if (result.pageNumbers && result.pageNumbers.length > 0) {
            const firstExtractedPage = result.pageNumbers[0];
            Object.keys(newCitationPageMap).forEach(k => {
              if (!k.includes("||") && newCitationPageMap[k].fileName === docName) {
                newCitationPageMap[k].page = firstExtractedPage;
              }
            });
          }
```

Replace with nothing (delete entirely).

---

## Task 3: Add `lastAnswerIndex` state

**File:** `client/src/App.js` — state declarations block (~line 215)

`handleCitationClick` needs access to the vault index used for the most recent answer. We store it in state so it persists after `askQuestion` completes.

- [ ] **Step 1: Add state declaration after line 215 (`citationPageMap` state)**

Find:
```javascript
  const [citationPageMap, setCitationPageMap] = useState({}); // { docName → { page, vaultId, fileName } }
```

Replace with:
```javascript
  const [citationPageMap, setCitationPageMap] = useState({}); // { docName → { page, vaultId, fileName } }
  const [lastAnswerIndex, setLastAnswerIndex] = useState(null); // vault index from most recent answer — used for accurate citation pages
```

---

## Task 4: Store `activeIndex` at end of `askQuestion`

**File:** `client/src/App.js` — inside `askQuestion()`, the line `setAnswer(finalAnswer)` (~line 1164)

`activeIndex` is the local const computed at line 744. We capture it into state here so it's available at click time.

- [ ] **Step 1: Add setLastAnswerIndex call on the line after setAnswer**

Find:
```javascript
      setAnswer(finalAnswer);
      setAnswerVaultName(usingTempOnly ? "Temp Doc" : (effectiveVault?.name || vault?.name || ""));
```

Replace with:
```javascript
      setAnswer(finalAnswer);
      setLastAnswerIndex(activeIndex);
      setAnswerVaultName(usingTempOnly ? "Temp Doc" : (effectiveVault?.name || vault?.name || ""));
```

---

## Task 5: Add `findPageInVaultIndex` helper

**File:** `client/src/App.js` — add as a `const` immediately above `handleCitationClick` (~line 1208)

This is the core of the fix. Given a PDF filename and a heading string (as written by Gemini in the answer), it searches `lastAnswerIndex` and returns the physical page number from the vault index.

**Matching levels — tried in order, first hit wins:**

1. **Exact** — lowercase + trim match
2. **Normalised** — dots kept, other special chars → space. Handles `"Clause 5.3 — Height of guarding"` matching `"5.3 Height of guarding"`
3. **Clause number** — extracts leading number pattern (e.g. `5.3`, `B3`, `K2`) and matches any heading with the same leading number
4. **Significant words** — extracts words > 3 chars and checks all appear in the heading

- [ ] **Step 1: Insert the function before `handleCitationClick`**

Find:
```javascript
  // ── Open PDF viewer at page from citation ────────────────────────────────────
  const handleCitationClick = async (docName, rawHeading) => {
```

Replace with:
```javascript
  // ── Look up the physical page for a heading from the vault index ──────────────
  // Uses the index stored when the last question was answered — the authoritative
  // source of page numbers (from mupdf [Page X] markers, not Gemini estimates).
  // Four matching levels tried in order; first hit wins.
  const findPageInVaultIndex = (fileName, headingText) => {
    if (!lastAnswerIndex?.documents || !headingText) return null;
    const stripPdf = s => (s || "").replace(/\.pdf$/i, "").trim();
    const indexDoc = lastAnswerIndex.documents.find(d => {
      const dn = stripPdf(d.name).toLowerCase();
      const fn = stripPdf(fileName).toLowerCase();
      return dn === fn || dn.includes(fn) || fn.includes(dn);
    });
    if (!indexDoc?.headings?.length) return null;

    // Level 1: exact case-insensitive match
    const target = headingText.toLowerCase().trim();
    let h = indexDoc.headings.find(h => h.title.toLowerCase().trim() === target);
    if (h?.pageHint) return h.pageHint;

    // Level 2: normalised match — keep dots (preserves "5.3"), strip other special chars
    const norm = s => s.toLowerCase().replace(/[^a-z0-9.\s]/g, " ").replace(/\s+/g, " ").trim();
    const nt = norm(headingText);
    h = indexDoc.headings.find(h => norm(h.title) === nt);
    if (h?.pageHint) return h.pageHint;

    // Level 3: clause number prefix match — "5.3", "B3", "K2", "AD-B3" etc.
    const cnMatch = headingText.match(/\b([A-Z]?\d[\d.]*[A-Za-z]?)\b/i);
    if (cnMatch) {
      const cn = cnMatch[1].toLowerCase();
      h = indexDoc.headings.find(h => {
        const m = h.title.match(/\b([A-Z]?\d[\d.]*[A-Za-z]?)\b/i);
        return m && m[1].toLowerCase() === cn;
      });
      if (h?.pageHint) return h.pageHint;
    }

    // Level 4: all significant words (>3 chars) appear in the vault heading
    const sigWords = s => s.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(w => w.length > 3);
    const tw = sigWords(headingText);
    if (tw.length >= 2) {
      h = indexDoc.headings.find(h => {
        const hw = sigWords(h.title);
        return tw.every(w => hw.includes(w));
      });
      if (h?.pageHint) return h.pageHint;
    }

    return null;
  };

  // ── Open PDF viewer at page from citation ────────────────────────────────────
  const handleCitationClick = async (docName, rawHeading) => {
```

---

## Task 6: Update `handleCitationClick` to use vault index page

**File:** `client/src/App.js` — inside `handleCitationClick`, the final `setCitationViewer` call

The vault index page is now the primary source. The existing `[p.X]` extraction is kept as a secondary input (useful if Gemini starts providing it in future). `resolved.page` from the citation map is the last resort.

- [ ] **Step 1: Update the setCitationViewer call**

Find:
```javascript
      setCitationViewer({ base64, fileName: resolved.fileName, page: explicitPage || resolved.page || 1, heading });
```

Replace with:
```javascript
      const indexPage = findPageInVaultIndex(resolved.fileName, heading);
      setCitationViewer({ base64, fileName: resolved.fileName, page: indexPage || explicitPage || resolved.page || 1, heading });
```

---

## Task 7: Revert `[p.X]` from the answer prompt

**File:** `client/src/App.js` — the `answerPrompt` const (single very long line, must use Python script)

The `[p.X]` instruction added earlier is not needed now that pages come from the vault index. Removing it shortens and simplifies the prompt, addressing Nathan's concern about prompt length.

- [ ] **Step 1: Write the revert script to disk**

Create file `fix_prompt_revert.py` at the repo root with:

```python
with open("client/src/App.js", "r", encoding="utf-8") as f:
    content = f.read()

# Revert citation format in main answer prompt
content = content.replace(
    'Format: *Document Name | Clause number and title [p.X]* — must start AND end with a single *, where X is the exact PDF page number this clause appears on (taken from the page numbers listed in the document block title, e.g. "pages 8, 9, 10, 11")',
    'Format: *Document Name | Clause number and title* — must start AND end with a single *'
)

# Revert citation format in system prompt
content = content.replace(
    'Every citation MUST start and end with asterisks: *Document | Clause (Section) [p.X]* where X is the exact PDF page number.',
    'Every citation MUST start and end with asterisks: *Document | Clause (Section)*.'
)

with open("client/src/App.js", "w", encoding="utf-8") as f:
    f.write(content)

print("Done")
```

- [ ] **Step 2: Run the script**

```bash
cd "C:\Users\ngree\Archimind\Vaultmind" && python fix_prompt_revert.py
```

Expected output: `Done`

- [ ] **Step 3: Verify the revert**

Grep for `[p.X]` in App.js — should return zero matches in the answerPrompt area (only the `handleCitationClick` code which legitimately references the tag pattern).

- [ ] **Step 4: Delete the script**

```bash
rm fix_prompt_revert.py
```

---

## Task 8: Verify all changes are coherent

- [ ] **Step 1: Confirm `lastAnswerIndex` state is declared**

Grep for `lastAnswerIndex` — should appear in: state declaration, `setLastAnswerIndex(activeIndex)` call, and `findPageInVaultIndex` function body.

- [ ] **Step 2: Confirm the doc-level overwrite is gone**

Grep for `firstExtractedPage` — should return zero results.

- [ ] **Step 3: Confirm normalizeHeading is fixed**

Grep for `normalizeHeading` — the definition should now contain `[^a-z0-9.\s]` (dot inside the character class).

- [ ] **Step 4: Confirm prompt is clean**

Grep for `p\.X` in App.js — should only appear in `handleCitationClick` regex patterns, not in the answerPrompt string.

- [ ] **Step 5: Confirm findPageInVaultIndex is above handleCitationClick**

Read the section around `handleCitationClick` — `findPageInVaultIndex` should appear immediately before it.

---

## How the system works after this plan

```
User clicks citation "Approved Document K.pdf | 5.3 Height of guarding"
    ↓
handleCitationClick receives: docName="Approved Document K.pdf", rawHeading="5.3 Height of guarding"
    ↓
citationPageMap lookup → finds { vaultId, fileName } for loading the PDF
    ↓
findPageInVaultIndex("Approved Document K.pdf", "5.3 Height of guarding")
    → searches lastAnswerIndex.documents for the doc
    → Level 1 exact match: finds { title: "5.3 Height of guarding", pageHint: 12 }
    → returns 12
    ↓
PDF viewer opens "Approved Document K.pdf" at page 12  ✓
```

If Gemini writes `"Clause 5.3 — Height of guarding"` instead:
```
Level 1 exact: no match
Level 2 normalised: "clause 5 3 height of guarding" vs "5 3 height of guarding" → no match
Level 3 clause number: extracts "5.3" from both → MATCH → returns page 12  ✓
```

---

## Self-Review

**Spec coverage check:**
- Fix normalisation bug → Task 1 ✓
- Remove doc-level overwrite → Task 2 ✓
- Store vault index after question → Tasks 3 + 4 ✓
- Look up page from vault index at click time → Tasks 5 + 6 ✓
- Revert [p.X] from prompt → Task 7 ✓
- Verify coherence → Task 8 ✓

**Placeholder check:** All steps have exact code. No TBDs.

**Type consistency:** `lastAnswerIndex` declared as `useState(null)`, set to `activeIndex` (object with `.documents[]`), read in `findPageInVaultIndex` as `lastAnswerIndex?.documents` — consistent throughout.

**Known limitation:** Level 4 (significant words) could theoretically match the wrong heading if two headings share all the same long words. This is extremely unlikely in building regulations documents where clause numbers are unique. Level 3 (clause number) catches almost all real cases before Level 4 runs.
