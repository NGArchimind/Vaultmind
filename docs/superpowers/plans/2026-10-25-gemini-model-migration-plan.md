# Moving Archimind off Gemini 2.5: plan (awaiting Nathan's approval)

Written 2026-10-25. **Research only. No code has been changed.** Every step below needs Nathan's go-ahead, and staging comes first.

---

## 1. The short version

- **This isn't urgent. Nothing is switching off on 16 Oct or any other date.** Google's official deprecations page lists **no shutdown date** for `gemini-2.5-flash`, `gemini-2.5-pro` or `gemini-2.5-flash-lite`. The 18 Sep 2026 notice says the 2.5 models are **"not deprecated"** and will be served **"until further notice"**, but only to accounts that "have actively used them in the past". Archimind's key has, so we're covered for now. The 16 Oct date from the forums is wrong.
- **The real risk is a new Google project or API key.** It would count as a *new* user and could be locked out of 2.5 straight away, which would break every AI feature at once. Until we've migrated, **keep the existing `GEMINI_API_KEY` and Google project**. Top up the prepaid credit on that same project; don't create a new one.
- **Embeddings are not affected.** `gemini-embedding-001` isn't part of the 2.5 restriction and is scheduled to run until **14 May 2028** (replacement: `gemini-embedding-2`). **No vault or email re-indexing is needed** for this move.
- **Recommendation:** plan the move now and do it calmly in two stages:
  1. Server only, no visible change: make the server able to speak the "Gemini 3" style.
  2. Switch the models over on staging behind a setting, run a fixed benchmark of questions old-vs-new, then decide.

  The Q&A logic in `App.js` (`askQuestion`, prompts, citations, parsing) **doesn't need to change at all**.

---

## 2. Where the models are used today (every reference)

### Main Q&A pipeline (client → `/api/claude` in `server/index.js`)

| Where | What it does | Model it asks for | Model it actually gets |
|---|---|---|---|
| `client/src/App.js:340, 351, 378` | **Vault indexing** (building the heading index for a new PDF) | `gemini-2.5-flash-lite` | ⚠️ **`gemini-2.5-flash`** (see the bug below) |
| `client/src/App.js:623` | **Pass 1**: score the heading index and return JSON | `gemini-2.5-flash` | same |
| `client/src/App.js:1054` | **Pass 3**: write the final answer | `gemini-2.5-pro` | same |
| `client/src/App.js:1061` | Pass 3 fallback if Pro fails | `gemini-2.5-flash` | same |
| `client/src/App.js:1088` + `client/src/geminiCost.js` | Cost estimate shown after an answer | price table for 2.5 Flash / Pro | n/a |

**Existing silent bug (harmless, but worth knowing):** `server/index.js:47` only allows `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash-lite` and `gemini-1.5-flash`. Anything not on that list falls back to `gemini-2.5-flash`. So indexing has **never actually run on Flash-Lite**; it has always used Flash. Two models on the list are also dead: `gemini-2.0-flash-lite` was shut down on 1 Jun 2026, and `gemini-1.5-flash` is long gone.

### Other client features that also go through `/api/claude`

| Where | Feature | Model |
|---|---|---|
| `client/src/api/client.js:50` | `askGemini` default | `gemini-2.5-flash` |
| `components/CompareSection.jsx:118, 119, 161, 252, 473` | Document Compare | `gemini-2.5-flash` (some with `thinking: false`, temperature 0.7 / 0.1) |
| `components/CompareSection.jsx:209, 337` | Compare (small steps) | `gemini-2.5-flash-lite` (really gets Flash) |
| `components/DatasheetsLibrarySection.jsx:286, 681` | Product Library | `gemini-2.5-flash` (286 with `thinking: false`) |
| `components/DatasheetsLibrarySection.jsx:541` | Product Library (small step) | `gemini-2.5-flash-lite` (really gets Flash) |
| `components/projects/QABar.jsx:251` | Projects Q&A bar | `gemini-2.5-flash` |

### Server features that call Gemini directly (model name typed into the URL)

| Where | Feature | Notable settings |
|---|---|---|
| `server/helpers/gemini.js:11` | Drawing text extraction (sends the PDF) | temperature 0 |
| `server/helpers/gemini.js:31` | Drawing embeddings | `gemini-embedding-001`, 768 dims. **No change** |
| `server/routes/projectsAi.js:299` | Drawing search: extract search terms | **maxOutputTokens 200** |
| `server/routes/projectsAi.js:450` | Agreements: extract from text | temperature 0 |
| `server/routes/projectsAi.js:517` | Agreements: ask | maxOutputTokens 1500 |
| `server/routes/projectsAi.js:585` | Email embeddings | `gemini-embedding-001`. **No change** |
| `server/routes/projectsAi.js:610` | Email structured summary | **maxOutputTokens 300** |
| `server/routes/projectsAi.js:649` | Email search query expansion | **maxOutputTokens 100** |
| `server/routes/projectsAi.js:922` | Emails: ask | maxOutputTokens 1500 |
| `server/routes/quiz.js:238` | Admin quiz generation | temperature 0.4 |
| `server/routes/schedule.js:359` | Schedule CSV/table extraction (JSON) | temperature 0, JSON mode |
| `server/helpers/projectMap.js:22` (+ `routes/projectMap.js:92`, `helpers/projectMap.js:69`) | Project DataMap | **`thinkingBudget` 1024 / 0 / 2048**, JSON mode |

That's **one proxy (`/api/claude`), 7 client call sites, and 11 direct server calls** using generation models. There are also 2 embedding calls, which stay as they are.

---

## 3. What Google offers now (checked 2026-10-25 on ai.google.dev)

Paid-tier prices, USD per 1M tokens. Thinking tokens are billed as output.

| Model | Status | Input | Output | Thinking options | Good for |
|---|---|---|---|---|---|
| `gemini-2.5-flash` (today) | grandfathered | $0.30 | $2.50 | can switch off | — |
| `gemini-2.5-pro` (today) | grandfathered | $1.25 | $10.00 | — | — |
| **`gemini-3.8-flash`** | GA 2 Sep 2026; Google's recommendation | $0.75 → **$1.50 from 1 Jan 2027** | $3.75 → **$7.50 from 1 Jan 2027** | low / medium (default) / high. **Can't be switched off**; "minimal" is an error | Pass 1, Pass 3, general Flash work |
| `gemini-3.6-flash` | GA 21 Jul 2026 | same as 3.8 | same as 3.8 | minimal / low / medium (default) / high | fallback / rollback option |
| **`gemini-3.5-flash-lite`** | GA 21 Jul 2026; Google's other recommendation | $0.30 | $2.50 | minimal (default) / low / medium / high | indexing, small "thinking off" jobs |
| `gemini-4-argon` | GA 13 Oct 2026, flagship | $2.00 → **$4.00 from 1 Dec 2026** | $10.00 → **$20.00 from 1 Dec 2026** | low / medium / high | possible Pro replacement for Pass 3 |
| `gemini-3.1-pro-preview` | still **preview** | $2.00 | $12.00 | — | avoid (preview models get switched off at short notice) |

**What this means for cost:** 3.5 Flash-Lite costs exactly what 2.5 Flash costs today. 3.8 Flash is about 2.5× (input) / 1.5× (output) more expensive now, and **5× / 3× from January**. Gemini 4 Argon is about the same as 2.5 Pro until 30 Nov, then double. On prepaid credit, the balance will run down faster after the switch, and again in January. Re-check the price table before each phase, because these are announced price rises.

**Request size:** the old "~20 MB" figure is now generous. Google currently documents **100 MB per inline request, 50 MB / 1,000 pages per PDF**. **Keep the 15 MB Pass 2 budget anyway.** It also protects the Railway container and the timeouts, and changing it is a separate pipeline decision.

**The generateContent API** (the one Archimind uses) is now labelled **"Legacy"** in Google's docs, behind their new "Interactions API". It still works and has no end date, and Google's own 3.7 Flash REST examples still use it. **We aren't changing API.** That would be a much bigger rewrite. Flag it for the future.

---

## 4. What changes in behaviour with Gemini 3.x (the risks)

These are the important bit. None of them are about the prompts. They're about the request settings.

1. **Thinking can't be fully switched off on 3.8 Flash, and it eats into the output limit.** Google: max output tokens is the limit "including thought tokens", and if it's hit while thinking the answer can come back **truncated or empty**.
   - Danger spots: the small limits in `projectsAi.js` (100 / 200 / 300 tokens) and anything sent with `thinking: false` (Compare, Product Library).
   - Fix: send those small jobs to **3.5 Flash-Lite on "minimal"**, which is the closest thing to "off", and give 3.8 Flash calls a sensible thinking level instead of a tiny token cap.
   - Pass 1 and Pass 3 already use 65,000-token limits, so they're safe.
2. **`thinkingBudget` is "legacy".** It's accepted for backward compatibility, but Google doesn't document what `0` does on 3.x models. It can't be combined with the new `thinkingLevel` (400 error).
   - Fix: the server translates. 2.5 models keep getting exactly today's `thinkingBudget`. 3.x models get `thinkingLevel`: `0` → minimal/low, 1024 → low, 2048 → medium.
3. **Temperature is ignored on 3.x.** Google: "The API ignores these parameters and returns an error in future model generations", and lowering it "may lead to unexpected behaviour, such as looping". Today Q&A runs at 0.1, so answers are fairly repeatable.
   - On 3.x, **answers may vary a bit more from run to run**, including the Pass 1 JSON. The JSON sanitiser and salvage code stay in place.
   - Fix: don't send temperature to 3.x models (2.5 keeps it).
4. **The "fake" opening exchange in `/api/claude`.** The proxy sends the system prompt as a user message followed by a pretend model reply ("Understood. I will follow these instructions."). Google's 3.8 checklist says to remove "prefilled model turns".
   - Google only documents a hard **400 error when the *last* turn is a model turn**, which ours never is. So it should still work.
   - This is the first thing the staging probe checks. If it fails, the fix is to move the system prompt into Gemini's proper `systemInstruction` field, for 3.x models only.
5. **PDFs are read differently.** Google says moving to Gemini 3 "may increase token usage for PDFs". Expect Pass 3 (which sends real PDF pages) and drawing extraction to cost a bit more per page and possibly read dense tables differently.
   - That's exactly what the benchmark checks: tables, diagrams and NHBC pages.
6. **Speed.** 3.8 Flash thinks by default ("medium") and Google says it spends more tokens on hard tasks. Pass 1 may get slower. Watch the 4-minute timeout on big vaults.
7. **Indexing quality.** Moving indexing to 3.5 Flash-Lite is a real model change (it's been on 2.5 Flash all along because of the bug above). **It only affects PDFs indexed after the switch.** Existing vault indexes stay as they are. Test it by indexing one copy of a known document into a test vault.
8. **Staging is not isolated.** Staging shares the production Supabase database and the same Google key and credit. Benchmark runs spend real credit, and indexing on staging writes to real tables. Use a dedicated test vault.

---

## 5. Recommended model mapping

| Job | Today | Proposed | Why |
|---|---|---|---|
| Pass 1: scoring | 2.5 Flash | **3.8 Flash, thinking "low"** | JSON from a text index; low thinking keeps it quick |
| Pass 3: answer | 2.5 Pro (Flash fallback) | **Benchmark two candidates:** (a) **3.8 Flash "high"**, (b) **Gemini 4 Argon "medium"**. Fallback = 3.8 Flash "medium" | Argon is the closest to "Pro" quality but doubles in price on 1 Dec; 3.8 Flash "high" may be good enough for much less. Let the benchmark decide |
| Vault indexing (meant to be Flash-Lite) | 2.5 Flash (by accident) | **3.5 Flash-Lite, "low"** | Same price as today; Google's recommended lite model. If headings get worse, use 3.8 Flash "low" instead |
| `thinking: false` callers (Compare, Library) | 2.5 Flash, no thinking | **3.5 Flash-Lite "minimal"** | Nearest equivalent to "no thinking" |
| Other Flash work (Compare main, Library, QABar, projectsAi, quiz, schedule, DataMap, drawing extraction) | 2.5 Flash | **3.8 Flash "low"** (DataMap's 2048 budget → "medium") | Like-for-like |
| Small-limit helpers (`projectsAi.js` 299 / 610 / 649) | 2.5 Flash, 100–300 tokens | **3.5 Flash-Lite "minimal"** | Avoids the empty-answer trap in risk 1 |
| Embeddings | `gemini-embedding-001` | **unchanged** | Not affected, runs to 2028, so no re-indexing |

---

## 6. Exact change list (nothing done yet; each phase needs approval)

### Phase A: server only, deploy to staging. Should make no visible difference.

1. **New file `server/helpers/models.js`**, one place that knows about models:
   - a `MODEL_MAP` that turns the names the app asks for into the names actually used, read from a Railway env var `GEMINI_MODEL_MAP` (JSON). **With the env var unset, the map is empty and everything uses today's 2.5 names**, so deploying Phase A changes nothing.
   - `buildGenerationConfig(model, { maxOutputTokens, temperature, thinking, thinkingBudget, responseMimeType })`. For `gemini-2.5-*` it returns **exactly today's object**. For 3.x/4.x it drops temperature and translates thinking into `thinkingLevel` (risk 2), and raises a too-small `maxOutputTokens` floor where needed (risk 1).
   - Small `node --test` suite (`server/lib`-style), covering: 2.5 config unchanged byte-for-byte, 3.x translation, map lookup.
2. **`server/index.js` `/api/claude` (lines 47–48, 84–90):** extend `ALLOWED_MODELS` with `gemini-2.5-flash-lite`, `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-4-argon`, and remove the dead `gemini-2.0-flash-lite` / `gemini-1.5-flash`. Then pass the chosen model through `MODEL_MAP` and build `generationConfig` with the helper.
   - ⚠️ Adding `gemini-2.5-flash-lite` to the list **would make indexing and the small Compare/Library steps start really using Flash-Lite**. That's a behaviour change, so either leave it off in Phase A or map it to `gemini-2.5-flash`. **Recommend: map it, so Phase A is truly a no-op.**
   - The message-building code (the system turn plus "Understood") stays as it is, unless the staging probe shows 3.x rejects it. In that case, 3.x requests use `systemInstruction` instead.
3. **The 11 direct server calls** (`helpers/gemini.js:11`, `projectsAi.js:299, 450, 517, 610, 649, 922`, `quiz.js:238`, `schedule.js:359`, `helpers/projectMap.js:22`): replace the typed-in `gemini-2.5-flash` with a resolved model name and build each `generationConfig` through the same helper. Each job gets a logical role (for example `"flash"`, `"flash-small"`) so the env map can route it. **Request bodies for 2.5 stay byte-identical.**
4. **No client changes and no SQL in Phase A.**

**Deploy:** server only → Railway **staging** (develop). Run the "no change" checks in §7 step 1. Then production, so both environments are ready for the switch.

### Phase B: switch on staging, using the env var only.

5. On **Railway staging only**, set `GEMINI_MODEL_MAP`, for example:
   `{"gemini-2.5-flash":"gemini-3.8-flash","gemini-2.5-pro":"gemini-3.8-flash@high","gemini-2.5-flash-lite":"gemini-3.5-flash-lite"}` (exact format to be finalised in Phase A).
   No code deploy. **Rollback = delete the env var.** Run the full benchmark (§7 step 2). Repeat with Pass 3 → `gemini-4-argon`.
6. When Nathan is happy, set the same env var on **Railway production**. Rollback is the same.

### Phase C: tidy-up, after a few weeks on the new models.

7. `client/src/geminiCost.js`: add the new models' prices so the cost shown after an answer is right. The server should return the model it actually used in `usage` so the client can price it. This is a client change, so it goes to Vercel.
8. Optionally rename the model strings in the client (`App.js` 340 / 351 / 378 / 623 / 1054 / 1061, Compare, Library, QABar, `client.js:50`) to the new names, and retire the env map. **This touches `askQuestion`, so it's optional and needs a separate approval.** The env map can stay permanently instead.
9. Update `CLAUDE.md` / `HANDOVER.md` ("Key tech" model names, plus a section on the model map).

---

## 7. Staging test plan

### Step 1: after Phase A (env var unset), check that nothing changed

- Ask 3 known vault questions and compare with production. Answers should match in structure and citations. Check the Railway logs show `gemini-2.5-*` URLs.
- Check one non-pipeline feature from each server file: drawing search, agreement ask, email ask, quiz generate (admin), a schedule extract, a DataMap ask.
- `node --test` for the new helper. Then `node -e "require('./routes/projectsAi')"` (and the same for quiz, schedule, projectMap) with dummy env, to catch missing-import errors. That's the lesson from the D3 refactor.

### Step 2: probe the new models (first thing after setting the env var on staging)

One quick request per model through `/api/claude`, before any real questions. It confirms:

- `generateContent` accepts the model;
- the "Understood" opening turn doesn't cause a 400;
- `thinkingLevel` values are accepted ("minimal" on 3.8 should be refused, which proves the translation is working);
- a 100-token job on 3.5 Flash-Lite returns text, not an empty answer.

### Step 3: the Q&A benchmark (old vs new, same questions, same vaults)

Run each question on **production (2.5)** and **staging (new)**, and record the answer, the citations, the time taken and the console logs. Suggested set of 10, chosen to hit every known weak spot:

1. Part M: a **M4(3)** question that needs that chapter's *General provisions* (the 38-page chapter case).
2. Part M: the matching **M4(2)** question (General provisions must **not** leak across chapters).
3. Part K: **guarding heights** (needs duty clause *and* implementation section, plus a diagram).
4. Part B Vol 2: a **table** value (fire resistance / cavity barriers).
5. NHBC: a question citing **6.1.6.2** (clicked citation must open p204, not p197).
6. NHBC: a question citing **6.1.17.3** (p229).
7. A **follow-up** question (conversation history).
8. A **multi-document** question (contradictions section populated).
9. A **definition on an appendix page** (known gap; just record whether it changes).
10. A deliberately **big** question that hits the 15 MB Pass 2 budget (check `[Pass3] Sending ~X MB`, the time and the 4-minute timeout).

For each one, check:

- all **four sections**, in the right order after `moveSummaryToTop`;
- citations in `*Exact Filename | Clause*` format;
- each citation **opens the right page**;
- General provisions titles appear;
- no `[Scoring]` JSON warnings, and no Pass 3 "falling back to Flash" message;
- time to answer;
- cost: compare the Google AI Studio usage page before and after the run, because `geminiCost.js` won't know the new prices until Phase C.

Run questions 1–5 **twice** on the new models to see how much answers vary now that temperature is ignored (risk 3).

### Step 4: indexing

Upload **one copy** of Part M into a **test vault** on staging. Compare its heading index (count and titles, especially the "General provisions" headings) with the existing Part M index. Then ask question 1 against it.

### Step 5: other features (one pass each)

Compare (two short PDFs), Product Library (add one datasheet), Projects Q&A bar, drawing upload → index → search, agreements extract + ask, email ingest + ask, quiz generate, schedule extract, DataMap ask. For each, check it returns something sensible and that Railway logs show no `400` / empty-response errors.

### Pass / fail

**Go to production** only if questions 1–8 are at least as good as 2.5 by Nathan's judgement, every citation opens the right page, there are no errors, and the time and cost are acceptable. Otherwise try the other Pass 3 candidate, or keep Pass 3 on 2.5 Pro (still available to us) and move only the rest.

---

## 8. Decisions for Nathan

1. Do the move now in calm phases (recommended), or stay on 2.5 until Google announces a date?
2. Approve **Phase A** (server-only plumbing, no visible change, staging first)?
3. For Pass 3, are you happy to benchmark **both** 3.8 Flash "high" and Gemini 4 Argon? Argon roughly doubles in price on 1 Dec 2026.
4. Agree to **keep the current Google project/API key** (no new key) until the move is finished?

---

### Sources (checked 2026-10-25)

- Release notes: https://ai.google.dev/gemini-api/docs/changelog (18 Sep 2026 2.5 access change; model launches)
- Deprecations: https://ai.google.dev/gemini-api/docs/deprecations (no 2.5 shutdown date; `gemini-embedding-001` → 14 May 2028)
- Pricing: https://ai.google.dev/gemini-api/docs/pricing
- Thinking: https://ai.google.dev/gemini-api/docs/thinking
- 3.8 Flash migration checklist: https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.8
- 3.6 Flash / 3.5 Flash-Lite (generateContent): https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.6
- Gemini 3 guide (temperature, PDFs): https://ai.google.dev/gemini-api/docs/gemini-3
- File/PDF limits: https://ai.google.dev/gemini-api/docs/file-input-methods, https://ai.google.dev/gemini-api/docs/document-processing
