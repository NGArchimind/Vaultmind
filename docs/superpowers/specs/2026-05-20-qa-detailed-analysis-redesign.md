# QA Answer — Detailed Analysis Redesign

**Date:** 2026-05-20
**Status:** Approved

## Problem

The Detailed Analysis section of QA answers is too fragmented. Each citation appears as an independent block (citation header card → verbatim text → optional note), so a typical answer with 7–10 citations produces 7–10 separate chunks to scroll through. Summary and tables work well; the Detailed Analysis is the pain point.

## Design Goals

- Reduce visual fragmentation in Detailed Analysis without losing any information
- Keep verbatim text accessible but not the first thing you see
- Preserve per-clause navigation (the `↗ open` link to the source PDF page)
- Add lightweight diagram/figure references at zero extra token cost
- No changes to Summary, Contradictions, or Practical Conclusion sections

## Design

### Output format change (answerPrompt in App.js)

The Detailed Analysis prompt instructions change to require a `###` document group header before each document's citations. All clauses from the same document are grouped together under that header.

New format Gemini outputs:

```
## Detailed Analysis

### Approved Document K — Protection from Falling
*Approved Document K | K1 Stairs, ladders and ramps*
The rise and going of any step shall be consistent throughout any flight of stairs...

*Approved Document K | K2 Protection from falling*
Guarding shall be capable of resisting the horizontal force given in BS 6399-1...
*See Fig. 2.1 — minimum guarding heights diagram*

### BS 5395-1:2010 — Stairs, Ladders and Walkways
*BS 5395-1 | 4.2 Rise and going*
The going of each step shall be not less than 220mm...
```

All existing citation rules remain unchanged:
- Skip generic duty statements with no specific requirements
- Combine sub-clauses of the same parent section into one block
- One citation block per unique source location
- Omit pure cross-reference clauses

**Figure/diagram notes:** When a diagram or figure on an extracted page is directly relevant to the answer, Gemini adds a brief note on its own line immediately after the relevant clause verbatim text:
```
*See Fig. X.X — [one-phrase description of what it shows]*
```
This is the only change to what Gemini outputs for diagrams — no image extraction, no extra tokens. The user clicks `↗ open` on the clause to navigate to that page and see the actual diagram.

### Renderer changes (AnswerRenderer.jsx)

**Section tracking.** The renderer tracks which `##` section it is currently inside. Summary, Contradictions, and Practical Conclusion render exactly as today.

**Group-aware parsing for Detailed Analysis.** Inside `## Detailed Analysis`, `###` lines mark the start of a document group. The renderer collects all citation lines and verbatim text that follow into that group until the next `###` or `##`. Each complete group is rendered as a `DocumentGroup` component.

**New `DocumentGroup` component:**
- Collapsible card with its own `useState` for expand/collapse
- Collapsed state: document display name (bold) + all clause headings joined by ` · ` (grey, small). "Clause heading" = the portion of the citation text after `|` (e.g. `K1 Stairs, ladders and ramps`)
- Expanded state: each clause rendered as a `ClauseBlock`
- No `↗ open` button on the collapsed header — navigation is per-clause only

**New `ClauseBlock` component:**
- Clause heading in teal uppercase (11px, letter-spaced) with `↗ open` button inline on the right
- Verbatim text below, left-bordered (matching current blockquote style)
- Figure note lines (`*See Fig. X.X — ...*`) rendered as small italic text at the end of the clause, with a `↗ open` link attached — uses the same `docName` and `heading` citation key as the clause it follows, so it navigates to the same PDF page

**Existing `CitationLine` component:** Retained. Still used if citations appear in Contradictions or other sections outside Detailed Analysis.

### What does NOT change

- Summary section rendering
- Table rendering
- Contradictions & Conflicts rendering
- Practical Conclusion rendering
- Citation click / PDF navigation logic (`handleCitationClick`, `citationPageMap`)
- Pass 1 and Pass 2 pipeline
- Backend / server — no changes

## Files to change

| File | Change |
|---|---|
| `client/src/App.js` | Edit `answerPrompt` via Python replacement script — update Detailed Analysis instructions and add figure note rule |
| `client/src/components/common/AnswerRenderer.jsx` | Add section tracking; add `DocumentGroup` and `ClauseBlock` components; switch Detailed Analysis to group-aware parsing |

## Editing answerPrompt

`answerPrompt` is one very long single-line string — the Edit tool cannot reliably match it. Use a Python replacement script:
1. Write a `.py` script that reads `App.js`, finds the old Detailed Analysis instruction block by a unique anchor string, replaces it with the new instructions, and writes the file back
2. Run the script
3. Delete the script

## Risks

- **Existing history answers:** Answers stored in `conversationHistory` and the history sidebar were generated with the old format. They will re-render through the updated renderer, which won't find `###` group headers and will fall back to rendering them as plain `###` headings (current behaviour for `### ` lines). This is acceptable — old answers still display correctly, just without grouped cards.
- **Gemini non-compliance:** If Gemini occasionally omits the `###` group header, those citations will render as plain citation lines (current behaviour), not as a grouped card. No data loss, just no grouping for that response. The `answerPrompt` instructions and the one-line system prompt string in the `callClaude` call (~line 1034 of App.js) both need updating to reinforce the `###` grouping requirement.
