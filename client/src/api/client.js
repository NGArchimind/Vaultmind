import { createClient } from "@supabase/supabase-js";

// ── Supabase client (singleton) ───────────────────────────────────────────────
export const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

// Returns the current session's JWT, or null if not signed in
async function getAuthToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

const API_BASE = process.env.REACT_APP_API_URL || "https://archimind.up.railway.app";

// ── Generic fetch wrapper ─────────────────────────────────────────────────────
export async function api(path, options = {}) {
  const token = await getAuthToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json();
}

// ── File → base64 ─────────────────────────────────────────────────────────────
export function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Read failed"));
    r.readAsDataURL(file);
  });
}

// ── Split PDF into page chunks ────────────────────────────────────────────────
export async function splitPdfIntoChunks(base64Data, chunkSize) {
  try {
    if (!window.PDFLib) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
    const { PDFDocument } = window.PDFLib;
    const pdfBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPages = srcDoc.getPageCount();
    const chunks = [];
    for (let start = 0; start < totalPages; start += chunkSize) {
      const end = Math.min(start + chunkSize, totalPages);
      const chunkDoc = await PDFDocument.create();
      const pages = await chunkDoc.copyPages(srcDoc, Array.from({ length: end - start }, (_, i) => start + i));
      pages.forEach(p => chunkDoc.addPage(p));
      const chunkBytes = await chunkDoc.save();
      const chunkBase64 = await new Promise((resolve) => {
        const blob = new Blob([chunkBytes], { type: "application/pdf" });
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.readAsDataURL(blob);
      });
      chunks.push({ base64: chunkBase64, startPage: start + 1, endPage: end, totalPages });
    }
    return chunks;
  } catch (e) {
    console.warn("PDF splitting failed:", e);
    return [{ base64: base64Data, startPage: 1, endPage: "?", totalPages: "?" }];
  }
}

// ── Gemini proxy call ─────────────────────────────────────────────────────────
export async function callClaude(messages, systemPrompt, maxTokens = 1000, retries = 2, model = "gemini-2.5-flash", timeoutMs = 240000, options = {}) {
  const token = await getAuthToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${API_BASE}/api/claude`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages, ...options }),
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === "AbortError") throw new Error("TIMEOUT");
    throw e;
  }
  clearTimeout(timeoutId);

  if (res.status === 429 && retries > 0) {
    console.log(`Rate limit hit, waiting 15 seconds before retry (${retries} retries left)…`);
    await new Promise(r => setTimeout(r, 15000));
    return callClaude(messages, systemPrompt, maxTokens, retries - 1, model, timeoutMs, options);
  }
  if ((res.status === 504 || res.status === 502) && retries > 0) {
    console.log(`Gateway error ${res.status}, retrying in 5 seconds…`);
    await new Promise(r => setTimeout(r, 5000));
    return callClaude(messages, systemPrompt, maxTokens, retries - 1, model, timeoutMs, options);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  const data = await res.json();
  return {
    text: data.content.map(b => b.text || "").join("\n"),
    usage: data.usage || { input_tokens: 0, output_tokens: 0 },
  };
}
