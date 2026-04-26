import { useState, useRef, useEffect } from "react";
import { api, callClaude, fileToBase64 } from "../api/client";
import AnswerRenderer from "./common/AnswerRenderer";
import { Spinner } from "./common/Spinner";
import { ARC_NAVY, ARC_TERRACOTTA, LIBRARY_BLUE, LIBRARY_BLUE_LIGHT } from "../constants";

export default function DatasheetsLibrarySection({ vaults, isAdmin }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [expandedAttrs, setExpandedAttrs] = useState({});
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [deleting, setDeleting] = useState(null);
  const [selected, setSelected] = useState(null);
  const [editingType, setEditingType] = useState(null);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [pendingNewType, setPendingNewType] = useState(null);
  const [showTypeManager, setShowTypeManager] = useState(false);
  const [typeManagerEdits, setTypeManagerEdits] = useState({});
  const [pendingTypeChange, setPendingTypeChange] = useState(null);
  const customTypeRef = useRef();
  const [filterManufacturer, setFilterManufacturer] = useState("");
  const [filterType, setFilterType] = useState("");
  const [downloading, setDownloading] = useState(false);

  const [complianceVaultId, setComplianceVaultId] = useState("");
  const [complianceQuestion, setComplianceQuestion] = useState("");
  const [complianceRunning, setComplianceRunning] = useState(false);
  const [complianceAnswer, setComplianceAnswer] = useState(null);
  const [complianceStatus, setComplianceStatus] = useState("");
  const [complianceProgress, setComplianceProgress] = useState({ select: 0, read: 0, answer: 0 });

  const inputRef = useRef();

  useEffect(() => { loadProducts(); }, []);

  async function loadProducts() {
    setLoading(true);
    try {
      const data = await api("/api/products");
      setProducts(data.products || []);
    } catch (e) {
      setUploadStatus("Failed to load products: " + e.message);
    }
    setLoading(false);
  }

  const manufacturers = [...new Set(products.map(p => p.manufacturer).filter(Boolean))].sort();
  const types = [...new Set(products.map(p => p.product_type).filter(Boolean))].sort();

  const filteredProducts = products.filter(p => {
    if (filterManufacturer && p.manufacturer !== filterManufacturer) return false;
    if (filterType && p.product_type !== filterType) return false;
    return true;
  });

  // ── Upload ────────────────────────────────────────────────────────────────────
  async function handleUpload(file) {
    if (!file || !file.name.endsWith(".pdf")) {
      setUploadStatus("Please upload a PDF file.");
      return;
    }
    setUploading(true);
    setUploadStatus(`Extracting text from ${file.name}…`);
    try {
      const base64 = await fileToBase64(file);

      const existing = products.find(p => p.file_key && p.file_key.endsWith(file.name.replace(/[^a-zA-Z0-9._-]/g, "_")));
      if (existing) {
        setUploadStatus(`"${file.name}" is already in the library.`);
        setUploading(false);
        return;
      }

      setUploadStatus(`Uploading ${file.name}…`);
      const uploadResult = await api("/api/products/upload-pdf", { method: "POST", body: { base64, filename: file.name } });
      const fileKey = uploadResult.key;

      const extraction = await api("/api/extract-text", { method: "POST", body: { base64 } });
      if (!extraction.hasText) {
        setUploadStatus(`Could not extract text from "${file.name}". Try printing to PDF first.`);
        setUploading(false);
        return;
      }

      setUploadStatus(`Analysing ${file.name}…`);
      const extractionPrompt = `You are a technical product data specialist. Extract ALL meaningful technical attributes from this product datasheet.

Return ONLY a JSON object in this exact format — no preamble, no markdown:
{
  "name": "Full product name",
  "manufacturer": "Manufacturer name",
  "product_type": "Inferred product category e.g. Insulation, Fire Door, Cavity Barrier, Membrane, Sealant, Fixings, Structural, Glazing, Roofing, Cladding, Flooring, Acoustic, Other",
  "attributes": [
    { "attribute": "Attribute name", "value": "Value", "unit": "Unit or null" }
  ]
}

Extract every relevant technical attribute: dimensions, weights, thermal values, fire ratings, acoustic ratings, compressive strength, standards compliance, certifications, installation requirements. No marketing language. If a value has a unit separate it into the unit field.`;

      const result = await callClaude(
        [{ role: "user", content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          { type: "text", text: extractionPrompt }
        ]}],
        null, 4000, 1, "gemini-2.5-flash", 120000, { temperature: 0.1, thinking: false }
      );
      const resultText = result.text || "";

      let parsed;
      try {
        const first = resultText.indexOf("{");
        const last = resultText.lastIndexOf("}");
        if (first === -1 || last === -1) throw new Error("No JSON object found");
        const clean = resultText.slice(first, last + 1);
        parsed = JSON.parse(clean);
      } catch {
        setUploadStatus("Failed to parse extraction result. Please try again.");
        setUploading(false);
        return;
      }

      setUploadStatus(`Saving ${parsed.name || file.name}…`);
      await api("/api/products", {
        method: "POST",
        body: {
          name: parsed.name || file.name.replace(".pdf", ""),
          manufacturer: parsed.manufacturer || null,
          product_type: parsed.product_type || null,
          file_key: fileKey,
          raw_text: extraction.text,
          attributes: parsed.attributes || [],
        }
      });

      setUploadStatus(`"${parsed.name || file.name}" added to library.`);
      await loadProducts();
    } catch (e) {
      setUploadStatus("Upload failed: " + e.message);
    }
    setUploading(false);
  }

  // ── Expand / attributes ───────────────────────────────────────────────────────
  async function loadAttributes(productId) {
    if (expandedAttrs[productId]) return;
    try {
      const data = await api(`/api/products/${productId}`);
      setExpandedAttrs(prev => ({ ...prev, [productId]: data.attributes || [] }));
    } catch (e) {
      setExpandedAttrs(prev => ({ ...prev, [productId]: [] }));
    }
  }

  async function handleExpand(productId) {
    if (expanded === productId) {
      setExpanded(null);
    } else {
      setExpanded(productId);
      await loadAttributes(productId);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────────
  async function handleDelete(product) {
    if (deleting) return;
    setDeleting(product.id);
    try {
      await api(`/api/products/${product.id}`, { method: "DELETE" });
      setProducts(prev => prev.filter(p => p.id !== product.id));
      if (expanded === product.id) setExpanded(null);
      if (selected === product.id) setSelected(null);
      setUploadStatus(`"${product.name}" removed from library.`);
    } catch (e) {
      setUploadStatus("Delete failed: " + e.message);
    }
    setDeleting(null);
  }

  // ── Download ──────────────────────────────────────────────────────────────────
  async function handleDownload() {
    if (!selected || downloading) return;
    const product = products.find(p => p.id === selected);
    if (!product?.file_key) {
      setUploadStatus("No PDF stored for this product.");
      return;
    }
    setDownloading(true);
    setUploadStatus(`Downloading ${product.name}…`);
    try {
      const data = await api(`/api/products/${product.id}/pdf`);
      const bytes = atob(data.base64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const blob = new Blob([arr], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${product.name}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setUploadStatus(`Downloaded ${product.name}.`);
    } catch (e) {
      setUploadStatus("Download failed: " + e.message);
    }
    setDownloading(false);
  }

  // ── Product type management ───────────────────────────────────────────────────
  const PRODUCT_TYPES = ["Insulation", "Fire Door", "Cavity Barrier", "Membrane", "Sealant", "Fixings", "Structural", "Glazing", "Roofing", "Cladding", "Flooring", "Acoustic", "Other"];

  async function handleTypeUpdate(product, newType) {
    if (!newType) { setEditingType(null); setShowCustomInput(false); return; }
    const isNew = !PRODUCT_TYPES.includes(newType) && !types.includes(newType);
    if (isNew) { setPendingNewType({ product, type: newType }); return; }
    await commitTypeUpdate(product, newType);
  }

  async function commitTypeUpdate(product, newType) {
    try {
      await api(`/api/products/${product.id}`, { method: "PATCH", body: { product_type: newType } });
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, product_type: newType } : p));
    } catch (e) {
      setUploadStatus("Failed to update type: " + e.message);
    }
    setEditingType(null);
    setShowCustomInput(false);
    setPendingNewType(null);
  }

  function cancelTypeEdit() { setEditingType(null); setShowCustomInput(false); }

  function submitCustomType(product) {
    const val = customTypeRef.current?.value?.trim();
    if (val) handleTypeUpdate(product, val);
  }

  function openTypeManager() {
    const allTypes = [...new Set([...PRODUCT_TYPES, ...products.map(p => p.product_type).filter(Boolean)])].sort();
    const edits = {};
    allTypes.forEach(t => edits[t] = t);
    setTypeManagerEdits(edits);
    setShowTypeManager(true);
  }

  function handleTypeManagerChange(oldType, newValue) {
    setTypeManagerEdits(prev => ({ ...prev, [oldType]: newValue }));
  }

  function submitTypeChange(oldType) {
    const newType = (typeManagerEdits[oldType] || "").trim();
    if (newType === oldType) return;
    const affectedCount = products.filter(p => p.product_type === oldType).length;
    setPendingTypeChange({ oldType, newType: newType || null, affectedCount });
  }

  async function commitTypeChange() {
    if (!pendingTypeChange) return;
    const { oldType, newType } = pendingTypeChange;
    try {
      const affected = products.filter(p => p.product_type === oldType);
      await Promise.all(affected.map(p =>
        api(`/api/products/${p.id}`, { method: "PATCH", body: { product_type: newType || null } })
      ));
      setProducts(prev => prev.map(p =>
        p.product_type === oldType ? { ...p, product_type: newType || null } : p
      ));
      setTypeManagerEdits(prev => {
        const next = { ...prev };
        delete next[oldType];
        if (newType) next[newType] = newType;
        return next;
      });
      if (filterType === oldType) setFilterType(newType || "");
    } catch (e) {
      setUploadStatus("Failed to update type: " + e.message);
    }
    setPendingTypeChange(null);
  }

  // ── Compliance check ──────────────────────────────────────────────────────────
  const runComplianceCheck = async () => {
    if (!complianceVaultId || !selected) return;
    const product = products.find(p => p.id === selected);
    if (!product) return;

    setComplianceRunning(true);
    setComplianceAnswer(null);
    setComplianceProgress({ select: 0, read: 0, answer: 0 });

    const question = complianceQuestion.trim() || `Is ${product.name} compliant with the relevant requirements in this vault?`;

    try {
      setComplianceStatus("Loading product datasheet…");
      const pdfData = await api(`/api/products/${product.id}/pdf`);

      const vaultObj = (() => {
        for (const v of vaults) {
          if (v.id === complianceVaultId) return v;
          if (v.type === "master") {
            const sub = (v.subVaults || []).find(sv => sv.id === complianceVaultId);
            if (sub) return sub;
          }
        }
        return null;
      })();
      if (!vaultObj) throw new Error("Vault not found");

      let vaultIndex = null;
      try { vaultIndex = await api(`/api/vaults/${encodeURIComponent(complianceVaultId)}/index`); } catch (_) {}
      if (!vaultIndex?.documents?.length) {
        setComplianceStatus("Vault has no index — please index this vault first.");
        setComplianceRunning(false);
        return;
      }

      // Pass 1: Score index
      setComplianceStatus("Pass 1/3 · Scoring index…");
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

      const attrs = expandedAttrs[product.id];
      const attrSummary = attrs ? attrs.slice(0, 10).map(a => `${a.attribute}: ${a.value}${a.unit ? " " + a.unit : ""}`).join(", ") : "";

      const scoringPrompt = `You are a technical document analyst. Using ONLY the index below, identify sections most likely to contain requirements relevant to this compliance question.

DOCUMENT INDEX:
${indexSummary}

COMPLIANCE QUESTION: ${question}

PRODUCT CONTEXT: ${product.name} by ${product.manufacturer || "unknown manufacturer"}. Type: ${product.product_type || "unknown"}. Key attributes: ${attrSummary}

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
        const clean = scoringText.replace(/```json|```/g, "").trim();
        try { scoring = JSON.parse(clean); }
        catch { const m = clean.match(/\{[\s\S]*\}/); if (m) try { scoring = JSON.parse(m[0]); } catch {} }
      } catch (e) { console.warn("Compliance scoring failed:", e); }

      setComplianceProgress({ select: 100, read: 20, answer: 0 });

      // Pass 2: Extract pages
      setComplianceStatus("Pass 2/3 · Extracting relevant pages…");

      let pdfsInVault = [];
      try {
        const pdfsData = await api(`/api/vaults/${encodeURIComponent(complianceVaultId)}/pdfs`);
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
          const pdfData2 = await api(`/api/vaults/${encodeURIComponent(complianceVaultId)}/pdfs/${encodeURIComponent(matchedPdf.name)}`);
          contentsData.push({ pdf: matchedPdf, base64: pdfData2.base64 });
        } catch (_) {}
      }

      if (contentsData.length === 0 && pdfsInVault.length > 0) {
        for (const pdf of pdfsInVault.slice(0, 2)) {
          try {
            const pdfData2 = await api(`/api/vaults/${encodeURIComponent(complianceVaultId)}/pdfs/${encodeURIComponent(pdf.name)}`);
            contentsData.push({ pdf, base64: pdfData2.base64 });
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

      const docBlocks = [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: pdfData.base64 },
          title: `PRODUCT DATASHEET: ${product.name}`,
        }
      ];

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

      if (docBlocks.length < 2) {
        setComplianceStatus("Could not extract relevant pages from this vault.");
        setComplianceRunning(false);
        return;
      }

      // Pass 3: Compliance synthesis
      setComplianceStatus("Pass 3/3 · Assessing compliance…");

      const compliancePrompt = `You are an expert building regulations consultant assessing a product for compliance against the provided regulatory documents.

PRODUCT: ${product.name}${product.manufacturer ? ` by ${product.manufacturer}` : ""}
COMPLIANCE QUESTION: ${question}

Using ONLY the provided document pages, produce a focused compliance assessment structured as follows:

## Compliance Assessment — ${vaultObj.name}

### Verdict
A short paragraph stating whether the product appears compliant, non-compliant, or where compliance is uncertain — and the primary reason why. Reference the specific requirement.

### Key Requirements
A table mapping the most relevant regulatory requirements to this product:

| Requirement | ${product.name} |
|---|---|

### Compliance Analysis
3–5 focused paragraphs covering the most important compliance points. For each point: state the requirement and assess the product against it.

### Concerns & Gaps
Any specific non-compliances, limitations, or areas where further evidence is needed. Be precise — quote the requirement and explain the gap. If none, state "No concerns identified."

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
  (vaults || []).forEach(v => {
    if (v.type === "master") {
      (v.subVaults || []).forEach(sv => vaultOptions.push({ id: sv.id, name: `${v.name} / ${sv.name}` }));
    } else {
      vaultOptions.push({ id: v.id, name: v.name });
    }
  });

  const selectedProduct = selected ? products.find(p => p.id === selected) : null;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f9f7f5" }}>

      {/* Confirm new type dialog */}
      {pendingNewType && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#ffffff", padding: "28px 32px", maxWidth: 400, width: "90%", fontFamily: "Inter, Arial, sans-serif" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: ARC_NAVY, marginBottom: 10 }}>Add new product type?</div>
            <div style={{ fontSize: 13, color: "#5a5048", marginBottom: 20, lineHeight: 1.6 }}>
              "<strong>{pendingNewType.type}</strong>" is not in the standard list. Adding it will make it available as a filter option for all products. Are you sure?
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => { setPendingNewType(null); cancelTypeEdit(); }}
                style={{ fontSize: 12, padding: "7px 16px", background: "none", border: "1px solid #ddd8d0", color: "#5a5048" }}>Cancel</button>
              <button className="btn" onClick={() => commitTypeUpdate(pendingNewType.product, pendingNewType.type)}
                style={{ fontSize: 12, padding: "7px 16px", background: ARC_NAVY, color: "#ffffff", fontWeight: 600 }}>Add type</button>
            </div>
          </div>
        </div>
      )}

      {/* Type manager panel */}
      {showTypeManager && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#ffffff", padding: "28px 32px", maxWidth: 480, width: "90%", fontFamily: "Inter, Arial, sans-serif", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: ARC_NAVY, marginBottom: 6 }}>Manage Product Types</div>
            <div style={{ fontSize: 12, color: "#9a9088", marginBottom: 20, lineHeight: 1.5 }}>
              Rename or delete types. Changes apply to all products with that type. Deleting a type sets affected products to unset.
            </div>
            <div style={{ overflowY: "auto", flex: 1, marginBottom: 20 }}>
              {Object.keys(typeManagerEdits).sort().map(oldType => {
                const affectedCount = products.filter(p => p.product_type === oldType).length;
                const currentVal = typeManagerEdits[oldType];
                const isDeleted = currentVal === "";
                return (
                  <div key={oldType} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "8px 12px", background: isDeleted ? "#fff5f5" : "#f9f7f5", border: `1px solid ${isDeleted ? "#f5c0b8" : "#e8e0d5"}` }}>
                    <input value={isDeleted ? "" : currentVal} onChange={e => handleTypeManagerChange(oldType, e.target.value)} disabled={isDeleted}
                      style={{ flex: 1, fontSize: 12, padding: "5px 8px", border: "1px solid #ddd8d0", fontFamily: "Inter, Arial, sans-serif", background: isDeleted ? "#f9f0ef" : "#ffffff", color: isDeleted ? "#b0a898" : ARC_NAVY, textDecoration: isDeleted ? "line-through" : "none" }} />
                    <span style={{ fontSize: 10, color: "#9a9088", flexShrink: 0, minWidth: 60, textAlign: "right" }}>{affectedCount} product{affectedCount !== 1 ? "s" : ""}</span>
                    {!isDeleted && currentVal !== oldType && (
                      <button className="btn" onClick={() => submitTypeChange(oldType)}
                        style={{ fontSize: 11, padding: "4px 10px", background: ARC_NAVY, color: "#ffffff", flexShrink: 0 }}>Save</button>
                    )}
                    {isDeleted ? (
                      <button className="btn" onClick={() => handleTypeManagerChange(oldType, oldType)}
                        style={{ fontSize: 11, padding: "4px 10px", background: "none", border: "1px solid #ddd8d0", color: "#9a9088", flexShrink: 0 }}>Undo</button>
                    ) : (
                      <button className="btn" onClick={() => {
                        if (currentVal !== oldType) {
                          handleTypeManagerChange(oldType, oldType);
                        } else {
                          setPendingTypeChange({ oldType, newType: null, affectedCount });
                        }
                      }} style={{ fontSize: 11, padding: "4px 10px", background: "none", border: `1px solid ${ARC_TERRACOTTA}`, color: ARC_TERRACOTTA, flexShrink: 0 }}>Delete</button>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setShowTypeManager(false)}
                style={{ fontSize: 12, padding: "7px 20px", background: ARC_NAVY, color: "#ffffff", fontWeight: 600 }}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm type change dialog */}
      {pendingTypeChange && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#ffffff", padding: "28px 32px", maxWidth: 420, width: "90%", fontFamily: "Inter, Arial, sans-serif" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: ARC_NAVY, marginBottom: 10 }}>
              {pendingTypeChange.newType ? "Rename type?" : "Delete type?"}
            </div>
            <div style={{ fontSize: 13, color: "#5a5048", marginBottom: 20, lineHeight: 1.6 }}>
              {pendingTypeChange.newType
                ? <>Renaming <strong>"{pendingTypeChange.oldType}"</strong> to <strong>"{pendingTypeChange.newType}"</strong> will update <strong>{pendingTypeChange.affectedCount} product{pendingTypeChange.affectedCount !== 1 ? "s" : ""}</strong> immediately.</>
                : <>Deleting <strong>"{pendingTypeChange.oldType}"</strong> will set <strong>{pendingTypeChange.affectedCount} product{pendingTypeChange.affectedCount !== 1 ? "s" : ""}</strong> to unset. This cannot be undone.</>
              }
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => { setPendingTypeChange(null); handleTypeManagerChange(pendingTypeChange.oldType, pendingTypeChange.oldType); }}
                style={{ fontSize: 12, padding: "7px 16px", background: "none", border: "1px solid #ddd8d0", color: "#5a5048" }}>Cancel</button>
              <button className="btn" onClick={commitTypeChange}
                style={{ fontSize: 12, padding: "7px 16px", background: pendingTypeChange.newType ? ARC_NAVY : ARC_TERRACOTTA, color: "#ffffff", fontWeight: 600 }}>
                {pendingTypeChange.newType ? "Rename" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ background: "#ffffff", borderBottom: "1px solid #e8e0d5", padding: "16px 40px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24, flex: 1, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 300, color: ARC_NAVY, margin: 0, fontFamily: "Inter, Arial, sans-serif" }}>Datasheet Library</h2>
            <p style={{ fontSize: 11, color: "#9a9088", margin: "2px 0 0", fontFamily: "Inter, Arial, sans-serif" }}>{products.length} product{products.length !== 1 ? "s" : ""}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select value={filterManufacturer} onChange={e => setFilterManufacturer(e.target.value)}
              style={{ fontSize: 12, padding: "5px 10px", border: "1px solid #ddd8d0", background: "#ffffff", color: filterManufacturer ? ARC_NAVY : "#9a9088", fontFamily: "Inter, Arial, sans-serif", cursor: "pointer" }}>
              <option value="">All manufacturers</option>
              {manufacturers.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              style={{ fontSize: 12, padding: "5px 10px", border: "1px solid #ddd8d0", background: "#ffffff", color: filterType ? ARC_NAVY : "#9a9088", fontFamily: "Inter, Arial, sans-serif", cursor: "pointer" }}>
              <option value="">All types</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {(filterManufacturer || filterType) && (
              <button className="btn" onClick={() => { setFilterManufacturer(""); setFilterType(""); }}
                style={{ fontSize: 11, color: ARC_TERRACOTTA, background: "none", border: "none", padding: "4px 6px", cursor: "pointer" }}>Clear</button>
            )}
            {isAdmin && (
              <button className="btn" onClick={openTypeManager}
                style={{ fontSize: 11, color: "#9a9088", background: "none", border: "1px solid #ddd8d0", padding: "4px 10px", cursor: "pointer", marginLeft: 4 }}>Manage types</button>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {uploadStatus && (
            <span style={{ fontSize: 11, color: uploadStatus.includes("failed") || uploadStatus.includes("Failed") || uploadStatus.includes("Could not") ? ARC_TERRACOTTA : "#5a7a6a", fontFamily: "Inter, Arial, sans-serif", maxWidth: 280 }}>
              {uploadStatus}
            </span>
          )}
          {selected && (
            <button className="btn" onClick={handleDownload} disabled={downloading}
              style={{ background: "none", color: LIBRARY_BLUE, border: `1px solid ${LIBRARY_BLUE}`, padding: "6px 14px", fontSize: 12, fontWeight: 500, opacity: downloading ? 0.6 : 1 }}>
              {downloading ? "Downloading…" : "⬇ Download"}
            </button>
          )}
          <button className="btn" onClick={() => inputRef.current?.click()} disabled={uploading}
            style={{ background: LIBRARY_BLUE, color: "#ffffff", padding: "6px 18px", fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", opacity: uploading ? 0.6 : 1 }}>
            {uploading ? "Processing…" : "+ Upload"}
          </button>
          <input ref={inputRef} type="file" accept=".pdf" multiple style={{ display: "none" }} onChange={async e => {
            const files = Array.from(e.target.files);
            e.target.value = "";
            for (const file of files) { await handleUpload(file); }
          }} />
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Product list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 40px" }}>
          {loading ? (
            <p style={{ color: "#9a9088", fontSize: 13, fontFamily: "Inter, Arial, sans-serif" }}>Loading…</p>
          ) : filteredProducts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "80px 40px" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
              <p style={{ fontSize: 15, color: ARC_NAVY, fontWeight: 300, fontFamily: "Inter, Arial, sans-serif", marginBottom: 8 }}>
                {products.length === 0 ? "No datasheets yet" : "No products match the current filters"}
              </p>
              <p style={{ fontSize: 12, color: "#9a9088", fontFamily: "Inter, Arial, sans-serif" }}>
                {products.length === 0 ? "Upload a product datasheet to get started" : "Try adjusting or clearing the filters"}
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {filteredProducts.map(product => {
                const isSelected = selected === product.id;
                const isExpanded = expanded === product.id;
                return (
                  <div key={product.id} style={{ background: "#ffffff", border: `1px solid ${isSelected ? LIBRARY_BLUE : isExpanded ? "#c0ccd4" : "#e8e0d5"}`, transition: "border-color 0.15s" }}>
                    <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", gap: 12 }}>
                      <input type="checkbox" checked={isSelected} onChange={() => {
                          setSelected(isSelected ? null : product.id);
                          setComplianceAnswer(null);
                          setComplianceStatus("");
                        }}
                        style={{ width: 15, height: 15, cursor: "pointer", accentColor: LIBRARY_BLUE, flexShrink: 0 }} />
                      <div style={{ flex: 1, cursor: "pointer" }} onClick={() => handleExpand(product.id)}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: ARC_NAVY, fontFamily: "Inter, Arial, sans-serif" }}>{product.name}</div>
                        <div style={{ fontSize: 11, color: "#9a9088", marginTop: 2, fontFamily: "Inter, Arial, sans-serif" }}>{product.manufacturer || "—"}</div>
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        {editingType === product.id ? (
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            {!showCustomInput ? (
                              <select autoFocus defaultValue={product.product_type || ""}
                                onChange={e => {
                                  if (e.target.value === "__custom__") { setShowCustomInput(true); }
                                  else { handleTypeUpdate(product, e.target.value || null); }
                                }}
                                style={{ fontSize: 11, padding: "3px 8px", border: `1px solid ${LIBRARY_BLUE}`, fontFamily: "Inter, Arial, sans-serif" }}>
                                <option value="">— unset —</option>
                                {[...PRODUCT_TYPES, ...types.filter(t => !PRODUCT_TYPES.includes(t))].map(t => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                                <option value="__custom__">+ Add new type…</option>
                              </select>
                            ) : (
                              <input ref={customTypeRef} autoFocus defaultValue="" placeholder="New type name…"
                                onKeyDown={e => { if (e.key === "Enter") submitCustomType(product); if (e.key === "Escape") cancelTypeEdit(); }}
                                style={{ fontSize: 11, padding: "3px 8px", border: `1px solid ${LIBRARY_BLUE}`, fontFamily: "Inter, Arial, sans-serif", width: 130 }} />
                            )}
                            {showCustomInput && (
                              <button className="btn" onClick={() => submitCustomType(product)}
                                style={{ fontSize: 11, padding: "3px 8px", background: ARC_NAVY, color: "#ffffff" }}>✓</button>
                            )}
                            <button className="btn" onClick={cancelTypeEdit}
                              style={{ fontSize: 11, padding: "3px 8px", background: "none", border: "1px solid #ddd8d0", color: "#9a9088" }}>✕</button>
                          </div>
                        ) : (
                          <span onClick={() => { setEditingType(product.id); setShowCustomInput(false); }} title="Click to edit type"
                            style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: product.product_type ? LIBRARY_BLUE : "#b0a898", background: product.product_type ? LIBRARY_BLUE_LIGHT : "#f0ede8", padding: "3px 8px", cursor: "pointer", userSelect: "none" }}>
                            {product.product_type || "Set type"}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "#b0a898", fontFamily: "Inter, Arial, sans-serif", flexShrink: 0 }}>
                        {new Date(product.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </div>
                      <button className="btn" onClick={() => handleExpand(product.id)}
                        style={{ fontSize: 11, color: LIBRARY_BLUE, background: "none", border: "none", padding: "2px 6px", flexShrink: 0, fontWeight: 500 }}>
                        {isExpanded ? "▲" : "▼"}
                      </button>
                    </div>
                    {isExpanded && (
                      <div style={{ borderTop: "1px solid #e8e0d5", padding: "14px 16px" }}>
                        {!expandedAttrs[product.id] ? (
                          <p style={{ fontSize: 12, color: "#9a9088", fontFamily: "Inter, Arial, sans-serif" }}>Loading…</p>
                        ) : expandedAttrs[product.id].length === 0 ? (
                          <p style={{ fontSize: 12, color: "#9a9088", fontFamily: "Inter, Arial, sans-serif" }}>No attributes extracted.</p>
                        ) : (
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "Inter, Arial, sans-serif" }}>
                            <thead>
                              <tr>
                                <th style={{ background: ARC_NAVY, color: "#ffffff", padding: "6px 12px", textAlign: "left", fontWeight: 500, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", width: "35%" }}>Attribute</th>
                                <th style={{ background: ARC_NAVY, color: "#ffffff", padding: "6px 12px", textAlign: "left", fontWeight: 500, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase" }}>Value</th>
                                <th style={{ background: ARC_NAVY, color: "#ffffff", padding: "6px 12px", textAlign: "left", fontWeight: 500, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", width: "15%" }}>Unit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expandedAttrs[product.id].map((attr, i) => (
                                <tr key={i} style={{ background: i % 2 === 0 ? "#f9f7f5" : "#ffffff" }}>
                                  <td style={{ padding: "7px 12px", borderBottom: "1px solid #e8e0d5", color: "#5a5048", fontWeight: 500 }}>{attr.attribute}</td>
                                  <td style={{ padding: "7px 12px", borderBottom: "1px solid #e8e0d5", color: ARC_NAVY }}>{attr.value}</td>
                                  <td style={{ padding: "7px 12px", borderBottom: "1px solid #e8e0d5", color: "#9a9088" }}>{attr.unit || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                          <button className="btn" onClick={() => handleDelete(product)} disabled={deleting === product.id}
                            style={{ fontSize: 11, color: ARC_TERRACOTTA, background: "none", border: `1px solid ${ARC_TERRACOTTA}`, padding: "3px 10px", opacity: deleting === product.id ? 0.5 : 1 }}>
                            {deleting === product.id ? "Deleting…" : "Remove"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right panel — compliance check */}
        {selectedProduct && (
          <div style={{ width: 360, borderLeft: "1px solid #e8e0d5", background: "#ffffff", display: "flex", flexDirection: "column", flexShrink: 0, overflowY: "auto" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #e8e0d5" }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9a9088", marginBottom: 4 }}>Selected</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: ARC_NAVY, fontFamily: "Inter, Arial, sans-serif" }}>{selectedProduct.name}</div>
              {selectedProduct.manufacturer && <div style={{ fontSize: 11, color: "#9a9088", marginTop: 2 }}>{selectedProduct.manufacturer}</div>}
            </div>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #e8e0d5" }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9a9088", marginBottom: 10 }}>Compliance Check</div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: "#9a9088", fontFamily: "Inter, Arial, sans-serif", display: "block", marginBottom: 4 }}>Vault</label>
                <select value={complianceVaultId} onChange={e => setComplianceVaultId(e.target.value)}
                  style={{ width: "100%", fontSize: 12, padding: "6px 10px", border: "1px solid #ddd8d0", background: "#ffffff", fontFamily: "Inter, Arial, sans-serif" }}>
                  <option value="">Select vault…</option>
                  {vaultOptions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: "#9a9088", fontFamily: "Inter, Arial, sans-serif", display: "block", marginBottom: 4 }}>Question (optional)</label>
                <textarea value={complianceQuestion} onChange={e => setComplianceQuestion(e.target.value)}
                  placeholder={`Is ${selectedProduct.name} compliant with the relevant requirements?`}
                  rows={3}
                  style={{ width: "100%", fontSize: 12, padding: "7px 10px", border: "1px solid #ddd8d0", fontFamily: "Inter, Arial, sans-serif", resize: "vertical", boxSizing: "border-box" }} />
              </div>
              <button className="btn" onClick={runComplianceCheck} disabled={!complianceVaultId || complianceRunning}
                style={{ width: "100%", background: complianceVaultId && !complianceRunning ? ARC_NAVY : "#c0c0c0", color: "#ffffff", padding: "8px", fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                {complianceRunning ? "Running…" : "Run Compliance Check"}
              </button>
              {complianceStatus && (
                <p style={{ fontSize: 11, color: complianceStatus.includes("Error") ? ARC_TERRACOTTA : "#5a7a6a", marginTop: 8, fontFamily: "Inter, Arial, sans-serif" }}>{complianceStatus}</p>
              )}
              {complianceRunning && (
                <div style={{ marginTop: 10 }}>
                  {[["Scoring index", complianceProgress.select], ["Extracting pages", complianceProgress.read], ["Synthesising", complianceProgress.answer]].map(([label, pct]) => (
                    <div key={label} style={{ marginBottom: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9a9088", marginBottom: 3 }}>
                        <span>{label}</span><span>{pct}%</span>
                      </div>
                      <div style={{ height: 3, background: "#e8e0d5" }}>
                        <div style={{ height: 3, background: ARC_NAVY, width: `${pct}%`, transition: "width 0.5s" }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {complianceAnswer && (
              <div style={{ padding: "16px 20px", flex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9a9088", marginBottom: 10 }}>Result</div>
                <AnswerRenderer text={complianceAnswer} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
