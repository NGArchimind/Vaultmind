# QA Detailed Analysis Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragmented citation-block-per-clause Detailed Analysis layout with grouped, collapsible document cards, and add lightweight figure-note support.

**Architecture:** Two files change. `App.js` gets updated prompt instructions so Gemini groups citations by document under `###` headers and optionally emits `*See Fig. X.X — ...*` notes. `AnswerRenderer.jsx` gets section tracking, two new components (`DocumentGroup`, `ClauseBlock`), and group-aware parsing that activates inside `## Detailed Analysis`. All other sections render unchanged.

**Tech Stack:** React (CRA), inline styles, no new dependencies.

---

### Task 1: Update answerPrompt and system prompt in App.js

**Files:**
- Modify: `client/src/App.js` (via Python script — do not use Edit tool directly)

The `answerPrompt` is one very long single-line template literal. Use the Python replacement pattern from `docs/HANDOVER.md` — write a script, run it, delete it.

- [ ] **Step 1: Write the replacement script**

Create `fix_prompt.py` in the repo root:

```python
with open("client/src/App.js", "r", encoding="utf-8") as f:
    content = f.read()

# ── Replace the Detailed Analysis instruction block ──────────────────────────

old_detailed = (
    "## Detailed Analysis\\n\\n"
    "Before writing any citation block, apply this test: does this clause contain a specific, actionable requirement directly relevant to the question — a dimension, gradient, tolerance, classification, or explicit rule? If the clause text is a generic duty statement (e.g. \"shall be suitable for intended use\", \"shall be adequate for the location\", \"shall be designed in accordance with relevant codes\") with no specific data, omit it entirely. Only cite clauses that would change or inform a specific design decision.\\n\\n"
    "Group citations by source: for each unique document + section, output ONE citation block. Treat all sub-clauses of the same parent section as one location — do not create separate blocks for 5.3.7 and 5.3.7.4, or for 9.3.4 and 9.3.4.1. Combine all relevant sub-clauses under the parent section heading. If multiple relevant clauses come from the same section, combine them under a single citation header — do not create separate blocks for the same source.\\n\\n"
    "For each citation block:\\n\\n"
    "PART 1 — Citation header (one line):\\n"
    "*Document Name | Section title*\\n\\n"
    "PART 2 — Full verbatim text:\\n"
    "Reproduce the complete relevant paragraph(s) or clause(s) exactly as written in the source. If multiple paragraphs from the same section are relevant, reproduce them together here. Do not paraphrase, do not truncate, do not add speech marks.\\n\\n"
    "PART 3 — Explanation (only if needed):\\n"
    "*Brief italic explanation if the relevance to the question is not immediately obvious.*\\n\\n"
    "Do not repeat information already covered in the Summary or in a previous citation block. If a clause states the same dimension, height, or requirement already cited earlier, skip it — cite only the most specific or primary source for each requirement. Omit clauses that are purely cross-references to another document — i.e. clauses whose sole content is directing the reader elsewhere, with no specific dimensions, requirements, or guidance of their own. If a clause contains even one concrete requirement alongside a cross-reference, include only the concrete requirement."
)

new_detailed = (
    "## Detailed Analysis\\n\\n"
    "Before writing any citation block, apply this test: does this clause contain a specific, actionable requirement directly relevant to the question — a dimension, gradient, tolerance, classification, or explicit rule? If the clause text is a generic duty statement (e.g. \"shall be suitable for intended use\", \"shall be adequate for the location\", \"shall be designed in accordance with relevant codes\") with no specific data, omit it entirely. Only cite clauses that would change or inform a specific design decision.\\n\\n"
    "Group all citations by source document. For each document that has relevant content, output a document group header on its own line:\\n"
    "### Document Name (use the exact filename, stripped of .pdf extension)\\n\\n"
    "All citation blocks for that document must appear immediately under its group header. Do not interleave citations from different documents — complete all citations for one document before starting the next.\\n\\n"
    "For each citation block within a group:\\n\\n"
    "PART 1 — Citation header (one line):\\n"
    "*Document Name | Section title*\\n\\n"
    "PART 2 — Full verbatim text:\\n"
    "Reproduce the complete relevant paragraph(s) or clause(s) exactly as written in the source. If multiple paragraphs from the same section are relevant, reproduce them together here. Do not paraphrase, do not truncate, do not add speech marks.\\n\\n"
    "PART 3 — Explanation (only if needed):\\n"
    "*Brief italic explanation if the relevance to the question is not immediately obvious.*\\n\\n"
    "PART 4 — Figure note (only if a diagram, figure, or image on this page directly illustrates the clause):\\n"
    "*See Fig. X.X — [one phrase describing what the figure shows]*\\n\\n"
    "Do not repeat information already covered in the Summary or in a previous citation block. If a clause states the same dimension, height, or requirement already cited earlier, skip it — cite only the most specific or primary source for each requirement. Omit clauses that are purely cross-references to another document — i.e. clauses whose sole content is directing the reader elsewhere, with no specific dimensions, requirements, or guidance of their own. If a clause contains even one concrete requirement alongside a cross-reference, include only the concrete requirement. Treat all sub-clauses of the same parent section as one location — do not create separate blocks for 5.3.7 and 5.3.7.4, or for 9.3.4 and 9.3.4.1. Combine all relevant sub-clauses under the parent section heading."
)

assert old_detailed in content, "Detailed Analysis block not found — check substring"
content = content.replace(old_detailed, new_detailed, 1)

# ── Update the one-line system prompt passed to callClaude (~line 1034) ──────

old_sysprompt = (
    "You are an expert building regulations consultant writing for architectural specialists. "
    "Answer using ONLY the provided document pages. "
    "Always output in this exact order: (1) ## Summary, (2) ## Detailed Analysis, (3) ## Contradictions & Conflicts, (4) ## Practical Conclusion. "
    "Never change this order. "
    "Every citation MUST start and end with asterisks: *Document | Clause (Section)*. "
    "Draw from ALL provided documents."
)

new_sysprompt = (
    "You are an expert building regulations consultant writing for architectural specialists. "
    "Answer using ONLY the provided document pages. "
    "Always output in this exact order: (1) ## Summary, (2) ## Detailed Analysis, (3) ## Contradictions & Conflicts, (4) ## Practical Conclusion. "
    "Never change this order. "
    "Every citation MUST start and end with asterisks: *Document | Clause (Section)*. "
    "In Detailed Analysis, start each document's citations with a ### Document Name header on its own line and group ALL citations from that document together before moving to the next. "
    "Draw from ALL provided documents."
)

assert old_sysprompt in content, "System prompt string not found — check substring"
content = content.replace(old_sysprompt, new_sysprompt, 1)

with open("client/src/App.js", "w", encoding="utf-8") as f:
    f.write(content)

print("Done — both replacements applied")
```

- [ ] **Step 2: Run the script**

```bash
cd C:/Users/ngree/Archimind/Vaultmind
python fix_prompt.py
```

Expected output: `Done — both replacements applied`

If either assertion fails, the substring has drifted — read the current text in App.js around line 1030 and adjust the Python string to match exactly.

- [ ] **Step 3: Verify the changes look right**

Open `client/src/App.js` around line 1030. Confirm:
- The Detailed Analysis instructions now include `### Document Name` grouping instructions
- PART 4 figure note instruction is present
- The system prompt string (a few lines below) includes the `###` grouping sentence

- [ ] **Step 4: Delete the script and commit**

```bash
del fix_prompt.py
git add client/src/App.js
git commit -m "feat: update answerPrompt to group Detailed Analysis by document with ### headers"
```

---

### Task 2: Add DocumentGroup and ClauseBlock components to AnswerRenderer.jsx

**Files:**
- Modify: `client/src/components/common/AnswerRenderer.jsx`

Add two new components near the top of the file, after the existing `CitationLine` component (line ~41). These are purely additive — nothing renders them yet.

- [ ] **Step 1: Add useState import**

`AnswerRenderer.jsx` currently has no React import. Add one at the top of the file (line 1, before the existing constants import):

```js
import { useState } from 'react';
```

- [ ] **Step 2: Add ClauseBlock component**

Insert after the closing `}` of `CitationLine` (after line 41):

```jsx
function ClauseBlock({ clause, onCitationClick }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 5 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: AD_GREEN, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "Inter, Arial, sans-serif" }}>{clause.heading}</div>
        {onCitationClick && (
          <button
            onClick={() => onCitationClick(clause.docName, clause.heading)}
            style={{ background: AD_GREEN, border: "none", cursor: "pointer", color: "#fff", fontSize: 10, padding: "3px 9px", fontFamily: "Inter, Arial, sans-serif", borderRadius: 2, flexShrink: 0, marginLeft: 10, fontWeight: 500, letterSpacing: "0.05em", whiteSpace: "nowrap" }}
          >↗ open</button>
        )}
      </div>
      {clause.lines.map((line, idx) =>
        line.figureNote ? (
          <div key={idx} style={{ fontSize: 11, fontStyle: "italic", color: "#6b7280", marginTop: 6, fontFamily: "Inter, Arial, sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
            {line.text}
            {onCitationClick && (
              <button
                onClick={() => onCitationClick(clause.docName, clause.heading)}
                style={{ background: "none", border: "none", cursor: "pointer", color: AD_GREEN, fontSize: 10, padding: 0, fontFamily: "Inter, Arial, sans-serif", fontWeight: 500 }}
              >↗ open</button>
            )}
          </div>
        ) : (
          <div key={idx} style={{ fontSize: 12, color: ARC_NAVY, lineHeight: 1.8, borderLeft: "2px solid #d0ccc8", paddingLeft: 12, marginTop: idx === 0 ? 0 : 6, fontFamily: "Inter, Arial, sans-serif" }}>{formatInline(line.text)}</div>
        )
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add DocumentGroup component**

Insert immediately after `ClauseBlock`:

```jsx
function DocumentGroup({ docName, clauses, onCitationClick }) {
  const [expanded, setExpanded] = useState(false);
  const displayDoc = docName.replace(/\.pdf$/i, "").replace(/__+/g, " — ").trim();
  const clauseHeadings = clauses.map(c => c.heading).join(" · ");
  return (
    <div style={{ border: "1px solid #d0ccc8", borderLeft: `3px solid ${AD_GREEN}`, borderRadius: "0 3px 3px 0", marginBottom: 8, background: "#fff" }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", cursor: "pointer", userSelect: "none" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: ARC_NAVY, fontSize: 13, fontFamily: "Inter, Arial, sans-serif" }}>{displayDoc}</div>
          {clauseHeadings && <div style={{ color: "#6b7280", fontSize: 11, marginTop: 4, fontFamily: "Inter, Arial, sans-serif", lineHeight: 1.4 }}>{clauseHeadings}</div>}
        </div>
        <div style={{ color: AD_GREEN, fontSize: 20, marginLeft: 12, flexShrink: 0, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</div>
      </div>
      {expanded && (
        <div style={{ borderTop: "1px solid #f0eeec", padding: "0 14px 14px" }}>
          {clauses.map((clause, idx) => (
            <ClauseBlock key={idx} clause={clause} onCitationClick={onCitationClick} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add client/src/components/common/AnswerRenderer.jsx
git commit -m "feat: add DocumentGroup and ClauseBlock components to AnswerRenderer"
```

---

### Task 3: Add section tracking and group-aware parsing to AnswerRenderer.jsx

**Files:**
- Modify: `client/src/components/common/AnswerRenderer.jsx`

This task wires the new components into the main renderer by adding section tracking and a group-aware parsing path for `## Detailed Analysis`.

- [ ] **Step 1: Add state variables and flushGroup helper before the forEach**

In the `AnswerRenderer` function body, after the existing declarations (`let tableBuffer = []; let inTable = false;`), add:

```js
let currentSection = null;
let groupBuffer = null;   // { docName: string, clauses: Array }
let currentClause = null; // { heading: string, docName: string, lines: Array<{text, figureNote}> }

const flushGroup = (key) => {
  if (!groupBuffer) return;
  if (currentClause) {
    groupBuffer.clauses.push(currentClause);
    currentClause = null;
  }
  if (groupBuffer.clauses.length > 0) {
    elements.push(
      <DocumentGroup key={`grp-${key}`} docName={groupBuffer.docName} clauses={groupBuffer.clauses} onCitationClick={onCitationClick} />
    );
  }
  groupBuffer = null;
};
```

- [ ] **Step 2: Update the ## heading handler to track sections and flush groups**

Find the existing `else if (line.startsWith("## "))` block (around line 144 of the current file). Replace it with:

```jsx
} else if (line.startsWith("## ")) {
  if (currentSection === "detailed") flushGroup(i);
  const text = line.slice(3);
  const lower = text.toLowerCase();
  if (lower.includes("detailed analysis")) currentSection = "detailed";
  else if (lower.includes("summary")) currentSection = "summary";
  else if (lower.includes("contradictions")) currentSection = "contradictions";
  else if (lower.includes("practical")) currentSection = "practical";
  else currentSection = null;

  const isSummary = lower.includes("summary");
  const isPractical = lower.includes("practical conclusion");
  if (isSummary) {
    elements.push(
      <div key={i} style={{ background: "#f0f5f6", border: `1px solid ${AD_GREEN_MID}`, borderLeft: `3px solid ${AD_GREEN}`, padding: "14px 18px", margin: "16px 0 8px" }}>
        <h2 style={{ color: AD_GREEN, fontSize: 12, fontWeight: 600, margin: 0, fontFamily: "Inter, Arial, sans-serif", textTransform: "uppercase", letterSpacing: "0.08em" }}>{text}</h2>
      </div>
    );
  } else if (isPractical) {
    elements.push(
      <div key={i} style={{ background: "#f0f5f6", border: `1px solid ${AD_GREEN_MID}`, borderLeft: `3px solid ${AD_GREEN}`, borderTop: `2px solid ${AD_GREEN}`, padding: "14px 18px", margin: "32px 0 8px" }}>
        <h2 style={{ color: AD_GREEN, fontSize: 12, fontWeight: 600, margin: 0, fontFamily: "Inter, Arial, sans-serif", textTransform: "uppercase", letterSpacing: "0.08em" }}>{text}</h2>
      </div>
    );
  } else {
    elements.push(
      <div key={i} style={{ borderBottom: `1px solid #e8e0d5`, marginTop: 28, marginBottom: 10, paddingBottom: 6 }}>
        <h2 style={{ color: ARC_NAVY, fontSize: 16, fontWeight: 400, margin: 0, fontFamily: "Inter, Arial, sans-serif", letterSpacing: "0.02em" }}>{text}</h2>
      </div>
    );
  }
```

- [ ] **Step 3: Add group-aware handling at the top of the forEach body**

Immediately after `if (inTable) flushTable(i);` (and the table title detection block), add a new block before the `if (line.startsWith("### "))` check:

```js
// Group-aware parsing for Detailed Analysis
if (currentSection === "detailed") {
  const trimmedLine = line.trim();

  // ### starts a new document group
  if (trimmedLine.startsWith("### ")) {
    if (currentClause) { groupBuffer?.clauses.push(currentClause); currentClause = null; }
    if (groupBuffer && groupBuffer.clauses.length > 0) {
      elements.push(
        <DocumentGroup key={`grp-${i}`} docName={groupBuffer.docName} clauses={groupBuffer.clauses} onCitationClick={onCitationClick} />
      );
    }
    groupBuffer = { docName: trimmedLine.slice(4).trim(), clauses: [] };
    return;
  }

  // If we're inside a document group, handle all lines within it
  if (groupBuffer) {
    // Citation line: *Doc | Clause*
    const isCitationLine = trimmedLine.startsWith("*") && trimmedLine.endsWith("*") && trimmedLine.includes("|") && !trimmedLine.startsWith("**") && trimmedLine.length > 2;
    if (isCitationLine) {
      if (currentClause) groupBuffer.clauses.push(currentClause);
      const { docName, heading } = parseCitation(trimmedLine.slice(1, -1));
      currentClause = { heading, docName, lines: [] };
      return;
    }

    // Figure note: *See Fig. X.X — ...*  (has * wrapping, no |, matches "see fig")
    const isFigureNote = trimmedLine.startsWith("*") && trimmedLine.endsWith("*") && !trimmedLine.includes("|") && trimmedLine.length > 2 && !trimmedLine.startsWith("**") && /see fig/i.test(trimmedLine);
    if (isFigureNote && currentClause) {
      currentClause.lines.push({ text: trimmedLine.slice(1, -1), figureNote: true });
      return;
    }

    // Verbatim text — attach to current clause
    if (currentClause && trimmedLine) {
      currentClause.lines.push({ text: line, figureNote: false });
      return;
    }

    // Skip blank lines and unrecognised lines within the group
    return;
  }
}
```

- [ ] **Step 4: Flush the final group after the forEach loop**

After the existing `if (inTable) flushTable("end");` line, add:

```js
if (currentSection === "detailed") flushGroup("end");
```

- [ ] **Step 5: Commit**

```bash
git add client/src/components/common/AnswerRenderer.jsx
git commit -m "feat: group Detailed Analysis citations into collapsible document cards"
```

---

### Task 4: Browser verification

**Files:** None — manual verification only.

- [ ] **Step 1: Start the dev server**

```bash
cd C:/Users/ngree/Archimind/Vaultmind/client
npm start
```

- [ ] **Step 2: Run a test question**

Open the app and ask a question that typically returns 4+ citations across multiple documents (e.g. a stair or fire egress question). Wait for the answer.

- [ ] **Step 3: Verify Detailed Analysis**

Check all of the following:
- Detailed Analysis shows collapsible document cards, not a flat list of citation blocks
- Each card collapsed state shows document name (bold) and clause headings (grey, dot-separated)
- Clicking a card expands it to reveal clause blocks
- Each clause block shows clause heading in teal uppercase + `↗ open` button inline on the right
- Clicking `↗ open` opens the PDF viewer at the correct page for that clause
- If a figure note is present (`See Fig. X.X — ...`), it appears as small italic text at the end of the clause with its own open link
- Summary, Contradictions, and Practical Conclusion sections look unchanged

- [ ] **Step 4: Test fallback (old-format answer)**

If there's a previous answer in the history sidebar (generated before this change), click it and confirm it still renders without errors. It won't have grouped cards, but it should not crash — citation lines should fall through to existing `CitationLine` rendering.

- [ ] **Step 5: Commit verification note**

```bash
git commit --allow-empty -m "chore: verified grouped citation cards working in browser"
```
