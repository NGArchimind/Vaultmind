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
    const topCmd = new ListObjectsV2Command({ Bucket: BUCKET, Delimiter: "/" });
    const topResult = await r2.send(topCmd);
    const topPrefixes = (topResult.CommonPrefixes || []).map(p => p.Prefix);

    const SYSTEM_PREFIXES = new Set(["products", "projects", "settings"]);
    const vaults = [];

    for (const prefix of topPrefixes) {
      const name = prefix.slice(0, -1);
      if (SYSTEM_PREFIXES.has(name)) continue;

      let meta = {};
      try {
        const metaResult = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${prefix}.vault` }));
        const buf = await streamToBuffer(metaResult.Body);
        meta = JSON.parse(buf.toString());
      } catch (_) {}

      if (meta.type === "master") {
        const subCmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, Delimiter: "/" });
        const subResult = await r2.send(subCmd);
        const subPrefixes = (subResult.CommonPrefixes || []).map(p => p.Prefix);
        const subVaults = subPrefixes.map(sp => {
          const subName = sp.slice(prefix.length, -1);
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
    } catch (_) {}

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
      } catch (_) {}
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
      } catch (_) {}
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

  // Fire and forget — record transmittal issue from sync results
  recordTransmittalIssue(req.params.id, results).catch(err =>
    console.error("Transmittal issue recording error (non-fatal):", err.message)
  );
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

// ── Transmittal system ────────────────────────────────────────────────────────
//
// Data model:
//   project_transmittal_issues   — one row per issue event (project_id, issue_date)
//   project_transmittal_revisions — one row per drawing per issue (issue_id, drawing_number, revision)
//   project_transmittal_settings — one row per project (notes, bforward_overrides as jsonb)
//
// B' Forward is auto-calculated as the highest revision across all issue columns
// for each drawing. It can be manually overridden (stored in bforward_overrides)
// and is flagged visually in the frontend when overridden.
//
// Revision sequence: P01, P02... → T01, T02... → C01, C02...
// Out-of-sequence detection is handled in ArchiSync before upload.

// ── Revision sequence helpers ─────────────────────────────────────────────────

// Default stage order — can be extended via admin settings in future
const DEFAULT_STAGE_ORDER = ["P", "T", "C"];

// Parse a revision string into { stage, num } e.g. "P03" → { stage: "P", num: 3 }
function parseRevision(rev) {
  if (!rev) return null;
  const match = String(rev).trim().match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;
  return { stage: match[1].toUpperCase(), num: parseInt(match[2], 10) };
}

// Compare two revisions using DEFAULT_STAGE_ORDER.
// Returns negative if a < b, 0 if equal, positive if a > b.
// Returns null if either cannot be parsed.
function compareRevisions(a, b, stageOrder = DEFAULT_STAGE_ORDER) {
  const pa = parseRevision(a);
  const pb = parseRevision(b);
  if (!pa || !pb) return null;
  const ia = stageOrder.indexOf(pa.stage);
  const ib = stageOrder.indexOf(pb.stage);
  // Unknown stages go to end
  const sa = ia === -1 ? 999 : ia;
  const sb = ib === -1 ? 999 : ib;
  if (sa !== sb) return sa - sb;
  return pa.num - pb.num;
}

// Check if newRev is the expected next revision after currentRev.
// Returns { ok: true } or { ok: false, reason: string }
function checkRevisionSequence(currentRev, newRev, stageOrder = DEFAULT_STAGE_ORDER) {
  if (!currentRev) return { ok: true }; // first revision, anything goes
  const pc = parseRevision(currentRev);
  const pn = parseRevision(newRev);
  if (!pc || !pn) return { ok: true }; // unparseable — don't block

  const ic = stageOrder.indexOf(pc.stage);
  const in_ = stageOrder.indexOf(pn.stage);

  if (pc.stage === pn.stage) {
    // Same stage — next number must be exactly +1
    if (pn.num === pc.num + 1) return { ok: true };
    if (pn.num <= pc.num) return { ok: false, reason: `Revision ${newRev} is behind current revision ${currentRev}` };
    return { ok: false, reason: `Revision ${newRev} skips from ${currentRev} — expected ${pc.stage}${String(pc.num + 1).padStart(2, "0")}` };
  }

  // Stage change — must move to next stage at 01
  const expectedNextStageIdx = ic + 1;
  if (in_ === expectedNextStageIdx && pn.num === 1) return { ok: true };

  const expectedStage = stageOrder[expectedNextStageIdx];
  if (expectedStage) {
    return { ok: false, reason: `Revision ${newRev} is out of sequence — expected ${expectedStage}01 after ${currentRev}` };
  }

  return { ok: false, reason: `Revision ${newRev} is beyond the known stage sequence` };
}

// GET /api/revision-sequence — return current stage order (practice-wide)
// For now returns the default. In future this can be stored in a settings table.
app.get("/api/revision-sequence", requireAuth, async (req, res) => {
  res.json({ stages: DEFAULT_STAGE_ORDER });
});

// POST /api/revision-check — check if a revision is in sequence
// Body: { drawing_number, project_id, new_revision }
app.post("/api/revision-check", requireAuth, async (req, res) => {
  const { drawing_number, project_id, new_revision } = req.body;
  if (!drawing_number || !project_id || !new_revision) {
    return res.status(400).json({ error: "drawing_number, project_id and new_revision required" });
  }
  try {
    const { data: drawing } = await supabase
      .from("project_drawings")
      .select("revision")
      .eq("project_id", project_id)
      .eq("drawing_number", drawing_number)
      .single();

    const currentRev = drawing?.revision || null;
    const result = checkRevisionSequence(currentRev, new_revision);
    res.json({ current_revision: currentRev, new_revision, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── recordTransmittalIssue — called after sync or manual trigger ──────────────
// Only creates a new issue record if there are actual changes (created/updated drawings).
async function recordTransmittalIssue(projectId, syncResults) {
  const changedNumbers = (syncResults || [])
    .filter(r => r.action === "updated" || r.action === "created")
    .map(r => r.drawing_number)
    .filter(Boolean);

  if (changedNumbers.length === 0) return;

  const issueDate = new Date().toISOString().slice(0, 10);

  // Create the issue record
  const { data: issue, error: issueError } = await supabase
    .from("project_transmittal_issues")
    .insert({ project_id: projectId, issue_date: issueDate })
    .select()
    .single();
  if (issueError) throw issueError;

  // Fetch current revisions for all changed drawings
  const { data: drawings, error: drawingsError } = await supabase
    .from("project_drawings")
    .select("drawing_number, revision")
    .eq("project_id", projectId)
    .in("drawing_number", changedNumbers);
  if (drawingsError) throw drawingsError;

  // Insert a revision row for each changed drawing
  const revRows = drawings.map(d => ({
    issue_id: issue.id,
    drawing_number: d.drawing_number,
    revision: d.revision || "",
  }));

  if (revRows.length > 0) {
    const { error: revError } = await supabase
      .from("project_transmittal_revisions")
      .insert(revRows);
    if (revError) throw revError;
  }

  console.log(`Transmittal issue recorded for project ${projectId}: ${issueDate}, ${changedNumbers.length} drawings`);
}

// ── GET /api/projects/:id/transmittal — full transmittal data for frontend render
app.get("/api/projects/:id/transmittal", requireAuth, async (req, res) => {
  try {
    const projectId = req.params.id;

    // Project info
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("name, job_number, location")
      .eq("id", projectId)
      .single();
    if (projectError) throw projectError;

    // All drawings
    const { data: drawings, error: drawingsError } = await supabase
      .from("project_drawings")
      .select("id, title, drawing_number, revision, drawing_type")
      .eq("project_id", projectId)
      .order("drawing_number", { ascending: true });
    if (drawingsError) throw drawingsError;

    // All issues in date order
    const { data: issues, error: issuesError } = await supabase
      .from("project_transmittal_issues")
      .select("id, issue_date")
      .eq("project_id", projectId)
      .order("issue_date", { ascending: true });
    if (issuesError) throw issuesError;

    // All revisions for those issues
    let revisions = [];
    if (issues.length > 0) {
      const issueIds = issues.map(i => i.id);
      const { data: revData, error: revError } = await supabase
        .from("project_transmittal_revisions")
        .select("issue_id, drawing_number, revision")
        .in("issue_id", issueIds);
      if (revError) throw revError;
      revisions = revData;
    }

    // Build revision lookup: revMap[issueId][drawingNumber] = revision
    const revMap = {};
    for (const r of revisions) {
      if (!revMap[r.issue_id]) revMap[r.issue_id] = {};
      revMap[r.issue_id][r.drawing_number] = r.revision;
    }

    // Transmittal settings (notes + B' Forward overrides)
    const { data: settings } = await supabase
      .from("project_transmittal_settings")
      .select("notes, bforward_overrides")
      .eq("project_id", projectId)
      .single();

    const bforwardOverrides = settings?.bforward_overrides || {};

    // Calculate auto B' Forward for each drawing:
    // highest revision seen across all issues for that drawing
    const autoBforward = {};
    for (const drawing of drawings) {
      const dn = drawing.drawing_number;
      if (!dn) continue;
      let highest = null;
      for (const issue of issues) {
        const rev = revMap[issue.id]?.[dn];
        if (rev) {
          if (!highest || compareRevisions(rev, highest) > 0) {
            highest = rev;
          }
        }
      }
      autoBforward[dn] = highest || "";
    }

    res.json({
      project,
      drawings,
      issues,
      revMap,
      autoBforward,
      bforwardOverrides,
      notes: settings?.notes || "",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/projects/:id/transmittal/issue — save PDF snapshot to R2
// Does NOT create a new issue column — columns are only created by ArchiSync.
app.post("/api/projects/:id/transmittal/issue", requireAuth, async (req, res) => {
  const { html } = req.body;
  if (!html) return res.status(400).json({ error: "html required" });
  try {
    const prefix = `projects/${req.params.id}/documents/transmittals/`;
    const dateStr = new Date().toISOString().slice(0, 10);
    const baseKey = `${prefix}schedule_${dateStr}`;
    const existingKeys = await listAllKeys(prefix);
    let key = `${baseKey}.html`;
    if (existingKeys.includes(key)) {
      let n = 2;
      while (existingKeys.includes(`${baseKey}_${n}.html`)) n++;
      key = `${baseKey}_${n}.html`;
    }
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key,
      Body: Buffer.from(html, "utf-8"),
      ContentType: "text/html",
    }));
    res.json({ saved: true, key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/projects/:id/transmittal/revisions — edit a single revision cell
// Body: { issue_id, drawing_number, revision }
// This is the emergency correction path — all cells editable with client-side warning.
app.patch("/api/projects/:id/transmittal/revisions", requireAuth, async (req, res) => {
  const { issue_id, drawing_number, revision } = req.body;
  if (!issue_id || !drawing_number) return res.status(400).json({ error: "issue_id and drawing_number required" });
  try {
    // Verify the issue belongs to this project
    const { data: issue, error: issueError } = await supabase
      .from("project_transmittal_issues")
      .select("id, project_id")
      .eq("id", issue_id)
      .eq("project_id", req.params.id)
      .single();
    if (issueError || !issue) return res.status(404).json({ error: "Issue not found for this project" });

    // Upsert the revision row
    const { data, error } = await supabase
      .from("project_transmittal_revisions")
      .upsert(
        { issue_id, drawing_number, revision: revision || "" },
        { onConflict: "issue_id,drawing_number" }
      )
      .select()
      .single();
    if (error) throw error;
    res.json({ revision: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/projects/:id/transmittal/settings — save notes and/or B' Forward overrides
app.patch("/api/projects/:id/transmittal/settings", requireAuth, async (req, res) => {
  const { notes, bforward_overrides } = req.body;
  try {
    const upsertData = {
      project_id: req.params.id,
      updated_at: new Date().toISOString(),
    };
    if (notes !== undefined) upsertData.notes = notes;
    if (bforward_overrides !== undefined) upsertData.bforward_overrides = bforward_overrides;

    const { data, error } = await supabase
      .from("project_transmittal_settings")
      .upsert(upsertData, { onConflict: "project_id" })
      .select()
      .single();
    if (error) throw error;
    res.json({ settings: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/projects/:id/transmittal/export/excel — generate Excel on demand
app.get("/api/projects/:id/transmittal/export/excel", requireAuth, async (req, res) => {
  try {
    const projectId = req.params.id;

    // Fetch all the same data as the GET /transmittal route
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

    const { data: issues } = await supabase
      .from("project_transmittal_issues")
      .select("id, issue_date")
      .eq("project_id", projectId)
      .order("issue_date", { ascending: true });

    let revisions = [];
    if (issues && issues.length > 0) {
      const issueIds = issues.map(i => i.id);
      const { data: revData } = await supabase
        .from("project_transmittal_revisions")
        .select("issue_id, drawing_number, revision")
        .in("issue_id", issueIds);
      revisions = revData || [];
    }

    const revMap = {};
    for (const r of revisions) {
      if (!revMap[r.issue_id]) revMap[r.issue_id] = {};
      revMap[r.issue_id][r.drawing_number] = r.revision;
    }

    const { data: settings } = await supabase
      .from("project_transmittal_settings")
      .select("notes, bforward_overrides")
      .eq("project_id", projectId)
      .single();

    const bforwardOverrides = settings?.bforward_overrides || {};

    // Calculate B' Forward
    const autoBforward = {};
    for (const drawing of (drawings || [])) {
      const dn = drawing.drawing_number;
      if (!dn) continue;
      let highest = null;
      for (const issue of (issues || [])) {
        const rev = revMap[issue.id]?.[dn];
        if (rev && (!highest || compareRevisions(rev, highest) > 0)) highest = rev;
      }
      autoBforward[dn] = highest || "";
    }

    // Build Excel workbook
    const wb = new ExcelJS.Workbook();
    wb.creator = "Archimind";

    const NAVY    = "FF1a2332";
    const TEAL    = "FF2d6a4f";
    const SALMON  = "FFFFC0CB";
    const LGREY   = "FFF5F5F5";
    const HDRFILL = "FFE8E8E8";
    const WHITE   = "FFFFFFFF";
    const BORDCLR = "FFB0B0B0";

    function sf(argb) { return { type: "pattern", pattern: "solid", fgColor: { argb } }; }
    function bdr() { const s = { style: "thin", color: { argb: BORDCLR } }; return { top: s, left: s, bottom: s, right: s }; }
    function f(bold = false, size = 8, color = NAVY) { return { name: "Arial", size, bold, color: { argb: color } }; }

    const ws = wb.addWorksheet("Drawing Schedule");
    ws.pageSetup = {
      paperSize: 9, orientation: "landscape", fitToPage: true,
      fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    };

    // Fixed columns: Title (A), Drawing No (B), B'Forward (C), then issue date columns
    ws.getColumn(1).width = 48;
    ws.getColumn(2).width = 28;
    ws.getColumn(3).width = 10;
    const issueStartCol = 4;
    const totalIssues = (issues || []).length;
    for (let i = 0; i < totalIssues; i++) {
      ws.getColumn(issueStartCol + i).width = 8;
    }

    // Row 1: Banner
    ws.getRow(1).height = 20;
    const bannerEndCol = Math.max(issueStartCol + totalIssues - 1, 4);
    ws.mergeCells(1, 1, 1, bannerEndCol);
    Object.assign(ws.getCell(1, 1), {
      value: "Architectural Design and Technology",
      font: { name: "Arial", size: 11, bold: false, italic: true, color: { argb: "FFFFFFFF" } },
      fill: sf(TEAL),
      alignment: { horizontal: "center", vertical: "middle" },
    });

    // Row 2: Job number | Project description
    ws.getRow(2).height = 13;
    ws.getCell(2, 1).value = project?.job_number ? `Job Number - ${project.job_number}` : "Job Number -";
    ws.getCell(2, 1).font = f(true, 8);

    // Row 3: Site
    ws.getRow(3).height = 12;
    ws.getCell(3, 1).value = project?.location ? `Site - ${project.location}` : "";
    ws.getCell(3, 1).font = f(false, 8);

    // Row 4: Project name
    ws.getRow(4).height = 16;
    ws.getCell(4, 1).value = project?.name || "";
    ws.getCell(4, 1).font = { name: "Arial", size: 12, bold: true, color: { argb: NAVY } };

    // Row 5: Date of Issue label + Day values
    ws.getRow(5).height = 12;
    ws.getCell(5, 3).value = "Date of Issue";
    ws.getCell(5, 3).font = f(true, 8);
    (issues || []).forEach((issue, i) => {
      const d = new Date(issue.issue_date);
      const cell = ws.getCell(5, issueStartCol + i);
      cell.value = String(d.getUTCDate()).padStart(2, "0");
      cell.font = f(false, 8);
      cell.fill = sf(HDRFILL);
      cell.alignment = { horizontal: "center" };
      cell.border = bdr();
    });

    // Row 6: Month
    ws.getRow(6).height = 12;
    ws.getCell(6, 3).value = "Month";
    ws.getCell(6, 3).font = f(false, 8);
    (issues || []).forEach((issue, i) => {
      const d = new Date(issue.issue_date);
      const cell = ws.getCell(6, issueStartCol + i);
      cell.value = String(d.getUTCMonth() + 1).padStart(2, "0");
      cell.font = f(false, 8);
      cell.fill = sf(HDRFILL);
      cell.alignment = { horizontal: "center" };
      cell.border = bdr();
    });

    // Row 7: Year
    ws.getRow(7).height = 12;
    ws.getCell(7, 3).value = "Year";
    ws.getCell(7, 3).font = f(false, 8);
    (issues || []).forEach((issue, i) => {
      const d = new Date(issue.issue_date);
      const cell = ws.getCell(7, issueStartCol + i);
      cell.value = String(d.getUTCFullYear()).slice(2);
      cell.font = f(false, 8);
      cell.fill = sf(HDRFILL);
      cell.alignment = { horizontal: "center" };
      cell.border = bdr();
    });

    // Row 8: Column headers
    ws.getRow(8).height = 14;
    const headers = [
      { val: "Drawing Title", align: "left" },
      { val: "Drawing No", align: "center" },
      { val: "B' Forward", align: "center" },
    ];
    headers.forEach((h, i) => {
      const cell = ws.getCell(8, i + 1);
      cell.value = h.val;
      cell.font = f(true, 8);
      cell.fill = sf(HDRFILL);
      cell.border = bdr();
      cell.alignment = { horizontal: h.align, vertical: "middle" };
    });
    (issues || []).forEach((_, i) => {
      const cell = ws.getCell(8, issueStartCol + i);
      cell.value = "Amdts";
      cell.font = f(true, 8);
      cell.fill = sf(HDRFILL);
      cell.border = bdr();
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });

    // Drawing rows grouped by drawing_type
    const groups = {};
    for (const d of (drawings || [])) {
      const grp = (d.drawing_type || "Other").trim();
      if (!groups[grp]) groups[grp] = [];
      groups[grp].push(d);
    }

    let currentRow = 9;
    let drawIdx = 0;

    for (const [groupName, groupDrawings] of Object.entries(groups)) {
      ws.getRow(currentRow).height = 13;
      const grpEndCol = Math.max(issueStartCol + totalIssues - 1, issueStartCol);
      try { ws.mergeCells(currentRow, 1, currentRow, grpEndCol); } catch (_) {}
      const gh = ws.getCell(currentRow, 1);
      gh.value = groupName;
      gh.font = f(true, 8);
      gh.fill = sf(HDRFILL);
      gh.border = bdr();
      gh.alignment = { vertical: "middle" };
      currentRow++;

      for (const d of groupDrawings) {
        ws.getRow(currentRow).height = 12;
        const rowFill = drawIdx % 2 === 0 ? WHITE : LGREY;
        const dn = d.drawing_number;

        const bfOverride = bforwardOverrides[dn];
        const bfValue = bfOverride?.manual ? bfOverride.value : (autoBforward[dn] || "");

        const titleCell = ws.getCell(currentRow, 1);
        titleCell.value = d.title || "";
        titleCell.font = f(false, 8);
        titleCell.fill = sf(rowFill);
        titleCell.border = bdr();
        titleCell.alignment = { vertical: "middle" };

        const numCell = ws.getCell(currentRow, 2);
        numCell.value = dn || "";
        numCell.font = f(false, 8);
        numCell.fill = sf(rowFill);
        numCell.border = bdr();
        numCell.alignment = { horizontal: "center", vertical: "middle" };

        const bfCell = ws.getCell(currentRow, 3);
        bfCell.value = bfValue;
        bfCell.font = f(true, 8);
        bfCell.fill = sf(bfOverride?.manual ? SALMON : rowFill);
        bfCell.border = bdr();
        bfCell.alignment = { horizontal: "center", vertical: "middle" };

        (issues || []).forEach((issue, i) => {
          const rev = revMap[issue.id]?.[dn] || "";
          const isLatest = i === (issues.length - 1);
          const cell = ws.getCell(currentRow, issueStartCol + i);
          cell.value = rev;
          cell.font = f(!!rev && isLatest, 8);
          cell.fill = sf(isLatest ? SALMON : rowFill);
          cell.border = bdr();
          cell.alignment = { horizontal: "center", vertical: "middle" };
        });

        currentRow++;
        drawIdx++;
      }

      // Spacer row between groups
      ws.getRow(currentRow).height = 5;
      currentRow++;
    }

    // Notes row if present
    if (settings?.notes) {
      currentRow++;
      ws.getRow(currentRow).height = 12;
      ws.getCell(currentRow, 1).value = settings.notes;
      ws.getCell(currentRow, 1).font = f(false, 8);
    }

    const xlsxBuffer = await wb.xlsx.writeBuffer();
    const projectName = (project?.name || "drawing-schedule").replace(/[^a-zA-Z0-9-_]/g, "_");
    res.json({
      base64: Buffer.from(xlsxBuffer).toString("base64"),
      name: `${projectName}_drawing_schedule.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

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

// ── DELETE /api/projects/:id/transmittal/issues/:issueId — delete an entire issue column
// Admin only. Must be registered BEFORE the legacy transmittals/:tid route to avoid param collision.
app.delete("/api/projects/:id/transmittal/issues/:issueId", requireAuth, requireAdmin, async (req, res) => {
  const { id: projectId, issueId } = req.params;
  try {
    const { data: issue, error: issueError } = await supabase
      .from("project_transmittal_issues")
      .select("id, project_id, issue_date")
      .eq("id", issueId)
      .eq("project_id", projectId)
      .single();
    if (issueError || !issue) return res.status(404).json({ error: "Issue not found for this project" });

    const { error: revError } = await supabase
      .from("project_transmittal_revisions")
      .delete()
      .eq("issue_id", issueId);
    if (revError) throw revError;

    const { error: delError } = await supabase
      .from("project_transmittal_issues")
      .delete()
      .eq("id", issueId)
      .eq("project_id", projectId);
    if (delError) throw delError;

    res.json({ deleted: true, issue_date: issue.issue_date });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/projects/:id/transmittals/files?keys=key1,key2 — batch delete R2 snapshots
// Must be registered BEFORE transmittals/:tid to avoid "files" being matched as :tid.
app.delete("/api/projects/:id/transmittals/files", requireAuth, requireAdmin, async (req, res) => {
  const { keys: keysParam } = req.query;
  if (!keysParam) return res.status(400).json({ error: "keys query param required" });
  const keys = keysParam.split(",").map(k => decodeURIComponent(k.trim())).filter(Boolean);
  if (keys.length === 0) return res.status(400).json({ error: "No keys provided" });
  const expectedPrefix = transmittalPrefix(req.params.id);
  const invalid = keys.filter(k => !k.startsWith(expectedPrefix));
  if (invalid.length > 0) return res.status(403).json({ error: "Forbidden — keys outside project transmittals folder" });
  try {
    for (const key of keys) {
      await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    }
    res.json({ deleted: keys.length });
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

app.delete("/api/projects/:id/categories/:cid", requireAuth, async (req, res) => {
  try {
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

    if (req.params.cid !== uncategorisedId) {
      await supabase
        .from("project_products")
        .update({ category_id: uncategorisedId })
        .eq("project_id", req.params.id)
        .eq("category_id", req.params.cid);
    }

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
      if (error.code === "23505") return res.status(409).json({ error: "Product already assigned to this project" });
      throw error;
    }
    res.json({ product: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

app.delete("/api/admin/users/:uid", requireAuth, requireAdmin, async (req, res) => {
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

// ── Admin: practice logo ──────────────────────────────────────────────────────
// Logo is stored in R2 at: settings/practice_logo (no extension — base64 + mime stored as JSON)

app.get("/api/admin/logo", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: "settings/practice_logo.json" }));
    const buf = await streamToBuffer(result.Body);
    res.json(JSON.parse(buf.toString()));
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return res.json({ logo: null });
    }
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/logo", requireAuth, requireAdmin, async (req, res) => {
  const { base64, mimeType } = req.body;
  if (!base64 || !mimeType) return res.status(400).json({ error: "base64 and mimeType required" });
  try {
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: "settings/practice_logo.json",
      Body: JSON.stringify({ base64, mimeType }),
      ContentType: "application/json",
    }));
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/logo", requireAuth, requireAdmin, async (req, res) => {
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: "settings/practice_logo.json" }));
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/logo — public (authenticated) route for frontend to fetch logo for transmittal display
app.get("/api/logo", requireAuth, async (req, res) => {
  try {
    const result = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: "settings/practice_logo.json" }));
    const buf = await streamToBuffer(result.Body);
    res.json(JSON.parse(buf.toString()));
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return res.json({ logo: null });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: schedule colours ───────────────────────────────────────────────────
// Colours stored in R2 at: settings/schedule_colours.json
// Shape: { header, groupRow, bforward, latestIssue, rowEven, rowOdd, headerText, bodyText }

const DEFAULT_COLOURS = {
  header:      "#1a2332",
  groupRow:    "#f0ede8",
  bforward:    "#2e5e8e",
  latestIssue: "#c25a45",
  rowEven:     "#ffffff",
  rowOdd:      "#faf8f5",
  headerText:  "#ffffff",
  bodyText:    "#1a2332",
};

app.get("/api/admin/colours", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: "settings/schedule_colours.json" }));
    const buf = await streamToBuffer(result.Body);
    res.json(JSON.parse(buf.toString()));
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return res.json(DEFAULT_COLOURS);
    }
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/colours", requireAuth, requireAdmin, async (req, res) => {
  const colours = req.body;
  if (!colours || typeof colours !== "object") return res.status(400).json({ error: "colours object required" });
  try {
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: "settings/schedule_colours.json",
      Body: JSON.stringify({ ...DEFAULT_COLOURS, ...colours }),
      ContentType: "application/json",
    }));
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/colours — authenticated route for all users
app.get("/api/colours", requireAuth, async (req, res) => {
  try {
    const result = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: "settings/schedule_colours.json" }));
    const buf = await streamToBuffer(result.Body);
    res.json(JSON.parse(buf.toString()));
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return res.json(DEFAULT_COLOURS);
    }
    res.status(500).json({ error: err.message });
  }
});

// ── Transmittal PDF — save snapshot to R2 and return key ─────────────────────
// POST /api/projects/:id/transmittal/pdf
// Body: { html: string } — the print-ready HTML generated client-side
app.post("/api/projects/:id/transmittal/pdf", requireAuth, async (req, res) => {
  const { html } = req.body;
  if (!html) return res.status(400).json({ error: "html required" });
  try {
    const prefix = `projects/${req.params.id}/documents/transmittals/`;
    const dateStr = new Date().toISOString().slice(0, 10);
    const baseKey = `${prefix}schedule_${dateStr}`;
    let key = `${baseKey}.html`;
    const existingKeys = await listAllKeys(prefix);
    if (existingKeys.includes(key)) {
      let n = 2;
      while (existingKeys.includes(`${baseKey}_${n}.html`)) n++;
      key = `${baseKey}_${n}.html`;
    }
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: Buffer.from(html, "utf-8"),
      ContentType: "text/html",
    }));
    res.json({ key, saved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Transmittal files listing (PDF snapshots) ─────────────────────────────────
// GET /api/projects/:id/transmittals/files
function transmittalPrefix(projectId) {
  return `projects/${projectId}/documents/transmittals/`;
}

app.get("/api/projects/:id/transmittals/files", requireAuth, async (req, res) => {
  try {
    const prefix = transmittalPrefix(req.params.id);
    const keys = await listAllKeys(prefix);
    const files = keys
      .map(key => {
        const name = key.replace(prefix, "");
        if (!name.endsWith(".html")) return null;
        const label = name
          .replace("schedule_", "Issue — ")
          .replace(".html", "")
          .replace(/_(\d+)$/, " ($1)");
        return { key, name, label, type: "pdf-snapshot" };
      })
      .filter(Boolean)
      .sort((a, b) => b.name.localeCompare(a.name));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id/transmittals/download?key=...
app.get("/api/projects/:id/transmittals/download", requireAuth, async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: "key required" });
  const expectedPrefix = transmittalPrefix(req.params.id);
  if (!key.startsWith(expectedPrefix)) return res.status(403).json({ error: "Forbidden" });
  try {
    const result = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const buffer = await streamToBuffer(result.Body);
    const name = key.split("/").pop();
    res.json({ base64: buffer.toString("base64"), name, contentType: "text/html" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── ArchiSync connection config — admin only ──────────────────────────────────
// Returns the values needed to build a connection code in the admin UI.
// SUPABASE_ANON_KEY must be set in Railway environment variables.
app.get("/api/admin/archisync-config", requireAuth, requireAdmin, (req, res) => {
  const apiUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : process.env.API_URL || "";
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

  if (!supabaseAnonKey) {
    return res.status(500).json({ error: "SUPABASE_ANON_KEY is not set on the server. Add it to your Railway environment variables." });
  }

  res.json({ apiUrl, supabaseUrl, supabaseAnonKey });
});

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.get("*", (req, res) => res.status(404).json({ error: "Not found" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Archimind server running on port ${PORT}`));

