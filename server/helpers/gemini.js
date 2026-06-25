// Gemini helpers for drawing text extraction + embeddings (used by the project
// drawings indexing path). Pipeline-adjacent: logic is verbatim from index.js —
// do not change the request shape without a live staging test.
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { r2, BUCKET, supabase } = require("./clients");
const { streamToBuffer } = require("./r2");

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

async function geminiExtractDrawingText(pdfBuffer) {
  const response = await fetch(`${GEMINI_BASE}/gemini-2.5-flash:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: "application/pdf", data: pdfBuffer.toString("base64") } },
        { text: "Extract all text content from this architectural drawing. Include room names, space labels, material callouts, specifications, notes, legends, schedules, and annotations. Skip all dimensions, grid line references, and title block information (drawing number, title, revision, date, scale, status, drawn by, approved by). Return only the content text." }
      ]}],
      generationConfig: { temperature: 0 }
    })
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Gemini extract API ${response.status}: ${errText.slice(0, 200)}`);
  }
  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function geminiEmbed(text, taskType = "RETRIEVAL_DOCUMENT") {
  const response = await fetch(`${GEMINI_BASE}/gemini-embedding-001:embedContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: 768,
    })
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Gemini embed API ${response.status}: ${errText.slice(0, 200)}`);
  }
  const data = await response.json();
  return data?.embedding?.values || null;
}

async function indexDrawing(drawing) {
  console.log(`Drawing indexing start — id: ${drawing.id}, number: ${drawing.drawing_number}`);
  try {
    const result = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: drawing.file_key }));
    const buffer = await streamToBuffer(result.Body);
    const extractedText = await geminiExtractDrawingText(buffer);
    const indexText = [
      `Drawing: ${drawing.title} (${drawing.drawing_number})`,
      drawing.drawing_type && `Type: ${drawing.drawing_type}`,
      drawing.level         && `Level: ${drawing.level}`,
      drawing.volume        && `Volume: ${drawing.volume}`,
      drawing.status        && `Status: ${drawing.status}`,
      extractedText,
    ].filter(Boolean).join("\n");
    const embedding = await geminiEmbed(indexText);
    if (!embedding) { console.error(`Drawing indexing — no embedding returned for id: ${drawing.id}`); return; }
    const embeddingStr = `[${embedding.join(",")}]`;
    const { error } = await supabase.from("project_drawings").update({ embedding: embeddingStr, content_text: extractedText }).eq("id", drawing.id);
    if (error) throw new Error(error.message);
    console.log(`Drawing indexing complete — id: ${drawing.id}`);
  } catch (err) {
    console.error(`Drawing indexing error — id: ${drawing.id}, error: ${err.message}`);
  }
}

module.exports = { GEMINI_BASE, geminiExtractDrawingText, geminiEmbed, indexDrawing };
