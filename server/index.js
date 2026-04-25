const express = require("express");
const cors = require("cors");
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, CopyObjectCommand } = require("@aws-sdk/client-s3");
const { createClient } = require("@supabase/supabase-js");

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

// ── Gemini AI proxy ───────────────────────────────────────────────────────────
app.post("/api/claude", async (req, res) => {
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
app.get("/api/vaults", async (req, res) => {
  try {
    // List top-level "folders" (depth-1 prefixes)
    const topCmd = new ListObjectsV2Command({ Bucket: BUCKET, Delimiter: "/" });
    const topResult = await r2.send(topCmd);
    const topPrefixes = (topResult.CommonPrefixes || []).map(p => p.Prefix); // e.g. "British Standards/"

    const vaults = [];

    for (const prefix of topPrefixes) {
      const name = prefix.slice(0, -1); // strip trailing /

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
app.post("/api/vaults", async (req, res) => {
  const { name, type = "vault", parentVault } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  try {
    if (type === "master") {
      // Create master vault with type metadata
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${name}/.vault`,
        Body: JSON.stringify({ created: new Date().toISOString(), type: "master" }),
        ContentType: "application/json",
      }));
      res.json({ id: name, name, type: "master", subVaults: [] });

    } else if (parentVault) {
      // Create sub-vault inside a master vault
      const path = `${parentVault}/${name}`;
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${path}/.vault`,
        Body: JSON.stringify({ created: new Date().toISOString(), type: "vault", parent: parentVault }),
        ContentType: "application/json",
      }));
      res.json({ id: path, name, path, type: "vault" });

    } else {
      // Regular flat vault
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

// PATCH /api/vaults/:vault — rename a vault (works for flat, master, or sub-vault)
// For sub-vaults pass the full path: "British Standards/BS 9991"
app.patch("/api/vaults/*", async (req, res) => {
  const vaultPath = req.params[0]; // full path including any parent
  const { name: newName } = req.body;
  if (!newName) return res.status(400).json({ error: "New name required" });

  try {
    const parts = vaultPath.split("/");
    let newPath;
    if (parts.length === 1) {
      // Top-level vault rename
      newPath = newName;
    } else {
      // Sub-vault rename — keep parent, change last segment
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
app.delete("/api/vaults/*", async (req, res) => {
  // Avoid conflict with the PDF delete route
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
app.post("/api/vaults/*/adopt", async (req, res) => {
  const masterPath = req.params[0];
  const { sourceVault } = req.body; // name of the flat vault to adopt
  if (!sourceVault) return res.status(400).json({ error: "sourceVault required" });

  try {
    const fromPrefix = `${sourceVault}/`;
    const toPrefix = `${masterPath}/${sourceVault}/`;
    await movePrefix(fromPrefix, toPrefix);

    // Update .vault metadata to record parent
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
app.get("/api/vaults/*/pdfs", async (req, res) => {
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
app.post("/api/vaults/*/pdfs", async (req, res) => {
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
app.get("/api/vaults/*/pdfs/:filename", async (req, res) => {
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
app.delete("/api/vaults/*/pdfs/:filename", async (req, res) => {
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
app.post("/api/vaults/*/index", async (req, res) => {
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
app.get("/api/vaults/*/index", async (req, res) => {
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
app.post("/api/extract-text", async (req, res) => {
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
app.post("/api/extract-pages", async (req, res) => {
  const { base64, pages } = req.body;
  if (!base64 || !pages || !Array.isArray(pages)) {
    return res.status(400).json({ error: "base64 and pages array required" });
  }

  const pdfBytes = Buffer.from(base64, "base64");
  const pageList = pages.map(Number).filter(p => p > 0).sort((a, b) => a - b);

  // Attempt 1: mupdf
  try {
    const mupdf = await import("mupdf");
    const srcDoc = new mupdf.PDFDocument(pdfBytes);
    const totalPages = srcDoc.countPages();
    const validPages = pageList.filter(p => p <= totalPages);
    if (validPages.length === 0) return res.status(400).json({ error: "No valid pages" });

    const outDoc = new mupdf.PDFDocument();
    const graftMap = outDoc.newGraftMap();
    for (const pageNum of validPages) {
      const pageRef = srcDoc.findPage(pageNum - 1);
      const newPageRef = graftMap.graftObject(pageRef);
      outDoc.insertPage(-1, newPageRef);
    }
    const outPageCount = outDoc.countPages();
    if (outPageCount === 0) throw new Error("mupdf produced empty document");
    const rawBuffer = outDoc.saveToBuffer("compress,garbage");
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

// GET /api/products — list all products
app.get("/api/products", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("id, created_at, name, manufacturer, file_key")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ products: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/:id — get a single product with its attributes
app.get("/api/products/:id", async (req, res) => {
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

// POST /api/products — create a new product record
app.post("/api/products", async (req, res) => {
  const { name, manufacturer, file_key, raw_text, attributes = [] } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });

  try {
    const { data: product, error: productError } = await supabase
      .from("products")
      .insert({ name, manufacturer, file_key, raw_text })
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

// DELETE /api/products/:id — delete a product and its attributes
app.delete("/api/products/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", req.params.id);
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
