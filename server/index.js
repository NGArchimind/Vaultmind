const express = require("express");
const cors = require("cors");
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { PDFDocument } = require("pdf-lib");

const app = express();
app.use(cors());
app.use(express.json({ limit: "100mb" }));

// ── R2 CLIENT ────────────────────────────────────────────────────────────────
const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET || "vaultmind-docs";

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// ── GEMINI PROXY ─────────────────────────────────────────────────────────────
app.post("/api/claude", async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY not set." });

  try {
    const { system, messages } = req.body;
    
    // Map Anthropic messages to Gemini format
    const contents = messages.map(m => {
      const parts = [];
      if (typeof m.content === "string") {
        parts.push({ text: m.content });
      } else if (Array.isArray(m.content)) {
        m.content.forEach(c => {
          if (c.type === "text") parts.push({ text: c.text });
          if (c.type === "image" || (c.type === "document" && c.source?.media_type === "application/pdf")) {
            parts.push({
              inline_data: {
                mime_type: c.source?.media_type || "application/pdf",
                data: c.source?.data
              }
            });
          }
        });
      }
      return { role: m.role === "assistant" ? "model" : "user", parts };
    });

    // Inject system prompt as first user message if present
    if (system) {
      contents.unshift({
        role: "user",
        parts: [{ text: `SYSTEM INSTRUCTIONS: ${system}\n\nPlease acknowledge and wait for my first request.` }]
      }, {
        role: "model",
        parts: [{ text: "Understood. I will follow those instructions exactly." }]
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents })
      }
    );

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // CLEANER: If Gemini returns markdown JSON blocks, strip them so the frontend can parse easily
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    res.json({ content: [{ type: "text", text }] });
  } catch (err) {
    console.error("Gemini Proxy Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PAGE EXTRACTION ──────────────────────────────────────────────────────────
app.post("/api/extract-pages", async (req, res) => {
  const { base64, pages } = req.body;
  if (!base64 || !pages) return res.status(400).json({ error: "Missing data" });

  try {
    const pdfBytes = Buffer.from(base64, "base64");
    const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPages = srcDoc.getPageCount();
    
    const pageIndices = pages
      .map(p => p - 1)
      .filter(i => i >= 0 && i < totalPages)
      .sort((a, b) => a - b);

    if (pageIndices.length === 0) return res.status(400).json({ error: "No valid pages" });

    const extractedDoc = await PDFDocument.create();
    const copiedPages = await extractedDoc.copyPages(srcDoc, pageIndices);
    copiedPages.forEach(p => extractedDoc.addPage(p));
    
    const extractedBytes = await extractedDoc.save();
    res.json({
      base64: Buffer.from(extractedBytes).toString("base64"),
      pagesExtracted: pageIndices.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── R2 STORAGE ENDPOINTS ──────────────────────────────────────────────────────
app.get("/api/vaults", async (req, res) => {
  try {
    const data = await r2.send(new ListObjectsV2Command({ Bucket: BUCKET, Delimiter: "/" }));
    const vaults = (data.CommonPrefixes || []).map(p => p.Prefix.replace("/", ""));
    res.json(vaults);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/vaults/:id", async (req, res) => {
  try {
    const data = await r2.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${req.params.id}/` }));
    const files = (data.Contents || [])
      .filter(f => f.Key.endsWith(".pdf"))
      .map(f => ({ name: f.Key.split("/")[1], size: f.Size, key: f.Key }));
    res.json(files);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/vaults/:id/upload", async (req, res) => {
  const { name, base64 } = req.body;
  try {
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${req.params.id}/${name}`,
      Body: Buffer.from(base64, "base64"),
      ContentType: "application/pdf"
    }));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/vaults/:id/index", async (req, res) => {
  try {
    const data = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${req.params.id}/.index.json` }));
    const body = await streamToBuffer(data.Body);
    res.json(JSON.parse(body.toString()));
  } catch (err) { res.json({ headings: [] }); }
});

app.post("/api/vaults/:id/index", async (req, res) => {
  try {
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${req.params.id}/.index.json`,
      Body: JSON.stringify(req.body),
      ContentType: "application/json"
    }));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
