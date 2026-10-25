// Project Map — database + Gemini side. Reads synced emails into the map in the
// background, carries Agreements-tab entries across, and applies the admin's
// sign-off decisions. The rules themselves live in lib/projectMap.js (tested).
const { supabase } = require("./clients");
const { GEMINI_BASE } = require("./gemini");
const { stripReplyChain } = require("../lib/emailText");
const {
  buildExtractionPrompt, parseFacts, findTitleMatch, planFact, agreementToMapItem,
} = require("../lib/projectMap");

const EMAIL_BATCH = 10;
const EMAIL_BODY_MAX_CHARS = 8000;
const RATE_LIMIT_WAIT_MS = 15000;
const MAX_CONSECUTIVE_FAILURES = 3;
const PAGE = 500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function geminiJson(prompt, { maxOutputTokens = 8192, thinkingBudget = 1024 } = {}) {
  const call = () => fetch(`${GEMINI_BASE}/gemini-2.5-flash:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens, responseMimeType: "application/json", thinkingConfig: { thinkingBudget } },
    }),
  });
  let response = await call();
  if (response.status === 429) {
    await sleep(RATE_LIMIT_WAIT_MS);
    response = await call();
  }
  if (!response.ok) throw new Error(`Gemini ${response.status}`);
  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
}

// All map items for a project with their history entries (paged past the
// 1,000-row API cap).
async function loadMapItems(projectId) {
  const items = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("project_map_items")
      .select("*, project_map_entries(*)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    items.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return items;
}

function currentDateOf(item) {
  return (item.project_map_entries || []).find(e => e.state === "current")?.entry_date || null;
}

// ── Carry Agreements-tab entries across ───────────────────────────────────────

async function agreementTitles(agreements) {
  const prompt = `Give each of these project agreements a short topic title of 2-6 words naming the thing it is about (e.g. "Ground floor walls", "Door frames"). Return ONLY a JSON array of strings, one per agreement, in the same order.

${agreements.map((a, i) => `${i + 1}. ${String(a.current_text).slice(0, 300)}`).join("\n")}`;
  try {
    const parsed = JSON.parse(await geminiJson(prompt, { thinkingBudget: 0 }));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Project map — agreement titles failed, using opening words:", err.message);
    return [];
  }
}

async function importAgreements(projectId) {
  const { data: agreements, error } = await supabase
    .from("project_agreements")
    .select("*, project_agreement_entries(*)")
    .eq("project_id", projectId);
  if (error) throw error;
  if (!agreements || agreements.length === 0) return 0;

  const { data: imported, error: importedError } = await supabase
    .from("project_map_items")
    .select("legacy_agreement_id")
    .eq("project_id", projectId)
    .not("legacy_agreement_id", "is", null);
  if (importedError) throw importedError;
  const done = new Set((imported || []).map(r => r.legacy_agreement_id));
  const todo = agreements.filter(a => !done.has(a.id));
  if (todo.length === 0) return 0;

  const titles = await agreementTitles(todo);
  let count = 0;
  for (let i = 0; i < todo.length; i++) {
    const { item, entries } = agreementToMapItem(todo[i], typeof titles[i] === "string" ? titles[i] : "");
    const { data: row, error: itemError } = await supabase
      .from("project_map_items")
      .insert({ ...item, project_id: projectId })
      .select("id")
      .single();
    if (itemError) { console.error("Project map — agreement import failed:", itemError.message); continue; }
    const { error: entryError } = await supabase
      .from("project_map_entries")
      .insert(entries.map(e => ({ ...e, item_id: row.id, project_id: projectId })));
    if (entryError) {
      await supabase.from("project_map_items").delete().eq("id", row.id);
      console.error("Project map — agreement import failed:", entryError.message);
      continue;
    }
    count++;
  }
  return count;
}

// ── Read one email into the map ───────────────────────────────────────────────

async function insertEntry(projectId, itemId, fact, source, state) {
  const { error } = await supabase.from("project_map_entries").insert({
    item_id: itemId,
    project_id: projectId,
    title: fact.title,
    value: fact.value,
    quote: fact.quote,
    stated_by: fact.stated_by || source.stated_by,
    entry_date: source.date,
    source_type: source.type,
    source_id: source.id,
    source_label: source.label,
    state,
  });
  if (error) throw error;
}

async function touchItem(itemId, fields = {}) {
  const { error } = await supabase
    .from("project_map_items")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (error) throw error;
}

// Makes `fact` the current value of an item: the old current entry is kept as history.
async function replaceCurrent(projectId, item, fact, source, itemFields = {}) {
  const { error } = await supabase
    .from("project_map_entries")
    .update({ state: "superseded" })
    .eq("item_id", item.id)
    .eq("state", "current");
  if (error) throw error;
  await insertEntry(projectId, item.id, fact, source, "current");
  await touchItem(item.id, { current_value: fact.value, ...itemFields });
}

async function applyFact(projectId, fact, items, source) {
  const index = fact.match !== null ? fact.match - 1 : findTitleMatch(fact, items);
  const item = index >= 0 ? items[index] : null;
  const action = planFact(fact, item, source.date);

  if (action === "create") {
    const { data: row, error } = await supabase
      .from("project_map_items")
      .insert({ project_id: projectId, category: fact.category, title: fact.title, current_value: fact.value })
      .select("id")
      .single();
    if (error) throw error;
    await insertEntry(projectId, row.id, fact, source, "current");
    // Later facts in the same email can now match this item by title.
    items.push({ id: row.id, category: fact.category, title: fact.title, current_value: fact.value, current_date: source.date });
  } else if (action === "support") {
    await insertEntry(projectId, item.id, fact, source, "supporting");
  } else if (action === "historic") {
    await insertEntry(projectId, item.id, fact, source, "superseded");
  } else if (action === "pending") {
    await insertEntry(projectId, item.id, fact, source, "pending");
    await touchItem(item.id);
  } else {
    await replaceCurrent(projectId, item, fact, source);
    item.current_value = fact.value;
    item.current_date = source.date;
  }
}

async function processEmail(projectId, email) {
  const body = stripReplyChain(email.body_text || "").slice(0, EMAIL_BODY_MAX_CHARS);
  if (body || email.subject) {
    const items = (await loadMapItems(projectId)).map(it => ({
      id: it.id, category: it.category, title: it.title, current_value: it.current_value, current_date: currentDateOf(it),
    }));
    const date = email.sent_at ? String(email.sent_at).slice(0, 10) : null;
    const raw = await geminiJson(buildExtractionPrompt({
      email: { from: `${email.from_name || ""} <${email.from_address || ""}>`, date, subject: email.subject, body },
      items,
    }));
    const facts = parseFacts(raw, items.length);
    const source = {
      type: "email", id: email.id, date,
      label: email.subject || "(no subject)",
      stated_by: email.from_name || email.from_address || "",
    };
    for (const fact of facts) await applyFact(projectId, fact, items, source);
  }
  const { error } = await supabase
    .from("project_emails")
    .update({ map_processed_at: new Date().toISOString() })
    .eq("id", email.id);
  if (error) throw error;
}

// Reads every not-yet-read email into the map, oldest first so the history
// builds in the order things happened.
async function runMap(projectId) {
  try {
    await importAgreements(projectId);
  } catch (err) {
    console.error("Project map — agreement import error:", err.message);
  }
  let failures = 0;
  for (;;) {
    const { data: emails, error } = await supabase
      .from("project_emails")
      .select("id, subject, from_name, from_address, sent_at, body_text")
      .eq("project_id", projectId)
      .is("map_processed_at", null)
      .is("map_error", null)
      .order("sent_at", { ascending: true, nullsFirst: true })
      .limit(EMAIL_BATCH);
    if (error) throw error;
    if (!emails || emails.length === 0) return;
    for (const email of emails) {
      try {
        await processEmail(projectId, email);
        failures = 0;
      } catch (err) {
        failures++;
        console.error(`Project map — email ${email.id} failed:`, err.message);
        await supabase.from("project_emails").update({ map_error: String(err.message).slice(0, 300) }).eq("id", email.id);
        // Several in a row means the AI service is down, not a bad email — stop
        // and leave the rest unread for the next run.
        if (failures >= MAX_CONSECUTIVE_FAILURES) return;
      }
    }
  }
}

// One background run per project at a time (single Railway instance — same
// assumption as the rate limiter). A kick during a run queues one more pass.
const running = new Map();

function isMapRunning(projectId) {
  return running.has(projectId);
}

function kickMapRun(projectId) {
  const state = running.get(projectId);
  if (state) { state.rerun = true; return false; }
  const fresh = { rerun: false };
  running.set(projectId, fresh);
  (async () => {
    do {
      fresh.rerun = false;
      await runMap(projectId);
    } while (fresh.rerun);
  })()
    .catch(err => console.error("Project map — run error:", err.message))
    .finally(() => running.delete(projectId));
  return true;
}

module.exports = { geminiJson, loadMapItems, currentDateOf, replaceCurrent, touchItem, isMapRunning, kickMapRun };
