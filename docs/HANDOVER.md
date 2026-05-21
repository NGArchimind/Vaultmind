# Vaultmind — Developer Handover Notes

Supplementary detail for things that aren't obvious from reading the code.
The main session guide is `CLAUDE.md` at the repo root.

---

## Editing `answerPrompt` in App.js

`answerPrompt` is a single very long string on one line in `client/src/App.js`. The Edit tool cannot reliably match it because it spans thousands of characters and may contain special characters that break string matching.

**Pattern: use a Python replacement script**

1. Write a small Python file that reads App.js, does a targeted string replacement, and writes it back:

```python
# fix_prompt.py
with open("client/src/App.js", "r", encoding="utf-8") as f:
    content = f.read()

old = "...exact substring to replace..."
new = "...replacement..."

assert old in content, "String not found — check the substring"
content = content.replace(old, new, 1)

with open("client/src/App.js", "w", encoding="utf-8") as f:
    f.write(content)

print("Done")
```

2. Run it: `python fix_prompt.py`
3. Delete `fix_prompt.py`
4. Verify the change looks right in App.js before restarting the server.

The assertion ensures the script fails loudly rather than silently doing nothing if the substring has drifted.

---

## mupdf worker thread (extract-pages endpoint)

**File:** `server/workers/extractPages.worker.js`
**Used by:** `POST /api/extract-pages` in `server/index.js`

mupdf's WASM runtime calls `abort()` on malformed PDFs (e.g. "AD Part O - Overheating.pdf"). This cannot be caught with `try/catch` and drops the socket connection — the browser reports it as a CORS error with a null status code.

The fix runs mupdf inside a `worker_thread`. If WASM aborts, only the worker process dies. The main server catches the worker's `error` event and falls through to the pdf-lib fallback, returning a clean HTTP 500 that the client handles gracefully (skips the PDF and continues).

**Why mupdf must stay in this endpoint:** mupdf's compressed output is significantly smaller than pdf-lib's. The extracted pages are sent as base64 document blocks to Gemini, which has file size limits. pdf-lib output for large technical PDFs can exceed those limits.

**Why mupdf must stay in `/api/extract-text`:** pdf-lib has no text extraction capability. Removing mupdf from that endpoint returns empty text and breaks the entire QA pipeline.

---

## R2 / PDF serving pattern

PDFs are never served via presigned R2 URLs to the client — R2 CORS blocks the browser from reading the response. Instead, the server fetches from R2 and returns `{ base64 }` JSON to the client. The client decodes this and passes it as a data URI or ArrayBuffer to the PDF viewer / mupdf / pdf-lib.

---

## Temp doc Q&A — fixes applied (2026-05-21)

**Problem 1: Search buttons were broken** — both Search buttons (temp doc section ~line 1425, vault section ~line 1671) used `onClick={askQuestion}`, which accidentally passed the browser's click event as the `overrideVaultId` argument. This triggered the cross-vault code path with a garbage ID, causing "That vault has not been indexed yet." Fix: both changed to `onClick={() => askQuestion()}`.

**Problem 2: Silent error display** — the temp doc content area only showed `statusMsg` if it started with `"Error:"`. Timeout and rate-limit messages don't start with that, so query failures were invisible: question cleared, spinner ran, fell back to idle UI with no message. Fixed by changing the render condition to show any non-empty statusMsg except `"Answer ready"`.

**Problem 3: Question cleared too early** — the original `setQuestion("")` was at the very top of `askQuestion()`, before the async indexing wait. So if the user pressed Enter while still indexing, the question vanished immediately even if the query then aborted. Fixed: `setQuestion("")` moved to after the indexing wait and early-return guards — the question only clears once the pipeline is committed to running.

**useEffect for temp doc focus** (around line 347): fires when `tempDocIndexing` flips from true→false with a valid `tempDocIndex`. Focuses the temp doc textarea and clears any stale statusMsg so the next query starts clean.

---

## Deployment

| Target | How |
|--------|-----|
| Client changes | Push to Vercel (auto-deploys from git) |
| Server changes | Push to Railway (auto-deploys from git) |
| ArchiSync desktop | `npm run dist` in `archimind-sync/archimind-sync/` → distribute new `.exe` |
