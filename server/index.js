const express = require("express");
const cors = require("cors");
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, CopyObjectCommand } = require("@aws-sdk/client-s3");
const { createClient } = require("@supabase/supabase-js");
const ExcelJS = require("exceljs");

const app = express();
app.use(cors());
app.use(express.json({ limit: "100mb" }));

// Extend timeout to 5 minutes to handle large Gemini requests
app.use((req, res, next) => {
  res.setTimeout(300000);
  next();
});

// ── R2 client ─────────────────────────────────────────────────────────────────
const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET || "archimind-docs";

// ── Supabase client ───────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// ── helpers ────────────────────────────────────────────────────────────────────

// List all keys under a prefix (handles pagination)
async function listAllKeys(prefix) {
  const keys = [];
  let continuationToken;
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    const result = await r2.send(cmd);
    (result.Contents || []).forEach(o => keys.push(o.Key));
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

// Copy all objects from one prefix to another, then delete originals
async function movePrefix(fromPrefix, toPrefix) {
  const keys = await listAllKeys(fromPrefix);
  for (const key of keys) {
    const newKey = toPrefix + key.slice(fromPrefix.length);
    await r2.send(new CopyObjectCommand({
      Bucket: BUCKET,
      CopySource: `${BUCKET}/${key}`,
      Key: newKey,
    }));
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  }
}

// Delete all objects under a prefix
async function deletePrefix(prefix) {
  const keys = await listAllKeys(prefix);
  for (const key of keys) {
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  }
}

// ── JWT auth middleware ───────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorised — no token provided" });
  }

  const token = authHeader.slice(7);

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: "Unauthorised — invalid or expired token" });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorised — invalid or expired token" });
  }
}

// ── Gemini AI proxy ───────────────────────────────────────────────────────────
app.post("/api/claude", requireAuth, async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY not set." });

  try {
    const { model, max_tokens, system, messages, temperature, thinking } = req.body;
    const requestedModel = model && model.startsWith("gemini-") ? model : "gemini-2.5-flash";

    const contents = [];

    if (system) {
      contents.push({ role: "user", parts: [{ text: `SYSTEM INSTRUCTIONS:\n${system}` }] });
      contents.push({ role: "model", parts: [{ text: "Understood. I will follow these instructions." }] });
    }

    for (const msg of messages) {
      const parts = [];
      if (typeof msg.content === "string") {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text") {
            parts.push({ text: block.text });
          } else if (block.type === "document" && block.source?.type === "base64") {
            parts.push({ inline_data: { mime_type: block.source.media_type || "application/pdf", data: block.source.data } });
          }
        }
      }
      contents.push({ role: msg.role === "assistant" ? "model" : "user", parts });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent?key=${apiKey}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.error("Gemini request aborted — exceeded 4 minute timeout");
    }, 240000);

    let response;
    try {
      const generationConfig = {
        maxOutputTokens: max_tokens || 65000,
        temperature: temperature !== undefined ? temperature : 0.1,
      };
      if (thinking === false) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }

      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ contents, generationConfig }),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const err = await response.text();
      console.error("Gemini error:", err);
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    let text = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const usage = data.usageMetadata || {};
    res.json({
      content: [{ type: "text", text }],
      usage: { input_tokens: usage.promptTokenCount || 0, output_tokens: usage.candidatesTokenCount || 0 },
    });

  } catch (err) {
    if (err.name === "AbortError") {
      console.error("Gemini timeout — request took too long");
      return res.status(504).json({ error: "Gemini request timed out — try a more specific question or reduce page count." });
    }
    console.error("Gemini proxy error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── vault routes ──────────────────────────────────────────────────────────────

// GET /api/vaults — returns flat vaults and master vaults with their sub-vaults
app.get("/api/vaults", requireAuth, async (req, res) => {
  try {
    // List top-level "folders" (depth-1 prefixes)
    const topCmd = new ListObjectsV2Command({ Bucket: BUCKET, Delimiter: "/" });
    const topResult = await r2.send(topCmd);
    const topPrefixes = (topResult.CommonPrefixes || []).map(p => p.Prefix); // e.g. "British Standards/"

    const SYSTEM_PREFIXES = new Set(["products", "projects"]);
    const vaults = [];

    for (const prefix of topPrefixes) {
      const name = prefix.slice(0, -1); // strip trailing /

      // Skip system folders used by product library and projects
      if (SYSTEM_PREFIXES.has(name)) continue;

      // Check if this folder has a .vault metadata file to determine type
      let meta = {};
      try {
        const metaResult = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${prefix}.vault` }));
        const buf = await streamToBuffer(metaResult.Body);
        meta = JSON.parse(buf.toString());
      } catch (_) {
        // No .vault file — treat as regular flat vault
      }

      if (meta.type === "master") {
        // List sub-vaults (depth-2 prefixes)
        const subCmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, Delimiter: "/" });
        const subResult = await r2.send(subCmd);
        const subPrefixes = (subResult.CommonPrefixes || []).map(p => p.Prefix);

        const subVaults = subPrefixes.map(sp => {
          const subName = sp.slice(prefix.length, -1); // strip parent prefix + trailing /
          return { id: sp.slice(0, -1), name: subName, path: sp.slice(0, -1) };
        });

        vaults.push({ id: name, name, type: "master", subVaults });
      } else {
        vaults.push({ id: name, name, type: "vault" });
      }
    }

    res.json({ vaults });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vaults — create a regular vault or master vault
app.post("/api/vaults", requireAuth, async (req, res) => {
  const { name, type = "vault", parentVault } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  try {
    if (type === "master") {
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${name}/.vault`,
        Body: JSON.stringify({ created: new Date().toISOString(), type: "master" }),
        ContentType: "application/json",
      }));
      res.json({ id: name, name, type: "master", subVaults: [] });

    } else if (parentVault) {
      const path = `${parentVault}/${name}`;
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${path}/.vault`,
        Body: JSON.stringify({ created: new Date().toISOString(), type: "vault", parent: parentVault }),
        ContentType: "application/json",
      }));
      res.json({ id: path, name, path, type: "vault" });

    } else {
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${name}/.vault`,
        Body: JSON.stringify({ created: new Date().toISOString() }),
        ContentType: "application/json",
      }));
      res.json({ id: name, name, type: "vault" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/vaults/:vault — rename a vault
app.patch("/api/vaults/*", requireAuth, async (req, res) => {
  const vaultPath = req.params[0];
  const { name: newName } = req.body;
  if (!newName) return res.status(400).json({ error: "New name required" });

  try {
    const parts = vaultPath.split("/");
    let newPath;
    if (parts.length === 1) {
      newPath = newName;
    } else {
      newPath = [...parts.slice(0, -1), newName].join("/");
    }

    const fromPrefix = `${vaultPath}/`;
    const toPrefix = `${newPath}/`;

    await movePrefix(fromPrefix, toPrefix);
    res.json({ id: newPath, name: newName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/vaults/:vault — delete a vault and all its contents
app.delete("/api/vaults/*", requireAuth, async (req, res) => {
  if (req.params[0].includes("/pdfs/")) return res.status(404).json({ error: "Not found" });

  const vaultPath = req.params[0];
  try {
    await deletePrefix(`${vaultPath}/`);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vaults/:vault/adopt — adopt an existing flat vault as a sub-vault of a master
app.post("/api/vaults/*/adopt", requireAuth, async (req, res) => {
  const masterPath = req.params[0];
  const { sourceVault } = req.body;
  if (!sourceVault) return res.status(400).json({ error: "sourceVault required" });

  try {
    const fromPrefix = `${sourceVault}/`;
    const toPrefix = `${masterPath}/${sourceVault}/`;
    await movePrefix(fromPrefix, toPrefix);

    try {
      const metaResult = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${toPrefix}.vault` }));
      const buf = await streamToBuffer(metaResult.Body);
      const meta = JSON.parse(buf.toString());
      meta.parent = masterPath;
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${toPrefix}.vault`,
        Body: JSON.stringify(meta),
        ContentType: "application/json",
      }));
    } catch (_) { /* metadata update best-effort */ }

    res.json({ id: `${masterPath}/${sourceVault}`, name: sourceVault });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vaults/:vault/pdfs
app.get("/api/vaults/*/pdfs", requireAuth, async (req, res) => {
  const vaultPath = req.params[0];
  try {
    const result = await r2.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${vaultPath}/` }));
    const pdfs = (result.Contents || [])
      .filter(f => f.Key.endsWith(".pdf"))
      .map(f => ({ id: f.Key, name: f.Key.replace(`${vaultPath}/`, ""), size: f.Size, key: f.Key }));
    res.json({ pdfs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vaults/:vault/pdfs
app.post("/api/vaults/*/pdfs", requireAuth, async (req, res) => {
  const vaultPath = req.params[0];
  const { name, base64 } = req.body;
  if (!name || !base64) return res.status(400).json({ error: "name and base64 required" });
  const buffer = Buffer.from(base64, "base64");
  try {
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${vaultPath}/${name}`,
      Body: buffer,
      ContentType: "application/pdf",
    }));
    res.json({ key: `${vaultPath}/${name}`, name, size: buffer.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vaults/:vault/pdfs/:filename
app.get("/api/vaults/*/pdfs/:filename", requireAuth, async (req, res) => {
  const vaultPath = req.params[0];
  const { filename } = req.params;
  try {
    const result = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${vaultPath}/${filename}` }));
    const buffer = await streamToBuffer(result.Body);
    res.json({ base64: buffer.toString("base64"), name: filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/vaults/:vault/pdfs/:filename
app.delete("/api/vaults/*/pdfs/:filename", requireAuth, async (req, res) => {
  const vaultPath = req.params[0];
  const { filename } = req.params;
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `${vaultPath}/${filename}` }));
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vaults/:vault/index
app.post("/api/vaults/*/index", requireAuth, async (req, res) => {
  const vaultPath = req.params[0];
  try {
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${vaultPath}/.index.json`,
      Body: JSON.stringify(req.body),
      ContentType: "application/json",
    }));
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vaults/:vault/index
app.get("/api/vaults/*/index", requireAuth, async (req, res) => {
  const vaultPath = req.params[0];
  try {
    const result = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${vaultPath}/.index.json` }));
    const buffer = await streamToBuffer(result.Body);
    res.json(JSON.parse(buffer.toString()));
  } catch (err) {
    if (err.name === "NoSuchKey") return res.json(null);
    res.status(500).json({ error: err.message });
  }
});

// ── text extraction — server side ────────────────────────────────────────────
app.post("/api/extract-text", requireAuth, async (req, res) => {
  const { base64 } = req.body;
  if (!base64) return res.status(400).json({ error: "base64 required" });

  const pdfBytes = Buffer.from(base64, "base64");

  try {
    const mupdf = await import("mupdf");
    const doc = new mupdf.PDFDocument(pdfBytes);
    const pageCount = doc.countPages();
    const pages = [];

    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i);
      try {
        const structured = page.toStructuredText("preserve-whitespace");
        const text = structured.asText();
        pages.push({ page: i + 1, text: text.trim() });
      } catch (_) {
        pages.push({ page: i + 1, text: "" });
      }
    }

    const fullText = pages.map(p => `[Page ${p.page}]\n${p.text}`).join("\n\n");
    const hasText = fullText.replace(/\[Page \d+\]/g, "").trim().length > 100;

    return res.json({ text: fullText, hasText, pageCount });
  } catch (err) {
    console.warn("mupdf text extraction failed:", err.message);
    return res.json({ text: "", hasText: false, pageCount: 0 });
  }
});

// ── page extraction — server side ────────────────────────────────────────────
app.post("/api/extract-pages", requireAuth, async (req, res) => {
  const { base64, pages } = req.body;
  if (!base64 || !pages || !Array.isArray(pages)) {
    return res.status(400).json({ error: "base64 and pages array required" });
  }

  const pdfBytes = Buffer.from(base64, "base64");
  const pageList = pages.map(Number).filter(n => !isNaN(n) && n > 0);
  if (pageList.length === 0) return res.status(400).json({ error: "No valid page numbers" });

  // Attempt 1: mupdf
  try {
    const mupdf = await import("mupdf");
    const srcDoc = new mupdf.PDFDocument(pdfBytes);
    const totalPages = srcDoc.countPages();
    const validPages = pageList.filter(p => p <= totalPages);
    if (validPages.length === 0) return res.status(400).json({ error: "No valid pages" });
    const outDoc = new mupdf.PDFDocument();
    for (const pageNum of validPages) {
      const graftMap = outDoc.newGraftMap();
      outDoc.graftPage(outDoc.countPages(), srcDoc, pageNum - 1, graftMap);
    }
    const rawBuffer = outDoc.saveToBuffer("compress");
    const outBytes = Buffer.from(rawBuffer.asUint8Array());
    return res.json({ base64: outBytes.toString("base64"), pagesExtracted: validPages.length, pageNumbers: validPages });
  } catch (mupdfErr) {
    console.warn("mupdf extraction failed, trying pdf-lib:", mupdfErr.message);
  }

  // Attempt 2: pdf-lib fallback
  try {
    const { PDFDocument } = require("pdf-lib");
    const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPages = srcDoc.getPageCount();
    const pageIndices = pageList.map(p => p - 1).filter(i => i >= 0 && i < totalPages);
    if (pageIndices.length === 0) return res.status(400).json({ error: "No valid pages" });
    const extractedDoc = await PDFDocument.create();
    const copiedPages = await extractedDoc.copyPages(srcDoc, pageIndices);
    copiedPages.forEach(p => extractedDoc.addPage(p));
    const extractedBytes = await extractedDoc.save();
    return res.json({
      base64: Buffer.from(extractedBytes).toString("base64"),
      pagesExtracted: pageIndices.length,
      pageNumbers: pageIndices.map(i => i + 1),
    });
  } catch (pdfLibErr) {
    console.error("All extraction methods failed:", pdfLibErr.message);
    return res.status(500).json({ error: pdfLibErr.message });
  }
});

// ── Product Library routes ────────────────────────────────────────────────────

app.post("/api/products/upload-pdf", requireAuth, async (req, res) => {
  const { base64, filename } = req.body;
  if (!base64 || !filename) return res.status(400).json({ error: "base64 and filename required" });

  const buffer = Buffer.from(base64, "base64");
  const key = `products/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  try {
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: "application/pdf",
    }));
    res.json({ key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/products", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("id, created_at, name, manufacturer, file_key, product_type")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ products: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/products/:id", requireAuth, async (req, res) => {
  try {
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (productError) throw productError;

    const { data: attributes, error: attrError } = await supabase
      .from("product_attributes")
      .select("*")
      .eq("product_id", req.params.id)
      .order("attribute");
    if (attrError) throw attrError;

    res.json({ product, attributes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/products/:id", requireAuth, async (req, res) => {
  const { product_type } = req.body;
  try {
    const { data, error } = await supabase
      .from("products")
      .update({ product_type })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ product: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/products", requireAuth, async (req, res) => {
  const { name, manufacturer, file_key, raw_text, product_type, attributes = [] } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });

  try {
    const { data: product, error: productError } = await supabase
      .from("products")
      .insert({ name, manufacturer, file_key, raw_text, product_type })
      .select()
      .single();
    if (productError) throw productError;

    if (attributes.length > 0) {
      const rows = attributes.map(a => ({ product_id: product.id, attribute: a.attribute, value: a.value, unit: a.unit || null }));
      const { error: attrError } = await supabase.from("product_attributes").insert(rows);
      if (attrError) throw attrError;
    }

    res.json({ product });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/products/:id/pdf", requireAuth, async (req, res) => {
  try {
    const { data: product, error } = await supabase
      .from("products")
      .select("file_key, name")
      .eq("id", req.params.id)
      .single();
    if (error) throw error;
    if (!product.file_key) return res.status(404).json({ error: "No PDF stored for this product" });

    const result = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: product.file_key }));
    const buffer = await streamToBuffer(result.Body);
    res.json({ base64: buffer.toString("base64"), name: product.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/products/:id", requireAuth, async (req, res) => {
  try {
    const { data: product, error: fetchError } = await supabase
      .from("products")
      .select("file_key")
      .eq("id", req.params.id)
      .single();
    if (fetchError) throw fetchError;

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;

    if (product.file_key && product.file_key.startsWith("products/")) {
      try {
        await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: product.file_key }));
      } catch (_) { /* best effort */ }
    }

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Project routes ────────────────────────────────────────────────────────────

app.get("/api/projects", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, job_number, client, location, stage, status, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ projects: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/projects/:id", requireAuth, async (req, res) => {
  try {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (projectError) throw projectError;

    const { data: consultants, error: consultantsError } = await supabase
      .from("project_consultants")
      .select("*")
      .eq("project_id", req.params.id)
      .order("created_at");
    if (consultantsError) throw consultantsError;

    const { data: uvalues, error: uvaluesError } = await supabase
      .from("project_uvalues")
      .select("*")
      .eq("project_id", req.params.id);
    if (uvaluesError) throw uvaluesError;

    const { data: notes, error: notesError } = await supabase
      .from("project_notes")
      .select("*")
      .eq("project_id", req.params.id)
      .order("sort_order");
    if (notesError) throw notesError;

    res.json({ project, consultants, uvalues, notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects", requireAuth, async (req, res) => {
  const { name, job_number, client, location, stage, description, status = "active", project_lead } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });

  try {
    const { data: project, error } = await supabase
      .from("projects")
      .insert({ name, job_number, client, location, stage, description, status, project_lead })
      .select()
      .single();
    if (error) throw error;

    const DEFAULT_UVALUES = [
      { element: "Roof", target: null, achieved: null, notes: null },
      { element: "External Wall", target: null, achieved: null, notes: null },
      { element: "Ground Floor", target: null, achieved: null, notes: null },
      { element: "Party Wall", target: null, achieved: null, notes: null },
      { element: "Windows / Glazing", target: null, achieved: null, notes: null },
      { element: "Doors", target: null, achieved: null, notes: null },
      { element: "Rooflights", target: null, achieved: null, notes: null },
    ];
    const uvalueRows = DEFAULT_UVALUES.map(u => ({ ...u, project_id: project.id }));
    await supabase.from("project_uvalues").insert(uvalueRows);

    res.json({ project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/projects/:id", requireAuth, async (req, res) => {
  const { name, job_number, client, location, stage, description, status, project_lead } = req.body;
  try {
    const { data, error } = await supabase
      .from("projects")
      .update({ name, job_number, client, location, stage, description, status, project_lead, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ project: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/projects/:id", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Consultants ───────────────────────────────────────────────────────────────

app.post("/api/projects/:id/consultants", requireAuth, async (req, res) => {
  const { discipline, company, contact_name, email, phone } = req.body;
  try {
    const { data, error } = await supabase
      .from("project_consultants")
      .insert({ project_id: req.params.id, discipline, company, contact_name, email, phone })
      .select()
      .single();
    if (error) throw error;
    res.json({ consultant: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/projects/:id/consultants/:cid", requireAuth, async (req, res) => {
  const { discipline, company, contact_name, email, phone } = req.body;
  try {
    const { data, error } = await supabase
      .from("project_consultants")
      .update({ discipline, company, contact_name, email, phone })
      .eq("id", req.params.cid)
      .eq("project_id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ consultant: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/projects/:id/consultants/:cid", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("project_consultants")
      .delete()
      .eq("id", req.params.cid)
      .eq("project_id", req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── U-values ──────────────────────────────────────────────────────────────────

app.patch("/api/projects/:id/uvalues/:uid", requireAuth, async (req, res) => {
  const { target, achieved, notes } = req.body;
  try {
    const { data, error } = await supabase
      .from("project_uvalues")
      .update({ target, achieved, notes })
      .eq("id", req.params.uid)
      .eq("project_id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ uvalue: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects/:id/uvalues", requireAuth, async (req, res) => {
  const { element, target, achieved, notes } = req.body;
  if (!element) return res.status(400).json({ error: "element required" });
  try {
    const { data, error } = await supabase
      .from("project_uvalues")
      .insert({ project_id: req.params.id, element, target, achieved, notes })
      .select()
      .single();
    if (error) throw error;
    res.json({ uvalue: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/projects/:id/uvalues/:uid", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("project_uvalues")
      .delete()
      .eq("id", req.params.uid)
      .eq("project_id", req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Project notes ─────────────────────────────────────────────────────────────

app.post("/api/projects/:id/notes", requireAuth, async (req, res) => {
  const { label, value, sort_order = 0 } = req.body;
  try {
    const { data, error } = await supabase
      .from("project_notes")
      .insert({ project_id: req.params.id, label, value, sort_order })
      .select()
      .single();
    if (error) throw error;
    res.json({ note: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/projects/:id/notes/:nid", requireAuth, async (req, res) => {
  const { label, value, sort_order } = req.body;
  try {
    const { data, error } = await supabase
      .from("project_notes")
      .update({ label, value, sort_order })
      .eq("id", req.params.nid)
      .eq("project_id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ note: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/projects/:id/notes/:nid", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("project_notes")
      .delete()
      .eq("id", req.params.nid)
      .eq("project_id", req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Project drawings ──────────────────────────────────────────────────────────

app.get("/api/projects/:id/drawings", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("project_drawings")
      .select("id, title, drawing_number, revision, status, scale, volume, level, drawing_type, file_name, file_size, uploaded_at, created_at")
      .eq("project_id", req.params.id)
      .order("drawing_number", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ drawings: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects/:id/drawings", requireAuth, async (req, res) => {
  const { title, drawing_number, revision, status, scale, volume, level, drawing_type, file_name, file_size, base64 } = req.body;
  if (!title || !file_name || !base64) return res.status(400).json({ error: "title, file_name and base64 required" });

  const ext = file_name.split(".").pop().toLowerCase();
  const contentType = ext === "dwg" ? "application/acad" : "application/pdf";
  const safeFileName = file_name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const r2Key = `projects/${req.params.id}/drawings/${Date.now()}-${safeFileName}`;
  const buffer = Buffer.from(base64, "base64");

  try {
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: r2Key,
      Body: buffer,
      ContentType: contentType,
    }));

    const { data, error } = await supabase
      .from("project_drawings")
      .insert({
        project_id: req.params.id,
        title,
        drawing_number: drawing_number || null,
        revision: revision || null,
        status: status || "Preliminary",
        scale: scale || null,
        volume: volume || null,
        level: level || null,
        drawing_type: drawing_type || null,
        file_key: r2Key,
        file_name: safeFileName,
        file_size: file_size || buffer.length,
        uploaded_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;

    res.json({ drawing: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/projects/:id/drawings/:did", requireAuth, async (req, res) => {
  const { title, drawing_number, revision, status, scale, volume, level, drawing_type } = req.body;
  try {
    const { data, error } = await supabase
      .from("project_drawings")
      .update({ title, drawing_number, revision, status, scale, volume, level, drawing_type })
      .eq("id", req.params.did)
      .eq("project_id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ drawing: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/projects/:id/drawings/:did/file", requireAuth, async (req, res) => {
  try {
    const { data: drawing, error } = await supabase
      .from("project_drawings")
      .select("file_key, file_name")
      .eq("id", req.params.did)
      .eq("project_id", req.params.id)
      .single();
    if (error) throw error;
    if (!drawing.file_key) return res.status(404).json({ error: "No file stored for this drawing" });

    const result = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: drawing.file_key }));
    const buffer = await streamToBuffer(result.Body);
    res.json({ base64: buffer.toString("base64"), file_name: drawing.file_name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/projects/:id/drawings/:did", requireAuth, async (req, res) => {
  try {
    const { data: drawing, error: fetchError } = await supabase
      .from("project_drawings")
      .select("file_key")
      .eq("id", req.params.did)
      .eq("project_id", req.params.id)
      .single();
    if (fetchError) throw fetchError;

    const { error } = await supabase
      .from("project_drawings")
      .delete()
      .eq("id", req.params.did)
      .eq("project_id", req.params.id);
    if (error) throw error;

    if (drawing.file_key) {
      try {
        await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: drawing.file_key }));
      } catch (_) { /* best effort */ }
    }

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Drawing sync (bulk upsert from desktop sync tool) ────────────────────────
app.post("/api/projects/:id/drawings/sync", requireAuth, async (req, res) => {
  const { drawings: incoming } = req.body;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return res.status(400).json({ error: "drawings array required" });
  }

  const { data: existing, error: fetchError } = await supabase
    .from("project_drawings")
    .select("id, drawing_number, revision, file_key, file_name")
    .eq("project_id", req.params.id);
  if (fetchError) return res.status(500).json({ error: fetchError.message });

  const existingMap = {};
  for (const d of existing) {
    if (d.drawing_number) existingMap[d.drawing_number] = d;
  }

  const results = [];

  for (const item of incoming) {
    const { title, drawing_number, revision, status, scale, volume, level, drawing_type, file_name, file_size, base64 } = item;
    if (!title || !drawing_number || !file_name || !base64) {
      results.push({ drawing_number, action: "skipped", error: "Missing required fields" });
      continue;
    }

    const ext = file_name.split(".").pop().toLowerCase();
    const contentType = ext === "dwg" ? "application/acad" : "application/pdf";
    const safeFileName = file_name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const r2Key = `projects/${req.params.id}/drawings/${Date.now()}-${safeFileName}`;
    const buffer = Buffer.from(base64, "base64");

    try {
      const existingRecord = existingMap[drawing_number];

      if (existingRecord) {
        if (existingRecord.revision === revision) {
          results.push({ drawing_number, action: "skipped", reason: "Same revision already in register" });
          continue;
        }

        await r2.send(new PutObjectCommand({
          Bucket: BUCKET, Key: r2Key, Body: buffer, ContentType: contentType,
        }));

        if (existingRecord.file_key) {
          try { await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: existingRecord.file_key })); } catch (_) {}
        }

        const { data: updated, error: updateError } = await supabase
          .from("project_drawings")
          .update({
            title, revision, status: status || "For Information",
            scale: scale || null,
            volume: volume || null,
            level: level || null,
            drawing_type: drawing_type || null,
            file_key: r2Key, file_name: safeFileName,
            file_size: file_size || buffer.length,
            uploaded_at: new Date().toISOString(),
          })
          .eq("id", existingRecord.id)
          .select()
          .single();
        if (updateError) throw updateError;

        results.push({ drawing_number, action: "updated", previous_revision: existingRecord.revision, drawing: updated });

      } else {
        await r2.send(new PutObjectCommand({
          Bucket: BUCKET, Key: r2Key, Body: buffer, ContentType: contentType,
        }));

        const { data: created, error: insertError } = await supabase
          .from("project_drawings")
          .insert({
            project_id: req.params.id, title, drawing_number, revision,
            status: status || "Preliminary",
            scale: scale || null,
            volume: volume || null,
            level: level || null,
            drawing_type: drawing_type || null,
            file_key: r2Key, file_name: safeFileName,
            file_size: file_size || buffer.length,
            uploaded_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (insertError) throw insertError;

        results.push({ drawing_number, action: "created", drawing: created });
      }
    } catch (err) {
      results.push({ drawing_number, action: "error", error: err.message });
    }
  }

  res.json({ results });

  // Fire and forget — transmittal generation does not affect sync response
  generateTransmittal(req.params.id, results);
});

// ── Todos ─────────────────────────────────────────────────────────────────────

app.get("/api/projects/:id/todos", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("project_todos")
      .select("*")
      .eq("project_id", req.params.id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.json({ todos: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects/:id/todos", requireAuth, async (req, res) => {
  const { description, assigned_to, due_date, status = "open" } = req.body;
  if (!description) return res.status(400).json({ error: "description required" });
  try {
    const { data, error } = await supabase
      .from("project_todos")
      .insert({ project_id: req.params.id, description, assigned_to, due_date: due_date || null, status })
      .select()
      .single();
    if (error) throw error;
    res.json({ todo: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/projects/:id/todos/:tid", requireAuth, async (req, res) => {
  const { description, assigned_to, due_date, status } = req.body;
  try {
    const { data, error } = await supabase
      .from("project_todos")
      .update({ description, assigned_to, due_date: due_date || null, status })
      .eq("id", req.params.tid)
      .eq("project_id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ todo: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/projects/:id/todos/:tid", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("project_todos")
      .delete()
      .eq("id", req.params.tid)
      .eq("project_id", req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Transmittal generation ────────────────────────────────────────────────────

function transmittalPrefix(projectId) {
  return `projects/${projectId}/documents/transmittals/`;
}

function formatDateDMY(date) {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function formatDateISO(date) {
  return date.toISOString().slice(0, 10);
}

async function generateTransmittal(projectId, syncResults) {
  try {
    const { data: project } = await supabase
      .from("projects")
      .select("name, job_number, location")
      .eq("id", projectId)
      .single();

    const { data: drawings } = await supabase
      .from("project_drawings")
      .select("id, title, drawing_number, revision, drawing_type")
      .eq("project_id", projectId)
      .order("drawing_number", { ascending: true });

    if (!drawings || drawings.length === 0) return;

    const changedNumbers = new Set(
      syncResults
        .filter(r => r.action === "updated" || r.action === "created")
        .map(r => r.drawing_number)
    );

    const now = new Date();
    const issueDay   = String(now.getDate()).padStart(2, "0");
    const issueMonth = String(now.getMonth() + 1).padStart(2, "0");
    const issueYear  = String(now.getFullYear()).slice(2);
    const issueDateDMY = `${issueDay}/${issueMonth}/${issueYear}`;
    const issueDateISO = formatDateISO(now);
    const prefix = transmittalPrefix(projectId);
    const excelKey = `${prefix}transmittal.xlsx`;

    // ── Colour / style constants ──────────────────────────────────────────────
    const TEAL    = "FF2d6a4f";  // practice dark teal banner (matches Architectus green)
    const NAVY    = "FF1a2332";  // dark navy text
    const SALMON  = "FFFFC0CB";  // latest issue column highlight (pink/salmon)
    const LGREY   = "FFF5F5F5";  // alternating row light grey
    const HDRFILL = "FFE8E8E8";  // column header row fill
    const WHITE   = "FFFFFFFF";
    const BORDCLR = "FFB0B0B0";

    function sf(argb) { return { type: "pattern", pattern: "solid", fgColor: { argb } }; }
    function bdr(style = "thin") {
      const s = { style, color: { argb: BORDCLR } };
      return { top: s, left: s, bottom: s, right: s };
    }
    function font(bold = false, size = 8, color = NAVY) {
      return { name: "Arial", size, bold, color: { argb: color } };
    }

    // ── Column layout ─────────────────────────────────────────────────────────
    // Col 1 (A): Drawing Title   width 52
    // Col 2 (B): Drawing No.     width 12
    // Col 3+:    Issue columns   width 8 each
    const COL_TITLE  = 1;
    const COL_DRAWNO = 2;
    const FIXED_COLS = 2;

    // ── Load or rebuild workbook ──────────────────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Archimind";

    // Page setup for A4 portrait printing
    let ws;
    let existingIssueDates = []; // array of { col, day, month, year }

    try {
      const existing = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: excelKey }));
      const buf = await streamToBuffer(existing.Body);
      await workbook.xlsx.load(buf);
      ws = workbook.getWorksheet("Drawing Schedule");
    } catch (_) { /* first time */ }

    const isNew = !ws;

    // Always rebuild from scratch to keep data/format in sync with current register
    // Remove old sheet and recreate so drawing rows stay current
    if (!isNew) {
      workbook.removeWorksheet(ws.id);
    }
    ws = workbook.addWorksheet("Drawing Schedule");

    ws.pageSetup = {
      paperSize: 9,           // A4
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    };

    ws.getColumn(COL_TITLE).width  = 52;
    ws.getColumn(COL_DRAWNO).width = 12;

    // ── Rebuild issue history from syncResults metadata ───────────────────────
    // We store issue dates in a hidden metadata sheet so history survives rebuild
    let metaWs = workbook.getWorksheet("_meta");
    if (!metaWs) metaWs = workbook.addWorksheet("_meta");
    metaWs.state = "hidden";

    // Read existing issue dates from meta sheet (row 1 = days, row 2 = months, row 3 = years)
    const metaRow1 = metaWs.getRow(1);
    const metaRow2 = metaWs.getRow(2);
    const metaRow3 = metaWs.getRow(3);

    // Read all existing issue columns from meta
    let col = 1;
    while (metaRow1.getCell(col).value) {
      existingIssueDates.push({
        col: FIXED_COLS + col,
        day:   String(metaRow1.getCell(col).value),
        month: String(metaRow2.getCell(col).value),
        year:  String(metaRow3.getCell(col).value),
      });
      col++;
    }

    // Append this new issue
    const newMetaCol = existingIssueDates.length + 1;
    metaRow1.getCell(newMetaCol).value = issueDay;
    metaRow2.getCell(newMetaCol).value = issueMonth;
    metaRow3.getCell(newMetaCol).value = issueYear;
    metaRow1.commit(); metaRow2.commit(); metaRow3.commit();

    // Full list including this issue
    const allIssueDates = [
      ...existingIssueDates,
      { col: FIXED_COLS + newMetaCol, day: issueDay, month: issueMonth, year: issueYear },
    ];

    const totalIssueCols = allIssueDates.length;
    const lastIssueCol = FIXED_COLS + totalIssueCols;

    // Set issue column widths
    for (let i = 1; i <= totalIssueCols; i++) {
      ws.getColumn(FIXED_COLS + i).width = 8;
    }

    // ── Helper: set all border sides on a range ───────────────────────────────
    function setRangeBorder(r1, c1, r2, c2, style = "thin") {
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          ws.getCell(r, c).border = bdr(style);
        }
      }
    }

    // ── ROW 1: Practice banner ────────────────────────────────────────────────
    ws.getRow(1).height = 22;
    ws.mergeCells(1, 1, 1, lastIssueCol);
    const bannerCell = ws.getCell(1, 1);
    bannerCell.value = "Architectural Design and Technology";
    bannerCell.font  = { name: "Arial", size: 11, bold: false, italic: true, color: { argb: WHITE } };
    bannerCell.fill  = sf(TEAL);
    bannerCell.alignment = { horizontal: "center", vertical: "middle" };

    // ── ROW 2: Job number + "Drawings - Working Drawings" ────────────────────
    ws.getRow(2).height = 13;
    ws.getCell(2, COL_TITLE).value = project?.job_number ? `Job Number - ${project.job_number}` : "Job Number -";
    ws.getCell(2, COL_TITLE).font  = font(true, 8);
    ws.getCell(2, COL_DRAWNO).value = "Drawings - Working Drawings";
    ws.getCell(2, COL_DRAWNO).font  = font(false, 8);
    ws.mergeCells(2, COL_DRAWNO, 2, lastIssueCol);

    // ── ROW 3: blank spacer ───────────────────────────────────────────────────
    ws.getRow(3).height = 4;

    // ── ROWS 4-7: Left col = site/project info, right = date of issue header ─
    // Row 4: "Site - [location]"  |  "Date of Issue"  |  Day values
    // Row 5: "[location2]"        |  "Day"            |  day nums
    // Row 6: "[project bold]"     |  "Month"          |  month nums
    // Row 7: blank               |  "Year"            |  year nums

    ws.getRow(4).height = 12;
    ws.getRow(5).height = 12;
    ws.getRow(6).height = 12;
    ws.getRow(7).height = 12;

    // Left side project info
    ws.getCell(4, COL_TITLE).value = project?.location ? `Site - ${project.location}` : "Site -";
    ws.getCell(4, COL_TITLE).font  = font(false, 8);

    ws.getCell(5, COL_TITLE).value = project?.location || "";
    ws.getCell(5, COL_TITLE).font  = font(false, 8);

    ws.getCell(6, COL_TITLE).value = project?.name || "";
    ws.getCell(6, COL_TITLE).font  = { name: "Arial", size: 11, bold: true, color: { argb: NAVY } };

    // "Date of Issue" label merged over drawing no col + issue cols, row 4
    ws.mergeCells(4, COL_DRAWNO, 4, lastIssueCol);
    ws.getCell(4, COL_DRAWNO).value = "Date of Issue";
    ws.getCell(4, COL_DRAWNO).font  = font(false, 8);
    ws.getCell(4, COL_DRAWNO).alignment = { horizontal: "left" };

    // Row 5: "Day" label + day values
    ws.getCell(5, COL_DRAWNO).value = "Day";
    ws.getCell(5, COL_DRAWNO).font  = font(false, 8);
    allIssueDates.forEach((issue, i) => {
      const c = ws.getCell(5, FIXED_COLS + i + 1);
      c.value = issue.day;
      c.font  = font(false, 8);
      c.alignment = { horizontal: "center" };
      if (FIXED_COLS + i + 1 === lastIssueCol) c.fill = sf(SALMON);
    });

    // Row 6: "Month" label + month values
    ws.getCell(6, COL_DRAWNO).value = "Month";
    ws.getCell(6, COL_DRAWNO).font  = font(false, 8);
    allIssueDates.forEach((issue, i) => {
      const c = ws.getCell(6, FIXED_COLS + i + 1);
      c.value = issue.month;
      c.font  = font(false, 8);
      c.alignment = { horizontal: "center" };
      if (FIXED_COLS + i + 1 === lastIssueCol) c.fill = sf(SALMON);
    });

    // Row 7: "Year" label + year values
    ws.getCell(7, COL_DRAWNO).value = "Year";
    ws.getCell(7, COL_DRAWNO).font  = font(false, 8);
    allIssueDates.forEach((issue, i) => {
      const c = ws.getCell(7, FIXED_COLS + i + 1);
      c.value = issue.year;
      c.font  = font(false, 8);
      c.alignment = { horizontal: "center" };
      if (FIXED_COLS + i + 1 === lastIssueCol) c.fill = sf(SALMON);
    });

    // ── ROW 8: Thin border line + column headers ──────────────────────────────
    ws.getRow(8).height = 14;

    ws.getCell(8, COL_TITLE).value = "Drawing Title";
    ws.getCell(8, COL_TITLE).font  = font(true, 8);
    ws.getCell(8, COL_TITLE).fill  = sf(HDRFILL);
    ws.getCell(8, COL_TITLE).border = bdr();
    ws.getCell(8, COL_TITLE).alignment = { vertical: "middle" };

    ws.getCell(8, COL_DRAWNO).value = "Drawing";
    ws.getCell(8, COL_DRAWNO).font  = font(true, 8);
    ws.getCell(8, COL_DRAWNO).fill  = sf(HDRFILL);
    ws.getCell(8, COL_DRAWNO).border = bdr();
    ws.getCell(8, COL_DRAWNO).alignment = { horizontal: "center", vertical: "middle" };

    // "Amendments" header merged across all issue columns
    ws.mergeCells(8, FIXED_COLS + 1, 8, lastIssueCol);
    const amendHdr = ws.getCell(8, FIXED_COLS + 1);
    amendHdr.value = "Amendments";
    amendHdr.font  = font(true, 8);
    amendHdr.fill  = sf(HDRFILL);
    amendHdr.border = bdr();
    amendHdr.alignment = { horizontal: "left", vertical: "middle" };

    // ── Drawing rows ──────────────────────────────────────────────────────────
    // Group drawings by drawing_type. Ungrouped = "Other"
    const groups = {};
    for (const d of drawings) {
      const grp = (d.drawing_type || "Other").trim();
      if (!groups[grp]) groups[grp] = [];
      groups[grp].push(d);
    }

    // Build revision map from current register
    const revMap = {};
    drawings.forEach(d => { if (d.drawing_number) revMap[d.drawing_number] = d.revision || ""; });

    let currentRow = 9;
    let drawingRowCount = 0; // for alternating fill

    for (const [groupName, groupDrawings] of Object.entries(groups)) {
      // Group header row
      ws.getRow(currentRow).height = 13;
      ws.mergeCells(currentRow, COL_TITLE, currentRow, lastIssueCol);
      const grpCell = ws.getCell(currentRow, COL_TITLE);
      grpCell.value = groupName;
      grpCell.font  = font(true, 8);
      grpCell.fill  = sf(HDRFILL);
      grpCell.border = bdr();
      grpCell.alignment = { vertical: "middle" };
      currentRow++;

      // Drawing rows
      for (const d of groupDrawings) {
        ws.getRow(currentRow).height = 12;
        const rowFill = drawingRowCount % 2 === 0 ? WHITE : LGREY;

        // Title cell
        const titleCell = ws.getCell(currentRow, COL_TITLE);
        titleCell.value = d.title || "";
        titleCell.font  = font(false, 8);
        titleCell.fill  = sf(rowFill);
        titleCell.border = bdr();
        titleCell.alignment = { vertical: "middle" };

        // Drawing number cell
        const noCell = ws.getCell(currentRow, COL_DRAWNO);
        noCell.value = d.drawing_number || "";
        noCell.font  = font(false, 8);
        noCell.fill  = sf(rowFill);
        noCell.border = bdr();
        noCell.alignment = { horizontal: "center", vertical: "middle" };

        // Issue revision cells
        const isChanged = changedNumbers.has(d.drawing_number);
        for (let i = 0; i < totalIssueCols; i++) {
          const issueColNum = FIXED_COLS + i + 1;
          const isThisIssue = issueColNum === lastIssueCol;
          const cell = ws.getCell(currentRow, issueColNum);

          // Only populate the latest issue column for changed drawings;
          // previous columns are empty (new sheet = history is in meta only)
          // For the current issue: show revision if changed
          if (isThisIssue) {
            cell.value = isChanged ? (revMap[d.drawing_number] || "") : "";
            cell.fill  = sf(SALMON);
          } else {
            cell.value = "";
            cell.fill  = sf(rowFill);
          }
          cell.font      = font(isThisIssue && isChanged, 8);
          cell.border    = bdr();
          cell.alignment = { horizontal: "center", vertical: "middle" };
        }

        currentRow++;
        drawingRowCount++;
      }

      // Blank spacer row between groups
      ws.getRow(currentRow).height = 6;
      for (let c = 1; c <= lastIssueCol; c++) {
        ws.getCell(currentRow, c).fill = sf(WHITE);
      }
      currentRow++;
    }

    // ── Save Excel ────────────────────────────────────────────────────────────
    const xlsxBuffer = await workbook.xlsx.writeBuffer();
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET, Key: excelKey,
      Body: Buffer.from(xlsxBuffer),
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));

    // ── HTML snapshot (matches Excel layout) ──────────────────────────────────
    // Build table rows from drawings grouped same way
    const htmlGroups = [];
    for (const [groupName, groupDrawings] of Object.entries(groups)) {
      const rows = groupDrawings.map(d => ({
        title: d.title || "",
        drawingNo: d.drawing_number || "",
        isChanged: changedNumbers.has(d.drawing_number),
        revision: revMap[d.drawing_number] || "",
      }));
      htmlGroups.push({ name: groupName, rows });
    }

    const issueCellsHtml = allIssueDates.map((issue, i) => {
      const isLatest = i === allIssueDates.length - 1;
      return `<th style="width:28px;text-align:center;background:${isLatest ? "#ffc0cb" : "#e8e8e8"};${isLatest ? "font-weight:bold;" : ""}">${issue.day}<br>${issue.month}<br>${issue.year}</th>`;
    }).join("");

    const htmlBodyRows = htmlGroups.map(grp => {
      const grpRow = `<tr><td colspan="${2 + allIssueDates.length}" style="font-weight:bold;background:#e8e8e8;padding:4px 6px;border:1px solid #b0b0b0;font-size:8pt">${grp.name}</td></tr>`;
      const dRows = grp.rows.map((d, idx) => {
        const bg = idx % 2 === 0 ? "#ffffff" : "#f5f5f5";
        const issueCells = allIssueDates.map((issue, i) => {
          const isLatest = i === allIssueDates.length - 1;
          const val = isLatest ? (d.isChanged ? d.revision : "") : "";
          return `<td style="text-align:center;background:${isLatest ? "#ffc0cb" : bg};border:1px solid #b0b0b0;font-size:8pt;${isLatest && d.isChanged ? "font-weight:bold;" : ""}">${val}</td>`;
        }).join("");
        return `<tr style="background:${bg}">
          <td style="padding:2px 6px;border:1px solid #b0b0b0;font-size:8pt">${d.title}</td>
          <td style="text-align:center;padding:2px 6px;border:1px solid #b0b0b0;font-size:8pt">${d.drawingNo}</td>
          ${issueCells}
        </tr>`;
      }).join("");
      return grpRow + dRows + `<tr style="height:6px"><td colspan="${2 + allIssueDates.length}"></td></tr>`;
    }).join("");

    const htmlSnapshot = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Drawing Schedule — ${(project?.name || "").replace(/</g, "&lt;")}</title>
<style>
  @page { size: A4 portrait; margin: 15mm; }
  body { font-family: Arial, sans-serif; font-size: 8pt; color: #1a2332; margin: 0; padding: 16px; }
  .banner { background: #2d6a4f; color: #fff; padding: 8px 12px; font-size: 11pt; font-style: italic; text-align: center; }
  .meta-row { display: flex; justify-content: space-between; align-items: baseline; padding: 4px 0; border-bottom: 1px solid #ccc; margin-bottom: 2px; }
  .meta-row .left { font-weight: bold; font-size: 8pt; }
  .meta-row .right { font-size: 8pt; }
  .project-name { font-size: 12pt; font-weight: bold; padding: 4px 0 8px 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 4px; }
  th { background: #e8e8e8; padding: 3px 5px; font-size: 8pt; border: 1px solid #b0b0b0; vertical-align: bottom; }
  td { padding: 2px 6px; font-size: 8pt; border: 1px solid #b0b0b0; }
  .generated { font-size: 7pt; color: #999; margin-top: 10px; text-align: right; }
</style></head><body>
<div class="banner">Architectural Design and Technology</div>
<div class="meta-row">
  <span class="left">${project?.job_number ? `Job Number - ${project.job_number}` : "Job Number -"}</span>
  <span class="right">Drawings - Working Drawings</span>
</div>
<div style="font-size:8pt;padding:2px 0">${project?.location ? `Site - ${project.location}` : ""}</div>
<div class="project-name">${(project?.name || "").replace(/</g, "&lt;")}</div>
<table>
  <thead>
    <tr>
      <th style="text-align:left;width:auto">Drawing Title</th>
      <th style="width:80px">Drawing</th>
      ${issueCellsHtml}
    </tr>
  </thead>
  <tbody>
    ${htmlBodyRows}
  </tbody>
</table>
<div class="generated">Generated by Archimind · ${issueDay}/${issueMonth}/${issueYear}</div>
</body></html>`;

    // ── Save HTML snapshot ────────────────────────────────────────────────────
    const snapshotKeyBase = `${prefix}transmittal_${issueDateISO}`;
    let snapshotKey = `${snapshotKeyBase}.html`;
    const existingKeys = await listAllKeys(prefix);
    if (existingKeys.includes(snapshotKey)) {
      let n = 2;
      while (existingKeys.includes(`${snapshotKeyBase}_${n}.html`)) n++;
      snapshotKey = `${snapshotKeyBase}_${n}.html`;
    }

    await r2.send(new PutObjectCommand({
      Bucket: BUCKET, Key: snapshotKey,
      Body: Buffer.from(htmlSnapshot, "utf-8"),
      ContentType: "text/html",
    }));

    console.log(`Transmittal generated for project ${projectId}: ${snapshotKey}`);
  } catch (err) {
    console.error("Transmittal generation error (non-fatal):", err.message);
  }
}

// ── Transmittal R2 file routes ────────────────────────────────────────────────

// GET /api/projects/:id/transmittals/files — list all transmittal files
app.get("/api/projects/:id/transmittals/files", requireAuth, async (req, res) => {
  try {
    const prefix = transmittalPrefix(req.params.id);
    const keys = await listAllKeys(prefix);
    const files = keys
      .map(key => {
        const name = key.replace(prefix, "");
        const isExcel = name.endsWith(".xlsx");
        const isSnapshot = name.endsWith(".html");
        if (!isExcel && !isSnapshot) return null;
        return {
          key, name,
          type: isExcel ? "excel" : "snapshot",
          label: isExcel ? "Drawing Schedule (Excel)" : name.replace("transmittal_", "Issue — ").replace(".html", ""),
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.type === "excel") return -1;
        if (b.type === "excel") return 1;
        return b.name.localeCompare(a.name);
      });
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id/transmittals/download?key=... — download a file
app.get("/api/projects/:id/transmittals/download", requireAuth, async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: "key required" });
  const expectedPrefix = transmittalPrefix(req.params.id);
  if (!key.startsWith(expectedPrefix)) return res.status(403).json({ error: "Forbidden" });
  try {
    const result = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const buffer = await streamToBuffer(result.Body);
    const name = key.split("/").pop();
    const isExcel = name.endsWith(".xlsx");
    res.json({
      base64: buffer.toString("base64"),
      name,
      contentType: isExcel
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/html",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/transmittals/generate — manually trigger transmittal
app.post("/api/projects/:id/transmittals/generate", requireAuth, async (req, res) => {
  try {
    const { data: drawings } = await supabase
      .from("project_drawings")
      .select("drawing_number")
      .eq("project_id", req.params.id);

    const allAsChanged = (drawings || []).map(d => ({
      drawing_number: d.drawing_number,
      action: "updated",
    }));

    await generateTransmittal(req.params.id, allAsChanged);
    res.json({ generated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Transmittals (Supabase legacy — kept for compatibility) ───────────────────

app.get("/api/projects/:id/transmittals", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("project_transmittals")
      .select("*")
      .eq("project_id", req.params.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ transmittals: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects/:id/transmittals", requireAuth, async (req, res) => {
  const { reference, issued_to, issued_by, issue_date, notes, drawing_ids } = req.body;
  if (!reference) return res.status(400).json({ error: "reference required" });
  try {
    const { data, error } = await supabase
      .from("project_transmittals")
      .insert({
        project_id: req.params.id,
        reference,
        issued_to,
        issued_by,
        issue_date: issue_date || null,
        notes,
        drawing_ids: drawing_ids || [],
      })
      .select()
      .single();
    if (error) throw error;
    res.json({ transmittal: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/projects/:id/transmittals/:tid", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("project_transmittals")
      .delete()
      .eq("id", req.params.tid)
      .eq("project_id", req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Project product categories ────────────────────────────────────────────────

const DEFAULT_CATEGORIES = [
  "External Walls", "Internal Partitions", "Roofing & Waterproofing",
  "Fire Stopping & Compartmentation", "Insulation", "Structural Frame",
  "Floors & Ceilings", "Curtain Walling", "Linings", "Doors & Ironmongery",
  "Windows & Glazing", "Drainage & Plumbing", "Mechanical & Ventilation",
  "Electrical", "Finishes & Fixtures", "Uncategorised",
];

// GET /api/projects/:id/categories — list categories, seeding defaults if none exist
app.get("/api/projects/:id/categories", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("project_product_categories")
      .select("*")
      .eq("project_id", req.params.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;

    if (data.length === 0) {
      // Seed defaults
      const rows = DEFAULT_CATEGORIES.map((name, i) => ({
        project_id: req.params.id,
        name,
        sort_order: i,
      }));
      const { data: seeded, error: seedError } = await supabase
        .from("project_product_categories")
        .insert(rows)
        .select();
      if (seedError) throw seedError;
      return res.json({ categories: seeded });
    }

    res.json({ categories: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/categories — create a new category
app.post("/api/projects/:id/categories", requireAuth, async (req, res) => {
  const { name, sort_order = 0 } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  try {
    const { data, error } = await supabase
      .from("project_product_categories")
      .insert({ project_id: req.params.id, name, sort_order })
      .select()
      .single();
    if (error) throw error;
    res.json({ category: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:id/categories/:cid — delete category, reassign its products to Uncategorised
app.delete("/api/projects/:id/categories/:cid", requireAuth, async (req, res) => {
  try {
    // Find or create the Uncategorised category for this project
    let uncategorisedId = null;
    const { data: existing } = await supabase
      .from("project_product_categories")
      .select("id")
      .eq("project_id", req.params.id)
      .eq("name", "Uncategorised")
      .single();

    if (existing) {
      uncategorisedId = existing.id;
    } else {
      const { data: created, error: createError } = await supabase
        .from("project_product_categories")
        .insert({ project_id: req.params.id, name: "Uncategorised", sort_order: 999 })
        .select()
        .single();
      if (createError) throw createError;
      uncategorisedId = created.id;
    }

    // Reassign products in this category to Uncategorised (unless they're already being deleted from Uncategorised)
    if (req.params.cid !== uncategorisedId) {
      await supabase
        .from("project_products")
        .update({ category_id: uncategorisedId })
        .eq("project_id", req.params.id)
        .eq("category_id", req.params.cid);
    }

    // Delete the category
    const { error } = await supabase
      .from("project_product_categories")
      .delete()
      .eq("id", req.params.cid)
      .eq("project_id", req.params.id);
    if (error) throw error;

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Project products (assignments) ────────────────────────────────────────────

// GET /api/projects/:id/products — list assigned products, joined with products table + attributes
app.get("/api/projects/:id/products", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("project_products")
      .select(`
        id,
        project_id,
        product_id,
        category_id,
        notes,
        created_at,
        products (
          id,
          name,
          manufacturer,
          product_type,
          file_key
        )
      `)
      .eq("project_id", req.params.id)
      .order("created_at", { ascending: true });
    if (error) throw error;

    // Fetch attributes for all assigned products in one query
    const productIds = data.map(r => r.product_id).filter(Boolean);
    let attributesMap = {};
    if (productIds.length > 0) {
      const { data: attrs } = await supabase
        .from("product_attributes")
        .select("product_id, attribute, value, unit")
        .in("product_id", productIds);
      if (attrs) {
        for (const a of attrs) {
          if (!attributesMap[a.product_id]) attributesMap[a.product_id] = [];
          attributesMap[a.product_id].push({ attribute: a.attribute, value: a.value, unit: a.unit });
        }
      }
    }

    // Stitch attributes into each row
    const enriched = data.map(r => ({
      ...r,
      products: r.products ? {
        ...r.products,
        attributes: attributesMap[r.product_id] || [],
      } : null,
    }));

    res.json({ products: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/products — assign a product to this project
app.post("/api/projects/:id/products", requireAuth, async (req, res) => {
  const { product_id, category_id, notes } = req.body;
  if (!product_id) return res.status(400).json({ error: "product_id required" });
  try {
    const { data, error } = await supabase
      .from("project_products")
      .insert({ project_id: req.params.id, product_id, category_id: category_id || null, notes: notes || null })
      .select(`
        id, project_id, product_id, category_id, notes, created_at,
        products ( id, name, manufacturer, product_type, file_key )
      `)
      .single();
    if (error) {
      // Unique constraint violation — already assigned
      if (error.code === "23505") return res.status(409).json({ error: "Product already assigned to this project" });
      throw error;
    }
    res.json({ product: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/projects/:id/products/:pid — update category or notes on an assignment
app.patch("/api/projects/:id/products/:pid", requireAuth, async (req, res) => {
  const { category_id, notes } = req.body;
  try {
    const { data, error } = await supabase
      .from("project_products")
      .update({ category_id: category_id || null, notes: notes !== undefined ? notes : undefined })
      .eq("id", req.params.pid)
      .eq("project_id", req.params.id)
      .select(`
        id, project_id, product_id, category_id, notes, created_at,
        products ( id, name, manufacturer, product_type, file_key )
      `)
      .single();
    if (error) throw error;
    res.json({ product: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:id/products/:pid — remove a product assignment
app.delete("/api/projects/:id/products/:pid", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("project_products")
      .delete()
      .eq("id", req.params.pid)
      .eq("project_id", req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin middleware ──────────────────────────────────────────────────────────
async function requireAdmin(req, res, next) {
  const role = req.user?.user_metadata?.role;
  if (role !== "admin") {
    return res.status(403).json({ error: "Forbidden — admin only" });
  }
  next();
}

// ── Admin routes ──────────────────────────────────────────────────────────────

// GET /api/admin/users — list all users
app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) throw error;
    const users = data.users.map(u => ({
      id: u.id,
      email: u.email,
      role: u.user_metadata?.role || "user",
      created_at: u.created_at,
    }));
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users — create a new user
app.post("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  const validRole = role === "admin" ? "admin" : "user";
  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { role: validRole },
      email_confirm: true,
    });
    if (error) throw error;
    res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        role: data.user.user_metadata?.role || "user",
        created_at: data.user.created_at,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/users/:uid — update role
app.patch("/api/admin/users/:uid", requireAuth, requireAdmin, async (req, res) => {
  const { role } = req.body;
  const validRole = role === "admin" ? "admin" : "user";
  try {
    const { data, error } = await supabase.auth.admin.updateUserById(req.params.uid, {
      user_metadata: { role: validRole },
    });
    if (error) throw error;
    res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        role: data.user.user_metadata?.role || "user",
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/users/:uid — delete user
app.delete("/api/admin/users/:uid", requireAuth, requireAdmin, async (req, res) => {
  // Prevent self-deletion
  if (req.params.uid === req.user.id) {
    return res.status(400).json({ error: "You cannot delete your own account" });
  }
  try {
    const { error } = await supabase.auth.admin.deleteUser(req.params.uid);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.get("*", (req, res) => res.status(404).json({ error: "Not found" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Archimind server running on port ${PORT}`));