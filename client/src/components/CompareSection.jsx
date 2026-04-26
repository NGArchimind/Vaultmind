import { useState, useRef } from "react";
import { api, callClaude, fileToBase64 } from "../api/client";
import AnswerRenderer from "./common/AnswerRenderer";
import { Spinner, ProgressBar } from "./common/Spinner";
import { AD_GREEN, AD_GREEN_MID, ARC_NAVY, ARC_TERRACOTTA } from "../constants";

export default function CompareSection({ vaults, isAdmin }) {
  const [docA, setDocA] = useState(null);
  const [docB, setDocB] = useState(null);
  const [dragOverA, setDragOverA] = useState(false);
  const [dragOverB, setDragOverB] = useState(false);
  const [compareStatus, setCompareStatus] = useState("");
  const [compareRunning, setCompareRunning] = useState(false);
  const [compareAnswer, setCompareAnswer] = useState(null);
  const [compareHistory, setCompareHistory] = useState([]);
  const [followUp, setFollowUp] = useState("");

  const [showVaultPicker, setShowVaultPicker] = useState(false);
  const [selectedVaultId, setSelectedVaultId] = useState("");
  const [complianceRunning, setComplianceRunning] = useState(false);
  const [complianceStatus, setComplianceStatus] = useState("");
  const [complianceProgress, setComplianceProgress] = useState({ select: 0, read: 0, answer: 0 });
  const [complianceAnswer, setComplianceAnswer] = useState(null);

  const [suggestedQuestions, setSuggestedQuestions] = useState([]);
  const [selectedQuestion, setSelectedQuestion] = useState("");
  const [questionsLoading, setQuestionsLoading] = useState(false);

  const inputARef = useRef();
  const inputBRef = useRef();

  const loadDoc = async (file, setter) => {
    if (!file || file.type !== "application/pdf") return;
    const base64 = await fileToBase64(file);
    setter({ name: file.name, base64 });
  };

  // ── Initial comparison ────────────────────────────────────────────────────────
  const runComparison = async () => {
    if (!docA || !docB) return;
    setCompareRunning(true);
    setCompareAnswer(null);
    setCompareHistory([]);
    setComplianceAnswer(null);
    setComplianceStatus("");
    setShowVaultPicker(false);
    setSuggestedQuestions([]);
    setSelectedQuestion("");
    setSelectedVaultId("");
    setQuestionsLoading(false);
    setCompareStatus("Analysing both documents…");

    const promptA = `You are a technical product comparison specialist. High-density technical analysis only, no fluff.

PRODUCTS BEING COMPARED:
[CONTEXT]

Respond with ONLY these two sections:

## Overview
One sentence per product — what it is, who makes it, and its primary purpose.

## Specifications
A table of all quantifiable properties. Only include rows where a value exists for at least one product.
Table formatting rules: use exactly one space either side of each pipe. Separator row uses exactly three hyphens per column. No extra spaces for alignment.

| Property | ${docA.name.replace(".pdf", "")} | ${docB.name.replace(".pdf", "")} |
|---|---|---|

Include: dimensions, thickness options, fire ratings, density, thermal conductivity, weight, compliance standards, edge types, colour, and any other measurable specification.`;

    const promptB = `You are a technical product comparison specialist. High-density technical analysis only, no fluff.

PRODUCTS BEING COMPARED:
[CONTEXT]

Respond with ONLY these two sections:

## Key Differences
An analysis of the most significant differences between the two products — what they mean in practice for a specifier or designer. Focus on performance, application suitability, and installation. Do not repeat specifications — interpret and analyse. 4–6 paragraphs maximum, each focused on one key area of difference.

## Specifier Notes
Concise guidance on when to use each product. Include scenarios where one is clearly more suitable than the other, and any limitations or restrictions to be aware of.`;

    const COMPARE_OPTIONS = { temperature: 0.7, thinking: false };
    const COMPARE_SYSTEM = "You are a technical product comparison specialist. Provide high-density technical analysis without fluff.";

    try {
      setCompareStatus("Extracting document content…");
      const [extractA, extractB] = await Promise.all([
        api("/api/extract-text", { method: "POST", body: { base64: docA.base64 } }).catch(() => ({ hasText: false, text: "" })),
        api("/api/extract-text", { method: "POST", body: { base64: docB.base64 } }).catch(() => ({ hasText: false, text: "" })),
      ]);

      const useTextA = extractA.hasText;
      const useTextB = extractB.hasText;

      docA.extractedText = extractA.text || "";
      docB.extractedText = extractB.text || "";

      const MIN_CHARS = 200;
      const thinA = useTextA && extractA.text.replace(/\s/g, "").length < MIN_CHARS;
      const thinB = useTextB && extractB.text.replace(/\s/g, "").length < MIN_CHARS;

      if (!useTextA || !useTextB || thinA || thinB) {
        const failedDocs = [
          (!useTextA || thinA) && docA.name,
          (!useTextB || thinB) && docB.name,
        ].filter(Boolean).join(" and ");
        setCompareStatus(`Unable to extract sufficient text from ${failedDocs}. This document may be image-based or scanned with no text layer — try printing to PDF first to embed a text layer, then re-upload.`);
        setCompareRunning(false);
        return;
      }

      const combinedContext = `DOCUMENT A: ${docA.name}\n\n${extractA.text}\n\n---\n\nDOCUMENT B: ${docB.name}\n\n${extractB.text}`;
      const contentA = [{ type: "text", text: promptA.replace("[CONTEXT]", combinedContext) }];
      const contentB = [{ type: "text", text: promptB.replace("[CONTEXT]", combinedContext) }];

      setCompareStatus("Analysing both documents…");
      const [resultA, resultB] = await Promise.all([
        callClaude([{ role: "user", content: contentA }], COMPARE_SYSTEM, 8000, 2, "gemini-2.5-flash", 240000, COMPARE_OPTIONS),
        callClaude([{ role: "user", content: contentB }], COMPARE_SYSTEM, 8000, 2, "gemini-2.5-flash", 240000, COMPARE_OPTIONS),
      ]);

      const text = `${resultA.text}\n\n${resultB.text}`;
      setCompareAnswer(text);
      setCompareHistory([{ role: "user", content: `Compare ${docA.name} and ${docB.name}`, isInitial: true }, { role: "assistant", content: text }]);
      setCompareStatus("Comparison complete.");

      // Silently save both datasheets to the library
      (async () => {
        try {
          const { products: existing } = await api("/api/products");
          const existingKeys = new Set((existing || []).map(p => p.file_key));

          for (const doc of [docA, docB]) {
            const isDuplicate = [...existingKeys].some(k => k && k.endsWith(doc.name.replace(/[^a-zA-Z0-9._-]/g, "_")));
            if (isDuplicate) continue;

            let fileKey = doc.name;
            try {
              const uploadResult = await api("/api/products/upload-pdf", { method: "POST", body: { base64: doc.base64, filename: doc.name } });
              fileKey = uploadResult.key;
            } catch (_) {}

            const extractionPrompt = `You are a technical product data specialist. Extract ALL meaningful technical attributes from this product datasheet.

Return ONLY a JSON object in this exact format — no preamble, no markdown:
{
  "name": "Full product name",
  "manufacturer": "Manufacturer name",
  "attributes": [
    { "attribute": "Attribute name", "value": "Value", "unit": "Unit or null" }
  ]
}

Extract every relevant technical attribute you can find: dimensions, weights, thermal values, fire ratings, acoustic ratings, compressive strength, standards compliance, application temperature ranges, finishes, colours, certifications, installation requirements — anything technical and specific. Do not include marketing language. If a value has a unit, separate it into the unit field.`;

            const result = await callClaude(
              [{ role: "user", content: [
                { type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.base64 } },
                { type: "text", text: extractionPrompt }
              ]}],
              null, 4000, 1, "gemini-2.5-flash", 120000, { temperature: 0.1, thinking: false }
            );

            try {
              const resultText = result.text || "";
              const first = resultText.indexOf("{");
              const last = resultText.lastIndexOf("}");
              if (first === -1 || last === -1) throw new Error("No JSON object found");
              const clean = resultText.slice(first, last + 1);
              const parsed = JSON.parse(clean);
              await api("/api/products", {
                method: "POST",
                body: {
                  name: parsed.name || doc.name.replace(".pdf", ""),
                  manufacturer: parsed.manufacturer || null,
                  file_key: fileKey,
                  raw_text: doc.extractedText || "",
                  attributes: parsed.attributes || [],
                }
              });
            } catch (_) {}
          }
        } catch (_) {}
      })();

      // Auto-generate suggested compliance questions
      setQuestionsLoading(true);
      setSuggestedQuestions([]);
      setSelectedQuestion("");
      try {
        const questionPrompt = `Based on the following product comparison, generate exactly 3 specific compliance question suggestions that a building regulations specialist might want to check against regulatory documents.

COMPARISON:
${text.slice(0, 1500)}

Rules:
- Each question must be specific to these exact products and their key differences
- Each question must reference a specific aspect of compliance (fire performance, installation, structural, etc.)
- Questions should be different from each other — cover different aspects
- Keep each question to one sentence
- Do not number them

Return ONLY a JSON array of 3 strings, no other text:
["question 1", "question 2", "question 3"]`;

        const { text: qText } = await callClaude(
          [{ role: "user", content: questionPrompt }],
          "You are a building regulations specialist. Return pure JSON only.",
          1000, 1, "gemini-2.5-flash-lite"
        );
        const clean = qText.replace(/```json|```/g, "").trim();
        const questions = JSON.parse(clean);
        if (Array.isArray(questions) && questions.length > 0) {
          setSuggestedQuestions(questions);
          setSelectedQuestion(questions[0]);
        }
      } catch (e) {
        console.warn("Failed to generate suggested questions:", e.message);
      }
      setQuestionsLoading(false);
    } catch (e) {
      setCompareStatus("Error: " + e.message);
    }
    setCompareRunning(false);
  };

  // ── Follow-up question ────────────────────────────────────────────────────────
  const askFollowUp = async () => {
    if (!followUp.trim() || compareRunning) return;
    const q = followUp.trim();
    setFollowUp("");
    setCompareRunning(true);
    setCompareStatus("Thinking…");

    const historyMessages = compareHistory.map(h => ({
      role: h.role,
      content: h.isInitial
        ? [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: docA.base64 }, title: docA.name },
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: docB.base64 }, title: docB.name },
            { type: "text", text: `Compare these two documents in detail.` }
          ]
        : h.content
    }));

    const messages = [...historyMessages, { role: "user", content: q }];

    try {
      const { text } = await callClaude(
        messages,
        "You are a technical product comparison specialist. You are continuing a conversation about two documents the user has uploaded. Be specific, use tables where helpful.",
        65000, 2, "gemini-2.5-flash", 240000
      );
      setCompareAnswer(text);
      setCompareHistory(prev => [...prev, { role: "user", content: q }, { role: "assistant", content: text }]);
      setCompareStatus("Answer ready.");
    } catch (e) {
      setCompareStatus("Error: " + e.message);
    }
    setCompareRunning(false);
  };

  // ── Compliance check ──────────────────────────────────────────────────────────
  const runComplianceCheck = async () => {
    if (!selectedVaultId || !compareAnswer) return;
    setShowVaultPicker(false);
    setComplianceRunning(true);
    setComplianceAnswer(null);
    setComplianceProgress({ select: 0, read: 0, answer: 0 });

    const complianceQuestion = selectedQuestion || `Are these products compliant with the relevant requirements in this vault?`;

    try {
      const vaultObj = (() => {
        for (const v of vaults) {
          if (v.id === selectedVaultId) return v;
          if (v.type === "master") {
            const sub = (v.subVaults || []).find(sv => sv.id === selectedVaultId);
            if (sub) return sub;
          }
        }
        return null;
      })();
      if (!vaultObj) throw new Error("Vault not found");

      let vaultIndex = null;
      try { vaultIndex = await api(`/api/vaults/${encodeURIComponent(selectedVaultId)}/index`); } catch (_) {}
      if (!vaultIndex?.documents?.length) {
        setComplianceStatus("Vault has no index — please index this vault first.");
        setComplianceRunning(false);
        return;
      }

      // Pass 1: Score index
      setComplianceStatus(`Pass 1/3 · Scoring index…`);
      setComplianceProgress({ select: 20, read: 0, answer: 0 });

      const BOILERPLATE_HEADINGS = [
        "the approved documents", "what is an approved document", "approved documents",
        "list of approved documents", "use of guidance", "how to use this approved document",
        "other guidance", "the building regulations", "online version", "hm government",
        "main changes", "approved document", "list of approved documents"
      ];
      const isBoilerplate = (title) => {
        const t = title.toLowerCase().trim();
        return BOILERPLATE_HEADINGS.some(b => t === b || t === b + "s");
      };

      const indexSummary = (vaultIndex.documents || []).map(doc => {
        const pageFrequency = {};
        (doc.headings || []).forEach(h => {
          const p = h.pageHint || 1;
          pageFrequency[p] = (pageFrequency[p] || 0) + 1;
        });
        const crowdedPages = new Set(
          Object.entries(pageFrequency).filter(([, count]) => count > 8).map(([page]) => Number(page))
        );
        const headings = (doc.headings || [])
          .filter(h => !isBoilerplate(h.title))
          .filter(h => !crowdedPages.has(h.pageHint))
          .map(h => `  p${h.pageHint || 1}: ${h.title}`)
          .join("\n");
        return `DOCUMENT: ${doc.name}\n${headings}`;
      }).join("\n\n");

      const productContext = `Products being assessed:\n- ${docA.name.replace(".pdf","")}\n- ${docB.name.replace(".pdf","")}\n\nKey differences:\n${compareAnswer.slice(0, 600)}`;

      const scoringPrompt = `You are a technical document analyst. Using ONLY the index below, identify sections most likely to contain requirements relevant to this compliance question.

DOCUMENT INDEX:
${indexSummary}

COMPLIANCE QUESTION: ${complianceQuestion}

PRODUCT CONTEXT:
${productContext}

Return ONLY compact JSON:
{"selectedDocs":[{"docName":"exact filename","sections":[{"heading":"exact heading","pageHint":42,"probability":0.95}]}]}

Rules: probability > 0.5 only, pageHint must be integer, pure JSON only.`;

      let scoring = { selectedDocs: [] };
      try {
        const { text: scoringText } = await callClaude(
          [{ role: "user", content: scoringPrompt }],
          "You are a technical document analyst. Return pure JSON only.",
          8000, 2, "gemini-2.5-flash-lite"
        );
        const clean = scoringText.replace(/\`\`\`json|\`\`\`/g, "").trim();
        try { scoring = JSON.parse(clean); }
        catch { const m = clean.match(/\{[\s\S]*\}/); if (m) try { scoring = JSON.parse(m[0]); } catch {} }
      } catch (e) { console.warn("Compliance scoring failed:", e); }

      setComplianceProgress({ select: 100, read: 20, answer: 0 });

      // Pass 2: Extract pages
      setComplianceStatus(`Pass 2/3 · Extracting relevant pages…`);

      let pdfsInVault = [];
      try {
        const pdfsData = await api(`/api/vaults/${encodeURIComponent(selectedVaultId)}/pdfs`);
        pdfsInVault = pdfsData.pdfs || [];
      } catch (_) {}

      const selectedDocNames = (scoring.selectedDocs || []).map(d => d.docName);
      const contentsData = [];

      for (const docName of selectedDocNames) {
        const matchedPdf = pdfsInVault.find(p =>
          p.name === docName || p.name.includes(docName) || docName.includes(p.name)
        );
        if (!matchedPdf) continue;
        try {
          const pdfData = await api(`/api/vaults/${encodeURIComponent(selectedVaultId)}/pdfs/${encodeURIComponent(matchedPdf.name)}`);
          contentsData.push({ pdf: matchedPdf, base64: pdfData.base64 });
        } catch (_) {}
      }

      if (contentsData.length === 0 && pdfsInVault.length > 0) {
        for (const pdf of pdfsInVault.slice(0, 2)) {
          try {
            const pdfData = await api(`/api/vaults/${encodeURIComponent(selectedVaultId)}/pdfs/${encodeURIComponent(pdf.name)}`);
            contentsData.push({ pdf, base64: pdfData.base64 });
          } catch (_) {}
        }
      }

      const docPageMap = {};
      const HARD_PAGE_BUDGET = 60;
      let budgetRemaining = HARD_PAGE_BUDGET;

      (scoring.selectedDocs || []).forEach(selectedDoc => {
        const matchedDoc = contentsData.find(d =>
          d.pdf.name.includes(selectedDoc.docName) || selectedDoc.docName.includes(d.pdf.name)
        );
        if (!matchedDoc) return;
        (selectedDoc.sections || []).sort((a, b) => (b.probability || 0) - (a.probability || 0)).forEach(section => {
          if (budgetRemaining <= 0) return;
          const pageHint = typeof section.pageHint === "number" ? section.pageHint : parseInt(String(section.pageHint)) || 1;
          const key = matchedDoc.pdf.name;
          if (!docPageMap[key]) docPageMap[key] = { contentsDoc: matchedDoc, pages: new Set() };
          [0, 1].forEach(offset => {
            const pg = pageHint + offset;
            if (pg > 0 && !docPageMap[key].pages.has(pg) && budgetRemaining > 0) {
              docPageMap[key].pages.add(pg);
              budgetRemaining--;
            }
          });
        });
      });

      if (Object.keys(docPageMap).length === 0 && contentsData.length > 0) {
        contentsData.slice(0, 2).forEach(d => {
          docPageMap[d.pdf.name] = { contentsDoc: d, pages: new Set([1, 2, 3, 4, 5]) };
        });
      }

      const docBlocks = [];
      for (const [docName, { contentsDoc, pages }] of Object.entries(docPageMap)) {
        const pageList = Array.from(pages).sort((a, b) => a - b);
        if (pageList.length === 0) continue;
        try {
          const result = await api("/api/extract-pages", {
            method: "POST",
            body: { base64: contentsDoc.base64, pages: pageList }
          });
          docBlocks.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: result.base64 },
            title: `${docName} — pages ${result.pageNumbers.join(", ")}`,
          });
        } catch (_) {}
      }

      setComplianceProgress({ select: 100, read: 100, answer: 20 });

      if (docBlocks.length === 0) {
        setComplianceStatus("Could not extract relevant pages from this vault.");
        setComplianceRunning(false);
        return;
      }

      // Pass 3: Compliance synthesis
      setComplianceStatus(`Pass 3/3 · Assessing compliance…`);

      const compliancePrompt = `You are an expert building regulations consultant assessing two products for compliance against the provided regulatory documents.

PRODUCTS: ${docA.name.replace(".pdf","")} vs ${docB.name.replace(".pdf","")}
COMPLIANCE QUESTION: ${complianceQuestion}

KEY PRODUCT DIFFERENCES:
${compareAnswer.slice(0, 800)}

Using ONLY the provided document pages, produce a focused compliance assessment structured as follows:

## Compliance Assessment — ${vaultObj.name}

### Verdict
A short paragraph for each product stating whether it appears compliant, non-compliant, or where compliance is uncertain — and the primary reason why. Reference the specific requirement that determines this.

### Key Requirements
A table mapping the most relevant regulatory requirements to each product:

| Requirement | ${docA.name.replace(".pdf", "")} | ${docB.name.replace(".pdf", "")} |
|---|---|---|

### Compliance Analysis
3–5 focused paragraphs covering the most important compliance points. For each point: state the requirement, assess both products against it, and note any differences in how they comply or fail to comply. Do not repeat the table — analyse and interpret.

### Concerns & Gaps
Any specific non-compliances, limitations, or areas where further evidence is needed before compliance can be confirmed. Be precise — quote the requirement and explain the gap. If none, state "No concerns identified."

### Regulatory References
Key clauses cited in this assessment.
*Document | Clause title*

Use only the provided document pages. Do not speculate beyond what the documents state.`;

      try {
        const { text: complianceText } = await callClaude(
          [{ role: "user", content: [...docBlocks, { type: "text", text: compliancePrompt }] }],
          "You are a building regulations consultant. Be concise and direct. Use only the provided document pages.",
          65536, 2, "gemini-2.5-flash"
        );
        setComplianceAnswer(complianceText);
        setComplianceStatus("Compliance check complete.");
      } catch (e) {
        setComplianceStatus("Error: " + e.message);
      }

      setComplianceProgress({ select: 100, read: 100, answer: 100 });
    } catch (e) {
      setComplianceStatus("Error: " + e.message);
    }
    setComplianceRunning(false);
  };

  // ── Vault options ─────────────────────────────────────────────────────────────
  const vaultOptions = [];
  vaults.forEach(v => {
    if (v.type === "master") {
      (v.subVaults || []).forEach(sv => {
        vaultOptions.push({ id: sv.id, name: `${v.name} / ${sv.name}` });
      });
    } else {
      vaultOptions.push({ id: v.id, name: v.name });
    }
  });

  const DropZone = ({ doc, setDoc, label, dragOver, setDragOver, inputRef }) => (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      {doc ? (
        <div style={{ border: `1px solid ${AD_GREEN}`, background: "#f0f5f6", padding: "20px 24px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 24 }}>📄</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: ARC_NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
            <div style={{ fontSize: 11, color: AD_GREEN, marginTop: 2 }}>Ready</div>
          </div>
          <button className="btn" onClick={() => setDoc(null)}
            style={{ background: "none", color: "#9a9088", fontSize: 18, padding: "0 4px", fontWeight: 700, lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>
      ) : (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) loadDoc(f, setDoc); }}
          onClick={() => inputRef.current.click()}
          style={{
            border: `2px dashed ${dragOver ? AD_GREEN : "#c8c0b8"}`,
            padding: "40px 24px", textAlign: "center", cursor: "pointer",
            background: dragOver ? "#f0f5f6" : "#faf8f5", transition: "all 0.2s",
          }}>
          <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.4 }}>📄</div>
          <p style={{ fontSize: 13, color: ARC_NAVY, fontWeight: 500, marginBottom: 4 }}>Drop PDF here</p>
          <p style={{ fontSize: 11, color: "#9a9088" }}>or click to browse</p>
          <input ref={inputRef} type="file" accept="application/pdf" style={{ display: "none" }}
            onChange={e => { if (e.target.files[0]) loadDoc(e.target.files[0], setDoc); }} />
        </div>
      )}
    </div>
  );

  const chatHistory = compareHistory.filter(h => !h.isInitial && h.role === "user");

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#faf8f5" }}>

      {/* Header */}
      <div style={{ background: "#ffffff", borderBottom: "1px solid #e8e0d5", padding: "20px 32px", flexShrink: 0 }}>
        <h1 style={{ fontSize: 22, fontWeight: 300, color: ARC_NAVY, letterSpacing: "0.01em", fontFamily: "Inter, Arial, sans-serif" }}>Compare</h1>
        <p style={{ fontSize: 11, color: "#9a9088", marginTop: 4, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Upload two documents to compare — then check against your vaults for compliance
        </p>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>

        {/* Upload zone */}
        <div style={{ display: "flex", gap: 20, marginBottom: 24 }}>
          <DropZone doc={docA} setDoc={setDocA} label="Document A" dragOver={dragOverA} setDragOver={setDragOverA} inputRef={inputARef} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, flexShrink: 0 }}>
            <span style={{ fontSize: 20, color: "#c8c0b8" }}>vs</span>
          </div>
          <DropZone doc={docB} setDoc={setDocB} label="Document B" dragOver={dragOverB} setDragOver={setDragOverB} inputRef={inputBRef} />
        </div>

        {/* Compare button */}
        {docA && docB && !compareAnswer && (
          <div style={{ marginBottom: 24 }}>
            <button className="btn" onClick={runComparison} disabled={compareRunning}
              style={{ background: compareRunning ? "#c8c0b8" : ARC_NAVY, color: "#ffffff", padding: "12px 32px", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 10 }}>
              {compareRunning ? <><Spinner size={14} /> Comparing…</> : "Compare Documents"}
            </button>
          </div>
        )}

        {/* Status */}
        {compareStatus && (
          <div style={{ marginBottom: 16, fontSize: 12, color: "#505a5f", display: "flex", alignItems: "center", gap: 8 }}>
            {compareRunning && <Spinner size={12} />}
            <span>{compareStatus}</span>
          </div>
        )}

        {/* Chat history */}
        {chatHistory.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {chatHistory.map((h, i) => (
              <div key={i} style={{ fontSize: 13, color: "#505a5f", background: "#ffffff", border: "1px solid #b1b4b6", padding: "8px 14px", marginBottom: 6, display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ color: AD_GREEN, fontWeight: 700, flexShrink: 0 }}>Q:</span>
                <span style={{ flex: 1 }}>{h.content}</span>
              </div>
            ))}
          </div>
        )}

        {/* Comparison answer */}
        {compareAnswer && (
          <div style={{ animation: "fadeIn 0.4s ease", marginBottom: 24 }}>
            <div style={{ background: "#ffffff", border: "1px solid #b1b4b6", borderTop: `4px solid ${AD_GREEN}`, padding: "24px 28px", marginBottom: 16 }}>
              <p style={{ fontSize: 12, color: "#505a5f", marginBottom: 16, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Comparison — {docA.name.replace(".pdf", "")} vs {docB.name.replace(".pdf", "")}
              </p>
              <AnswerRenderer text={compareAnswer} />
            </div>

            {/* Follow-up input */}
            {!compareRunning && (
              <div style={{ background: "#ffffff", border: "1px solid #e8e0d5", padding: "16px 20px", marginBottom: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Ask a follow-up question</div>
                <div style={{ display: "flex", gap: 0 }}>
                  <textarea value={followUp} onChange={e => setFollowUp(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askFollowUp(); } }}
                    placeholder="e.g. What are the fire performance differences between the two products?"
                    rows={2} className="arc-input"
                    style={{ flex: 1, border: `1px solid #ddd8d0`, borderRight: "none", padding: "10px 14px", fontSize: 13, color: ARC_NAVY, outline: "none", resize: "none", lineHeight: 1.6, fontFamily: "Inter, Arial, sans-serif" }} />
                  <button className="btn" onClick={askFollowUp} disabled={!followUp.trim()}
                    style={{ background: followUp.trim() ? ARC_NAVY : "#f0ede8", color: followUp.trim() ? "#ffffff" : "#9a9088", padding: "0 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", border: `1px solid ${followUp.trim() ? ARC_NAVY : "#ddd8d0"}`, minWidth: 80 }}>
                    Ask
                  </button>
                </div>
              </div>
            )}

            {/* Vault compliance check */}
            {!complianceRunning && !complianceAnswer && (
              <div style={{ marginBottom: 20 }}>
                {!showVaultPicker ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <button className="btn" onClick={() => setShowVaultPicker(true)}
                      style={{ background: ARC_TERRACOTTA, color: "#ffffff", padding: "12px 28px", fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 8 }}>
                      🔍 Check Compliance Against Vaults
                    </button>
                    {questionsLoading && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#9a9088" }}>
                        <Spinner size={11} /> Generating compliance questions…
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ background: "#ffffff", border: `1px solid #e8e0d5`, borderLeft: `3px solid ${ARC_TERRACOTTA}`, padding: "20px 24px" }}>

                    {/* Suggested questions */}
                    {suggestedQuestions.length > 0 && (
                      <div style={{ marginBottom: 20 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: ARC_NAVY, marginBottom: 4 }}>Select a compliance question</div>
                        <p style={{ fontSize: 11, color: "#9a9088", marginBottom: 12, lineHeight: 1.6 }}>
                          Choose one of the suggested questions or write your own below.
                        </p>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                          {suggestedQuestions.map((q, i) => (
                            <label key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "10px 14px", background: selectedQuestion === q ? "#f0f5f6" : "transparent", border: `1px solid ${selectedQuestion === q ? AD_GREEN : "#e8e0d5"}`, transition: "all 0.15s" }}>
                              <input type="radio" name="complianceQ" checked={selectedQuestion === q} onChange={() => setSelectedQuestion(q)}
                                style={{ accentColor: AD_GREEN, marginTop: 2, flexShrink: 0 }} />
                              <span style={{ fontSize: 12, color: ARC_NAVY, lineHeight: 1.6 }}>{q}</span>
                            </label>
                          ))}
                          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "10px 14px", background: !suggestedQuestions.includes(selectedQuestion) ? "#f0f5f6" : "transparent", border: `1px solid ${!suggestedQuestions.includes(selectedQuestion) ? AD_GREEN : "#e8e0d5"}`, transition: "all 0.15s" }}>
                            <input type="radio" name="complianceQ" checked={!suggestedQuestions.includes(selectedQuestion)} onChange={() => setSelectedQuestion("")}
                              style={{ accentColor: AD_GREEN, marginTop: 2, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: "#9a9088", lineHeight: 1.6 }}>Write my own question…</span>
                          </label>
                        </div>
                        {!suggestedQuestions.includes(selectedQuestion) && (
                          <textarea value={selectedQuestion} onChange={e => setSelectedQuestion(e.target.value)}
                            placeholder="Type your compliance question here…"
                            rows={2} className="arc-input"
                            style={{ width: "100%", border: `1px solid #ddd8d0`, padding: "10px 14px", fontSize: 12, color: ARC_NAVY, outline: "none", resize: "none", lineHeight: 1.6, fontFamily: "Inter, Arial, sans-serif", marginBottom: 12 }} />
                        )}
                      </div>
                    )}

                    {/* Vault picker */}
                    <div style={{ fontSize: 12, fontWeight: 600, color: ARC_NAVY, marginBottom: 4 }}>Select a vault to check against</div>
                    <p style={{ fontSize: 11, color: "#9a9088", marginBottom: 12, lineHeight: 1.6 }}>Only indexed vaults can be used.</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16, maxHeight: 200, overflowY: "auto" }}>
                      {vaultOptions.length === 0 && (
                        <p style={{ fontSize: 12, color: "#9a9088", fontStyle: "italic" }}>No vaults available.</p>
                      )}
                      {vaultOptions.map(v => (
                        <label key={v.id} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "8px 12px", background: selectedVaultId === v.id ? "#f0f5f6" : "transparent", border: `1px solid ${selectedVaultId === v.id ? AD_GREEN : "#e8e0d5"}` }}>
                          <input type="radio" name="vaultSelect" checked={selectedVaultId === v.id} onChange={() => setSelectedVaultId(v.id)}
                            style={{ accentColor: AD_GREEN }} />
                          <span style={{ fontSize: 13, color: ARC_NAVY }}>{v.name}</span>
                        </label>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button className="btn" onClick={runComplianceCheck} disabled={!selectedVaultId || !selectedQuestion.trim()}
                        style={{ background: selectedVaultId && selectedQuestion.trim() ? ARC_TERRACOTTA : "#c8c0b8", color: "#ffffff", padding: "10px 24px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                        Run Compliance Check
                      </button>
                      <button className="btn" onClick={() => setShowVaultPicker(false)}
                        style={{ background: "transparent", color: "#9a9088", padding: "10px 16px", fontSize: 11, border: "1px solid #ccc" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Compliance running */}
            {complianceRunning && (
              <div style={{ background: "#ffffff", border: "1px solid #e8e0d5", padding: "20px 24px", marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: ARC_NAVY, marginBottom: 12, display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
                  <Spinner size={12} /> {complianceStatus}
                </div>
                <ProgressBar label="Pass 1 · Index scoring" pct={complianceProgress.select} color={AD_GREEN} />
                <ProgressBar label="Pass 2 · Page extraction" pct={complianceProgress.read} color={ARC_TERRACOTTA} />
                <ProgressBar label="Pass 3 · Compliance synthesis" pct={complianceProgress.answer} color={ARC_NAVY} />
              </div>
            )}

            {/* Compliance answer */}
            {complianceAnswer && (
              <div style={{ animation: "fadeIn 0.4s ease" }}>
                <div style={{ background: "#ffffff", border: "1px solid #b1b4b6", borderTop: `4px solid ${ARC_TERRACOTTA}`, padding: "24px 28px", marginBottom: 12 }}>
                  <p style={{ fontSize: 12, color: "#505a5f", marginBottom: 16, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Compliance Assessment
                  </p>
                  <AnswerRenderer text={complianceAnswer} />
                </div>
                <button className="btn" onClick={() => { setComplianceAnswer(null); setComplianceStatus(""); setSelectedVaultId(""); setShowVaultPicker(true); }}
                  style={{ background: "transparent", color: AD_GREEN, padding: "8px 0", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", border: "none", textDecoration: "underline" }}>
                  Check against different vaults
                </button>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!docA && !docB && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", gap: 10 }}>
            <div style={{ width: 32, height: 2, background: ARC_TERRACOTTA }} />
            <p style={{ fontSize: 16, color: ARC_NAVY, fontWeight: 300, letterSpacing: "0.02em" }}>Upload two documents to compare</p>
            <p style={{ fontSize: 11, color: "#9a9088", letterSpacing: "0.03em" }}>Product datasheets, specifications, or any technical documents</p>
          </div>
        )}
      </div>
    </div>
  );
}
