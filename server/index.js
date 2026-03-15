const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.post("/api/claude", async (req, res) => {
  console.log("Request received at /api/claude");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    console.error("ERROR: No API key found");
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set." });
  }

  console.log("API key found, calling Anthropic...");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    console.log("Anthropic response status:", response.status);

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic error:", err);
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    console.log("Success, returning response");
    res.json(data);
  } catch (err) {
    console.error("Caught error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.get("*", (req, res) => res.status(404).json({ error: "Not found" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`VaultMind server running on port ${PORT}`));
