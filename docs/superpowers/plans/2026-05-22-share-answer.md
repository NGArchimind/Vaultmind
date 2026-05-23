# Share Answer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Share button below vault Q&A answers that lets users copy a 7-day shareable link or open their email client with the link pre-filled.

**Architecture:** A new `shared_answers` Supabase table stores Q&A pairs with a 7-day expiry. Two new server endpoints handle create and read. A standalone `SharePage.jsx` component renders at `/share/:id` (detected in `index.js` before the main app mounts) using the existing `AnswerRenderer`. A `ShareModal.jsx` provides the copy/email UI. App.js gains a Share button below the answer card.

**Tech Stack:** React (CRA, no React Router), Express/Node.js, Supabase (PostgreSQL), deployed on Vercel + Railway.

---

### Task 1: Database — create shared_answers table

**Files:**
- Manual step: run SQL in Supabase dashboard

- [ ] **Step 1: Run the following SQL in the Supabase dashboard (SQL Editor tab)**

```sql
CREATE TABLE IF NOT EXISTS shared_answers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question    text NOT NULL,
  answer      text NOT NULL,
  vault_name  text,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);
ALTER TABLE shared_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON shared_answers FOR SELECT USING (true);
CREATE POLICY "Auth insert" ON shared_answers FOR INSERT WITH CHECK (auth.role() = 'authenticated');
```

- [ ] **Step 2: Verify the table exists**

In the Supabase Table Editor, confirm `shared_answers` appears with columns: `id`, `question`, `answer`, `vault_name`, `created_by`, `created_at`, `expires_at`.

---

### Task 2: Server — shared answers endpoints

**Files:**
- Modify: `server/index.js` — add two endpoints before line 4133 (the health + catchall routes)

- [ ] **Step 1: Add the POST endpoint**

In `server/index.js`, immediately before the line `app.get("/health", ...)`, insert:

```js
// ── Shared Answers ────────────────────────────────────────────────────────────
app.post("/api/shared-answers", requireAuth, async (req, res) => {
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

app.get("/api/shared-answers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from("shared_answers")
      .select("question, answer, vault_name, expires_at")
      .eq("id", id)
      .single();
    if (error || !data) return res.status(404).json({ error: "not_found" });
    if (new Date(data.expires_at) < new Date()) return res.status(404).json({ error: "not_found" });
    res.json(data);
  } catch (err) {
    return serverError(res, err, "GET /api/shared-answers/:id");
  }
});
```

- [ ] **Step 2: Verify endpoints start correctly**

Run the server locally (or check Railway logs after deploy). Confirm no syntax errors. You can test with:

```bash
curl -X POST https://archimind.up.railway.app/api/shared-answers \
  -H "Content-Type: application/json" \
  -d '{"question":"test","answer":"test answer","vault_name":"Test"}' \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Expected: `{"id":"some-uuid"}`

- [ ] **Step 3: Commit**

```
git add server/index.js
git commit -m "feat: add shared-answers server endpoints"
```

---

### Task 3: SharePage.jsx — public standalone share page

**Files:**
- Create: `client/src/components/SharePage.jsx`

- [ ] **Step 1: Create the file**

Create `client/src/components/SharePage.jsx` with this content:

```jsx
import { useState, useEffect } from "react";
import AnswerRenderer from "./common/AnswerRenderer";
import { VAULT_FULL } from "../constants";

const API_BASE = process.env.REACT_APP_API_URL || "https://archimind.up.railway.app";

export default function SharePage({ id }) {
  const [state, setState] = useState("loading"); // "loading" | "loaded" | "error"
  const [answer, setAnswer] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/shared-answers/${id}`)
      .then(r => {
        if (!r.ok) return setState("error");
        return r.json().then(d => { setAnswer(d.answer); setState("loaded"); });
      })
      .catch(() => setState("error"));
  }, [id]);

  return (
    <div style={{ minHeight: "100vh", background: "#f1f2f4", fontFamily: "Inter, Arial, sans-serif" }}>
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px 80px" }}>

        {state === "loading" && (
          <div style={{ textAlign: "center", marginTop: 80, color: "#9a9aa0", fontSize: 13 }}>
            Loading…
          </div>
        )}

        {state === "error" && (
          <div style={{ textAlign: "center", marginTop: 80 }}>
            <p style={{ fontSize: 18, fontWeight: 300, color: "#262830", marginBottom: 8 }}>
              This link has expired or is not available.
            </p>
            <p style={{ fontSize: 13, color: "#9a9aa0" }}>
              Shared answers are available for 7 days.
            </p>
          </div>
        )}

        {state === "loaded" && answer && (
          <div>
            <div style={{
              background: "#ffffff",
              border: "1px solid #e4e4e8",
              borderTop: `4px solid ${VAULT_FULL}`,
              padding: "24px 28px",
              marginBottom: 24
            }}>
              <AnswerRenderer text={answer} onCitationClick={null} accentColor={VAULT_FULL} />
            </div>
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 32 }}>
          <p style={{ fontSize: 10, color: "#c0c0c8", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Powered by Archimind
          </p>
        </div>

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```
git add client/src/components/SharePage.jsx
git commit -m "feat: add SharePage public share component"
```

---

### Task 4: ShareModal.jsx — share modal component

**Files:**
- Create: `client/src/components/ShareModal.jsx`

- [ ] **Step 1: Create the file**

Create `client/src/components/ShareModal.jsx` with this content:

```jsx
import { useState } from "react";
import { api } from "../api/client";
import { VAULT_FULL, DESIGN_TEXT, DESIGN_MUTED } from "../constants";

export default function ShareModal({ question, answer, vaultName, shareId, setShareId, onClose }) {
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  async function getOrCreateLink() {
    if (shareId) return `${window.location.origin}/share/${shareId}`;
    setLoading(true);
    try {
      const { id } = await api("/api/shared-answers", {
        method: "POST",
        body: { question, answer, vault_name: vaultName }
      });
      setShareId(id);
      return `${window.location.origin}/share/${id}`;
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyLink() {
    const link = await getOrCreateLink();
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleEmail() {
    const link = await getOrCreateLink();
    const subject = encodeURIComponent(`Archimind: ${question}`);
    const body = encodeURIComponent(
      `I used Archimind to look this up — see the full formatted answer here:\n\n${link}`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center"
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#ffffff", borderTop: `4px solid ${VAULT_FULL}`,
          padding: "28px 32px", width: 360, position: "relative",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)"
        }}
      >
        <button
          onClick={onClose}
          style={{ position: "absolute", top: 12, right: 16, background: "none", border: "none", fontSize: 18, color: "#9a9aa0", cursor: "pointer", lineHeight: 1 }}
        >×</button>

        <p style={{ fontSize: 11, fontWeight: 700, color: DESIGN_MUTED, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 20 }}>
          Share Answer
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={handleCopyLink}
            disabled={loading}
            style={{
              background: copied ? "#e8f5f0" : VAULT_FULL,
              color: copied ? VAULT_FULL : "#ffffff",
              border: `1px solid ${VAULT_FULL}`,
              padding: "10px 16px", fontSize: 12, fontWeight: 600,
              letterSpacing: "0.06em", cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "Inter, Arial, sans-serif", textAlign: "left",
              opacity: loading ? 0.6 : 1
            }}
          >
            {copied ? "✓ Copied" : loading ? "Generating link…" : "Copy Link"}
          </button>

          <button
            onClick={handleEmail}
            disabled={loading}
            style={{
              background: "none", border: "1px solid #d0ccc8", color: "#7a7a80",
              padding: "10px 16px", fontSize: 12, fontWeight: 600,
              letterSpacing: "0.06em", cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "Inter, Arial, sans-serif", textAlign: "left",
              opacity: loading ? 0.6 : 1
            }}
          >
            Open in Email
          </button>
        </div>

        <p style={{ fontSize: 10, color: "#c0c0c8", marginTop: 16, letterSpacing: "0.04em" }}>
          Links expire after 7 days.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```
git add client/src/components/ShareModal.jsx
git commit -m "feat: add ShareModal component"
```

---

### Task 5: Wire up routing, state, and Share button in App.js + index.js

**Files:**
- Modify: `client/src/index.js`
- Modify: `client/src/App.js`

#### Part A — index.js routing

- [ ] **Step 1: Read `client/src/index.js` then replace its full content**

Replace `client/src/index.js` with:

```jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SharePage from "./components/SharePage";

const root = ReactDOM.createRoot(document.getElementById("root"));

const shareMatch = window.location.pathname.match(/^\/share\/([^/]+)/);
if (shareMatch) {
  root.render(<React.StrictMode><SharePage id={shareMatch[1]} /></React.StrictMode>);
} else {
  root.render(<React.StrictMode><App /></React.StrictMode>);
}
```

#### Part B — App.js: imports and state

- [ ] **Step 2: Add ShareModal import to App.js**

In `client/src/App.js`, add this import after the QuizModal import (line 11):

```js
import ShareModal from "./components/ShareModal";
```

- [ ] **Step 3: Add shareId and showShareModal state to App.js**

Find the line `const [showQuiz, setShowQuiz] = useState(false);` (line ~214) and add after it:

```js
const [shareId, setShareId] = useState(null);
const [showShareModal, setShowShareModal] = useState(false);
```

- [ ] **Step 4: Add useEffect to reset shareId when answer changes**

Find the block of existing `useEffect` calls in App.js. Add this effect (it can go near the other effects that watch `answer`):

```js
useEffect(() => { setShareId(null); }, [answer]);
```

#### Part C — App.js: Share button and modal render

- [ ] **Step 5: Add Share button inside the `{answer && ...}` block**

Find this comment and closing `</div>` in App.js (around line 1678-1680):

```jsx
                          )}
                        </div>
                      )}
```

This is the end of the `{!isRunning && allQueryableVaults.length > 1 && ...}` follow-up vault block, and the closing of the outer `{answer && ...}` wrapper div. Insert the Share button just before the final `</div>` that closes the `{answer && ...}` wrapper:

```jsx
                          {/* ── Share button ── */}
                          {!isRunning && (
                            <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
                              <button
                                onClick={() => setShowShareModal(true)}
                                style={{ background: "none", border: "1px solid #d0ccc8", color: "#7a7a80", padding: "4px 12px", fontSize: 11, letterSpacing: "0.04em", cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}
                              >
                                Share
                              </button>
                            </div>
                          )}
```

- [ ] **Step 6: Add ShareModal render to App.js**

Find the line `{showQuiz && <QuizModal onClose={() => setShowQuiz(false)} />}` (line ~1240) and add after it:

```jsx
      {showShareModal && answer && (
        <ShareModal
          question={question}
          answer={answer}
          vaultName={answerVaultName}
          shareId={shareId}
          setShareId={setShareId}
          onClose={() => setShowShareModal(false)}
        />
      )}
```

- [ ] **Step 7: Verify the app compiles**

Run in the `client/` directory:

```bash
npm start
```

Expected: app starts with no console errors. The vault Q&A section should show a "Share" button below any answer.

- [ ] **Step 8: Commit**

```
git add client/src/index.js client/src/App.js
git commit -m "feat: wire Share button and ShareModal into vault Q&A"
```

---

### Task 6: vercel.json — SPA catch-all rewrite

**Files:**
- Create: `client/vercel.json`

- [ ] **Step 1: Create the file**

Create `client/vercel.json` with:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

- [ ] **Step 2: Commit**

```
git add client/vercel.json
git commit -m "feat: add Vercel SPA rewrite for /share/* routes"
```

---

### Task 7: Deploy and test end-to-end

- [ ] **Step 1: Deploy server to Railway**

Push `server/index.js` changes. Confirm Railway build succeeds.

- [ ] **Step 2: Deploy client to Vercel**

Push client changes. Confirm Vercel build succeeds.

- [ ] **Step 3: Test Copy Link**

1. Ask a question in the vault — wait for an answer.
2. Click the "Share" button below the answer.
3. Click "Copy Link" in the modal.
4. Confirm the button shows "✓ Copied" briefly.
5. Paste the link in a new browser tab (or incognito).
6. Confirm the share page loads showing the formatted answer — identical to the in-app view.
7. Confirm there is no nav bar, no login prompt, and the footer says "Powered by Archimind".

- [ ] **Step 4: Test Open in Email**

1. Click "Share" again on the same answer.
2. Click "Open in Email".
3. Confirm your email client opens with subject `Archimind: [your question]` and the link in the body.
4. Confirm clicking the link in the email takes you to the same formatted share page.

- [ ] **Step 5: Test modal reuse (same answer, same link)**

1. Close the modal and reopen Share on the same answer.
2. Click "Copy Link" again.
3. Confirm the copied link is the **same UUID** as the first time (no duplicate row created).

- [ ] **Step 6: Test expired link (optional)**

To simulate expiry, update a row directly in Supabase:
```sql
UPDATE shared_answers SET expires_at = now() - interval '1 day' WHERE id = 'your-uuid';
```
Then visit the link — confirm the page shows "This link has expired or is not available."
