// Archimind server
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { serverError } = require("./helpers/serverError");
const { requireAuth } = require("./middleware/auth");
const { rateLimit } = require("./middleware/rateLimit");
const { reminderTick, hrReportTick } = require("./helpers/schedulers");

const app = express();

const corsOptions = {
  origin: [
    "https://archimind.co.uk",
    "https://www.archimind.co.uk",
    "https://archimind.vercel.app",
    "https://archimind-omega.vercel.app",
    "https://archimind-git-develop-nathan-greens-projects-192281d0.vercel.app"
  ],
  credentials: true,
  exposedHeaders: ["X-Schedule-Added", "X-Schedule-Changed", "X-Schedule-Removed", "X-Schedule-Rows"],
};

// CORS must run before Helmet so preflight OPTIONS requests are handled first
app.options("*", cors(corsOptions));
app.use(cors(corsOptions));
app.use(helmet({ crossOriginResourcePolicy: false }));

app.use(express.json({ limit: "100mb" }));

// Extend timeout to 5 minutes to handle large Gemini requests
app.use((req, res, next) => {
  res.setTimeout(300000);
  next();
});




// Gemini AI proxy route
app.post("/api/claude", requireAuth, rateLimit(20, 60_000), async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY not set." });

  try {
    const { model, max_tokens, system, messages, temperature, thinking } = req.body;
    const ALLOWED_MODELS = new Set(["gemini-2.5-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash"]);
    const requestedModel = (model && ALLOWED_MODELS.has(model)) ? model : "gemini-2.5-flash";

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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.error("Gemini request aborted — exceeded 4 minute timeout");
    }, 240000);

    let response;
    let payloadMB = "?";
    try {
      const generationConfig = {
        maxOutputTokens: max_tokens || 65000,
        temperature: temperature !== undefined ? temperature : 0.1,
      };
      if (thinking === false) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }

      const payload = JSON.stringify({ contents, generationConfig });
      payloadMB = (Buffer.byteLength(payload) / 1048576).toFixed(1);
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: controller.signal,
        body: payload,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Gemini error (payload ${payloadMB} MB):`, errText);
      return res.status(502).json({ error: "AI service error — please try again." });
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
    return serverError(res, err, req.path);
  }
});

app.use(require("./routes/vaults"));

app.use(require("./routes/products"));

app.use(require("./routes/projects"));
app.use(require("./routes/projectsAi"));

app.use(require("./routes/admin"));

app.use(require("./routes/taskBoard"));

app.use(require("./routes/timesheets"));

app.use(require("./routes/expenses"));

// ── Vault question history ────────────────────────────────────────────────────
app.use(require("./routes/vaultHistory"));

app.use(require("./routes/quiz"));

app.use(require("./routes/sharedAnswers"));

app.get("/health", (req, res) => res.json({ status: "ok" }));

// ── Schedule Types ─────────────────────────────────────────────────────────────

app.use(require("./routes/schedule"));

app.get("*", (req, res) => res.status(404).json({ error: "Not found" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Archimind server running on port ${PORT}`));
setInterval(reminderTick, 15 * 60 * 1000);
setInterval(hrReportTick, 15 * 60 * 1000);

