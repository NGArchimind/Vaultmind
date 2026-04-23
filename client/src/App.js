import { useState, useRef, useCallback, useEffect } from "react";

const IS_DEMO = false;
const API_BASE = process.env.REACT_APP_API_URL || "https://archimind.up.railway.app";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const MAX_PAGES_PER_CHUNK = 90;

// ── API helpers ───────────────────────────────────────────────────────────────

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json();
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Read failed"));
    r.readAsDataURL(file);
  });
}

async function splitPdfIntoChunks(base64Data, chunkSize) {
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

async function callClaude(messages, systemPrompt, maxTokens = 1000, retries = 2, model = "gemini-2.5-flash", timeoutMs = 240000, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${API_BASE}/api/claude`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    usage: data.usage || { input_tokens: 0, output_tokens: 0 }
  };
}

// ── sub-components ────────────────────────────────────────────────────────────

function Spinner({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
    </svg>
  );
}

function ProgressBar({ label, pct, color = "#0d6478" }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9a9088", marginBottom: 4, letterSpacing: "0.04em" }}>
        <span style={{ fontWeight: 500 }}>{label}</span><span>{Math.round(pct)}%</span>
      </div>
      <div style={{ height: 3, background: "#e8e0d5" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

function formatInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} style={{ color: "#e8d5a3" }}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} style={{ background: "#1e1e1e", color: "#c8a96e", padding: "1px 5px", borderRadius: 3, fontSize: 12 }}>{p.slice(1, -1)}</code>;
    return p;
  });
}

const AD_GREEN = "#0d6478";
const AD_GREEN_LIGHT = "#f0f5f6";
const AD_GREEN_MID = "#b8d4da";
const ARC_NAVY = "#1e2a35";
const ARC_TERRACOTTA = "#c25a45";
const ARC_STONE = "#e8e0d5";

function AnswerRenderer({ text }) {
  if (!text) return null;
  const lines = text.split("\n");
  const elements = [];
  let tableBuffer = [];
  let inTable = false;

  const flushTable = (key) => {
    if (tableBuffer.length === 0) return;
    const parseRow = (r) => {
      const startsWithChevron = r.startsWith(">> ");
      const hasPerCellChevron = (r.match(/>> /g) || []).length >= 2;
      const highlighted = startsWithChevron || hasPerCellChevron;
      const clean = startsWithChevron ? r.slice(3) : r.replace(/>> /g, "");
      const stripped = clean.replace(/^\s*\|/, "").replace(/\|\s*$/, "");
      const cells = stripped.split("|").map(c => c.trim());
      return { cells, highlighted };
    };
    const rows = tableBuffer.map(parseRow);
    const header = rows[0].cells;
    const colCount = header.length;
    const body = rows.slice(2).map(row => ({
      ...row,
      cells: Array.from({ length: colCount }, (_, i) => row.cells[i] ?? "")
    }));
    const tableTitle = tableBuffer._title || null;
    elements.push(
      <div key={`tbl-${key}`} style={{ overflowX: "auto", margin: "16px 0", border: "1px solid #aaa" }}>
        {tableTitle && (
          <div style={{ background: "#f5f3f0", borderBottom: "1px solid #ccc", padding: "7px 14px", fontSize: 11, fontWeight: 600, color: ARC_NAVY, letterSpacing: "0.03em" }}>{tableTitle}</div>
        )}
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>{header.map((h, i) => (
              <th key={i} style={{ background: ARC_NAVY, color: "#ffffff", padding: "8px 14px", border: "none", textAlign: "left", fontWeight: 500, fontSize: 11, fontFamily: "Inter, Arial, sans-serif", letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri} style={{ background: row.highlighted ? "#fff8e8" : ri % 2 === 0 ? "#ffffff" : "#f5f9fa" }}>
                {row.cells.map((cell, ci) => (
                  <td key={ci} style={{ padding: "9px 14px", border: "none", borderBottom: "1px solid #e8e0d5", color: row.highlighted ? "#7a4f00" : ARC_NAVY, fontWeight: row.highlighted ? 600 : 400, verticalAlign: "top", fontSize: 12, lineHeight: 1.6, fontFamily: "Inter, Arial, sans-serif" }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableBuffer = []; inTable = false;
  };

  lines.forEach((line, i) => {
    if (line.startsWith(">> ")) {
      inTable = true;
      if (tableBuffer._pendingTitle) {
        tableBuffer._title = tableBuffer._pendingTitle;
        delete tableBuffer._pendingTitle;
      }
      const chevronContent = line.slice(3).trim();
      const normalised = chevronContent.startsWith("|") ? `>> ${chevronContent}` : `>> | ${chevronContent} |`;
      tableBuffer.push(normalised);
      return;
    }
    if (line.startsWith("|")) {
      inTable = true;
      if (tableBuffer._pendingTitle) {
        tableBuffer._title = tableBuffer._pendingTitle;
        delete tableBuffer._pendingTitle;
      }
      tableBuffer.push(line);
      return;
    }
    if (inTable) flushTable(i);

    const trimmedLine = line.trim();
    const isBoldTitle = (trimmedLine.startsWith("**") && trimmedLine.endsWith("**") && /table|figure/i.test(trimmedLine));
    const isPlainTitle = (!trimmedLine.startsWith("|") && !trimmedLine.startsWith(">") && !trimmedLine.startsWith("*") && /^(table|figure)\s+\d+/i.test(trimmedLine) && !trimmedLine.includes("  "));
    if (isBoldTitle || isPlainTitle) {
      tableBuffer._pendingTitle = trimmedLine.replace(/\*\*/g, "").trim();
      return;
    }

    if (!trimmedLine.startsWith("|") && !trimmedLine.startsWith(">") && trimmedLine.includes(" | ") && tableBuffer._pendingTitle && !inTable) {
      inTable = true;
      if (tableBuffer._pendingTitle) {
        tableBuffer._title = tableBuffer._pendingTitle;
        delete tableBuffer._pendingTitle;
      }
      tableBuffer.push(`| ${trimmedLine} |`);
      const colCount = trimmedLine.split(" | ").length;
      tableBuffer.push(`|${Array(colCount).fill("---").join("|")}|`);
      return;
    }

    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={i} style={{ color: ARC_TERRACOTTA, fontSize: 11, fontWeight: 600, margin: "20px 0 6px", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "Inter, Arial, sans-serif" }}>
          {line.slice(4)}
        </h3>
      );
    } else if (line.startsWith("## ")) {
      const text = line.slice(3);
      const isSummary = text.toLowerCase().includes("summary");
      const isContext = text.toLowerCase().includes("regulatory context");
      if (isSummary) {
        elements.push(
          <div key={i} style={{ background: "#f0f5f6", border: `1px solid ${AD_GREEN_MID}`, borderLeft: `3px solid ${AD_GREEN}`, padding: "14px 18px", margin: "16px 0 8px" }}>
            <h2 style={{ color: AD_GREEN, fontSize: 12, fontWeight: 600, margin: 0, fontFamily: "Inter, Arial, sans-serif", textTransform: "uppercase", letterSpacing: "0.08em" }}>{text}</h2>
          </div>
        );
      } else if (isContext) {
        elements.push(
          <div key={i} style={{ background: "#faf6f0", border: `1px solid #e0d5c5`, borderLeft: `3px solid ${ARC_TERRACOTTA}`, padding: "14px 18px", margin: "24px 0 8px" }}>
            <h2 style={{ color: ARC_TERRACOTTA, fontSize: 12, fontWeight: 600, margin: 0, fontFamily: "Inter, Arial, sans-serif", textTransform: "uppercase", letterSpacing: "0.08em" }}>{text}</h2>
          </div>
        );
      } else {
        elements.push(
          <div key={i} style={{ borderBottom: `1px solid #e8e0d5`, marginTop: 28, marginBottom: 10, paddingBottom: 6 }}>
            <h2 style={{ color: ARC_NAVY, fontSize: 16, fontWeight: 400, margin: 0, fontFamily: "Inter, Arial, sans-serif", letterSpacing: "0.02em" }}>{text}</h2>
          </div>
        );
      }
    } else if (line.startsWith("# ")) {
      elements.push(
        <div key={i} style={{ borderBottom: `2px solid ${ARC_TERRACOTTA}`, marginTop: 32, marginBottom: 14, paddingBottom: 6 }}>
          <h1 style={{ color: ARC_NAVY, fontSize: 20, fontWeight: 300, margin: 0, fontFamily: "Inter, Arial, sans-serif", letterSpacing: "0.02em" }}>{line.slice(2)}</h1>
        </div>
      );
    } else if (line.startsWith("> ")) {
      const quoteText = line.slice(2);
      const isCitation = quoteText.startsWith("*") && quoteText.endsWith("*");
      const isTableRow = quoteText.startsWith("|");
      const isSeparatorRow = /^\|[\s:|-]+\|/.test(quoteText);
      if (isCitation) {
        elements.push(
          <p key={i} style={{ fontSize: 11, color: "#9a9088", fontStyle: "italic", margin: "2px 0 8px 0", fontFamily: "Inter, Arial, sans-serif" }}>
            {quoteText.slice(1, -1)}
          </p>
        );
      } else if (isTableRow && !isSeparatorRow) {
        inTable = true; tableBuffer.push(quoteText);
      } else if (isSeparatorRow) {
        if (inTable) tableBuffer.push(quoteText);
      } else {
        elements.push(
          <div key={i} style={{ borderLeft: `2px solid #d0ccc8`, padding: "2px 0 2px 14px", margin: "4px 0", fontStyle: "italic", fontSize: 13, color: "#4a5568", lineHeight: 1.8, fontFamily: "Inter, Arial, sans-serif" }}>
            {quoteText}
          </div>
        );
      }
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      const trimmedBullet = line.trim();
      const isBulletCitationWrapped = trimmedBullet.startsWith("*") && trimmedBullet.endsWith("*") && trimmedBullet.length > 2 && !trimmedBullet.startsWith("**");
      const isBulletCitationUnwrapped = trimmedBullet.startsWith("*") && !trimmedBullet.startsWith("**") && trimmedBullet.includes("|") && trimmedBullet.length > 10;
      if (isBulletCitationWrapped || isBulletCitationUnwrapped) {
        const citationText = isBulletCitationWrapped ? trimmedBullet.slice(1, -1) : trimmedBullet.slice(1).trim();
        elements.push(
          <p key={i} style={{ fontSize: 11, color: "#9a9088", fontStyle: "italic", margin: "2px 0 8px 0", fontFamily: "Inter, Arial, sans-serif" }}>
            {citationText}
          </p>
        );
      } else {
        elements.push(<li key={i} style={{ color: ARC_NAVY, fontSize: 13, lineHeight: 1.7, marginLeft: 20, marginBottom: 4, fontFamily: "Inter, Arial, sans-serif" }}>{formatInline(line.slice(2))}</li>);
      }
    } else if (line.match(/^\d+\.\d+ /)) {
      const numMatch = line.match(/^(\d+\.\d+) (.+)/);
      if (numMatch) {
        elements.push(
          <div key={i} style={{ display: "flex", gap: 12, margin: "6px 0", fontFamily: "Arial, sans-serif" }}>
            <span style={{ color: ARC_TERRACOTTA, fontWeight: 600, fontSize: 12, flexShrink: 0, minWidth: 28 }}>{numMatch[1]}</span>
            <p style={{ color: ARC_NAVY, fontSize: 13, lineHeight: 1.7, margin: 0, fontFamily: "Inter, Arial, sans-serif" }}>{formatInline(numMatch[2])}</p>
          </div>
        );
      }
    } else if (line.match(/^\d+\. /)) {
      elements.push(<li key={i} style={{ color: "#0b0c0c", fontSize: 14, lineHeight: 1.7, marginLeft: 20, marginBottom: 3, listStyleType: "decimal", fontFamily: "Arial, sans-serif" }}>{formatInline(line.replace(/^\d+\. /, ""))}</li>);
    } else if (line === "") {
      elements.push(<div key={i} style={{ height: 10 }} />);
    } else {
      const trimmed = line.trim();
      const isWrappedCitation = trimmed.startsWith("*") && trimmed.endsWith("*") && trimmed.length > 2 && !trimmed.startsWith("**");
      const isUnwrappedCitation = trimmed.startsWith("*") && !trimmed.startsWith("**") && trimmed.includes("|") && trimmed.length > 10;
      if (isWrappedCitation || isUnwrappedCitation) {
        const citationText = isWrappedCitation ? trimmed.slice(1, -1) : trimmed.slice(1).trim();
        elements.push(
          <p key={i} style={{ fontSize: 11, color: "#9a9088", fontStyle: "italic", margin: "2px 0 8px 0", fontFamily: "Inter, Arial, sans-serif" }}>
            {citationText}
          </p>
        );
      } else {
        elements.push(<p key={i} style={{ color: ARC_NAVY, fontSize: 13, lineHeight: 1.8, margin: "6px 0", fontFamily: "Inter, Arial, sans-serif", letterSpacing: "0.01em" }}>{formatInline(line)}</p>);
      }
    }
  });
  if (inTable) flushTable("end");
  return <div>{elements}</div>;
}

// ── Vault Management Modal ─────────────────────────────────────────────────────

function VaultManagementModal({ vaults, onClose, onRefresh, isAdmin }) {
  const [mode, setMode] = useState("menu");
  const [targetVault, setTargetVault] = useState(null);
  const [inputName, setInputName] = useState("");
  const [selectedParent, setSelectedParent] = useState("");
  const [selectedSource, setSelectedSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const masterVaults = vaults.filter(v => v.type === "master");
  const flatVaults = vaults.filter(v => v.type === "vault");

  const reset = () => { setMode("menu"); setTargetVault(null); setInputName(""); setSelectedParent(""); setSelectedSource(""); setError(""); };

  const doCreateMaster = async () => {
    if (!inputName.trim()) return;
    setBusy(true); setError("");
    try {
      await api("/api/vaults", { method: "POST", body: { name: inputName.trim(), type: "master" } });
      await onRefresh(); reset();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const doCreateSub = async () => {
    if (!inputName.trim() || !selectedParent) return;
    setBusy(true); setError("");
    try {
      await api("/api/vaults", { method: "POST", body: { name: inputName.trim(), parentVault: selectedParent } });
      await onRefresh(); reset();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const doAdopt = async () => {
    if (!selectedSource || !selectedParent) return;
    setBusy(true); setError("");
    try {
      await api(`/api/vaults/${encodeURIComponent(selectedParent)}/adopt`, { method: "POST", body: { sourceVault: selectedSource } });
      await onRefresh(); reset();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const doRename = async () => {
    if (!inputName.trim() || !targetVault) return;
    setBusy(true); setError("");
    try {
      await api(`/api/vaults/${encodeURIComponent(targetVault.id)}`, { method: "PATCH", body: { name: inputName.trim() } });
      await onRefresh(); reset();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const doDelete = async () => {
    if (!targetVault) return;
    setBusy(true); setError("");
    try {
      await api(`/api/vaults/${encodeURIComponent(targetVault.id)}`, { method: "DELETE" });
      await onRefresh(); reset();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const modalStyle = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex",
    alignItems: "center", justifyContent: "center", zIndex: 1000,
  };
  const cardStyle = {
    background: "#fff", width: 480, maxHeight: "80vh", overflow: "auto",
    borderTop: `3px solid ${ARC_TERRACOTTA}`, padding: "32px 36px",
    fontFamily: "Inter, Arial, sans-serif",
  };
  const label = (txt) => (
    <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", display: "block", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>{txt}</label>
  );
  const inputEl = (val, set, placeholder, autoFocus = false) => (
    <input value={val} onChange={e => set(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
      className="arc-input"
      style={{ width: "100%", border: `1px solid #ccc`, padding: "9px 12px", fontSize: 13, color: ARC_NAVY, marginBottom: 14, outline: "none", background: "#fff", fontFamily: "Inter, Arial, sans-serif" }} />
  );
  const selectEl = (val, set, options, placeholder) => (
    <select value={val} onChange={e => set(e.target.value)}
      style={{ width: "100%", border: `1px solid #ccc`, padding: "9px 12px", fontSize: 13, color: val ? ARC_NAVY : "#9a9088", marginBottom: 14, outline: "none", background: "#fff", fontFamily: "Inter, Arial, sans-serif" }}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
  const btn = (label, onClick, variant = "primary") => (
    <button className="btn" onClick={onClick} disabled={busy}
      style={{
        background: variant === "primary" ? ARC_NAVY : variant === "danger" ? ARC_TERRACOTTA : "transparent",
        color: variant === "ghost" ? "#9a9088" : "#fff",
        border: variant === "ghost" ? "1px solid #ccc" : "none",
        padding: "8px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginRight: 8,
      }}>{busy ? <Spinner size={12} /> : label}</button>
  );

  const allVaultOptions = [];
  vaults.forEach(v => {
    allVaultOptions.push({ id: v.id, label: v.name });
    if (v.type === "master") {
      (v.subVaults || []).forEach(sv => {
        allVaultOptions.push({ id: sv.id, label: `  ↳ ${sv.name} (in ${v.name})` });
      });
    }
  });

  return (
    <div style={modalStyle} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 500, color: ARC_NAVY, letterSpacing: "0.02em" }}>
            {mode === "menu" ? "Manage Vaults" :
             mode === "createMaster" ? "New Master Vault" :
             mode === "createSub" ? "New Sub-Vault" :
             mode === "adopt" ? "Adopt Vault into Master" :
             mode === "rename" ? "Rename Vault" :
             mode === "delete" ? "Delete Vault" : "Manage Vaults"}
          </h2>
          <button className="btn" onClick={onClose} style={{ background: "none", color: "#9a9088", fontSize: 20, padding: "0 4px" }}>×</button>
        </div>

        {error && <div style={{ background: "#fdf5f3", border: `1px solid ${ARC_TERRACOTTA}`, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: ARC_TERRACOTTA }}>{error}</div>}

        {mode === "menu" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <MenuOption icon="📁" title="New Master Vault" desc="Create a top-level folder to organise sub-vaults" onClick={() => setMode("createMaster")} />
            <MenuOption icon="📂" title="New Sub-Vault" desc="Add a sub-vault inside an existing master vault" onClick={() => setMode("createSub")} disabled={masterVaults.length === 0} />
            <MenuOption icon="📥" title="Adopt Vault into Master" desc="Move an existing flat vault inside a master vault" onClick={() => setMode("adopt")} disabled={masterVaults.length === 0 || flatVaults.length === 0} />
            <MenuOption icon="✏️" title="Rename Vault" desc="Rename any vault or sub-vault" onClick={() => setMode("rename")} disabled={vaults.length === 0} />
            <MenuOption icon="🗑" title="Delete Vault" desc="Permanently delete a vault and all its documents" onClick={() => setMode("delete")} disabled={vaults.length === 0} danger />
          </div>
        )}

        {mode === "createMaster" && (
          <>
            {label("Master vault name")}
            {inputEl(inputName, setInputName, "e.g. British Standards", true)}
            <div style={{ display: "flex" }}>
              {btn("Create", doCreateMaster)}
              {btn("Cancel", reset, "ghost")}
            </div>
          </>
        )}

        {mode === "createSub" && (
          <>
            {label("Parent master vault")}
            {selectEl(selectedParent, setSelectedParent, masterVaults.map(v => ({ id: v.id, label: v.name })), "Select master vault…")}
            {label("Sub-vault name")}
            {inputEl(inputName, setInputName, "e.g. BS 9991:2021")}
            <div style={{ display: "flex" }}>
              {btn("Create", doCreateSub)}
              {btn("Cancel", reset, "ghost")}
            </div>
          </>
        )}

        {mode === "adopt" && (
          <>
            <p style={{ fontSize: 12, color: "#9a9088", marginBottom: 16, lineHeight: 1.6 }}>
              This will move all documents and the index from the flat vault into the master vault. The original vault will be removed.
            </p>
            {label("Vault to adopt")}
            {selectEl(selectedSource, setSelectedSource, flatVaults.map(v => ({ id: v.id, label: v.name })), "Select flat vault to move…")}
            {label("Move into master vault")}
            {selectEl(selectedParent, setSelectedParent, masterVaults.map(v => ({ id: v.id, label: v.name })), "Select master vault…")}
            <div style={{ display: "flex" }}>
              {btn("Adopt", doAdopt)}
              {btn("Cancel", reset, "ghost")}
            </div>
          </>
        )}

        {mode === "rename" && (
          <>
            {label("Select vault to rename")}
            {selectEl(
              targetVault?.id || "",
              (id) => setTargetVault(allVaultOptions.find(o => o.id === id)),
              allVaultOptions,
              "Select vault…"
            )}
            {targetVault && (
              <>
                {label("New name")}
                {inputEl(inputName, setInputName, "Enter new name…", true)}
              </>
            )}
            <div style={{ display: "flex" }}>
              {btn("Rename", doRename)}
              {btn("Cancel", reset, "ghost")}
            </div>
          </>
        )}

        {mode === "delete" && (
          <>
            <p style={{ fontSize: 12, color: "#9a9088", marginBottom: 16, lineHeight: 1.6 }}>
              This permanently deletes the vault and <strong>all documents inside it</strong>. This cannot be undone.
            </p>
            {label("Select vault to delete")}
            {selectEl(
              targetVault?.id || "",
              (id) => setTargetVault(allVaultOptions.find(o => o.id === id)),
              allVaultOptions,
              "Select vault…"
            )}
            {targetVault && (
              <div style={{ background: "#fdf5f3", border: `1px solid ${ARC_TERRACOTTA}`, padding: "12px 16px", marginBottom: 16 }}>
                <p style={{ fontSize: 12, color: ARC_TERRACOTTA, fontWeight: 600 }}>
                  Delete "{targetVault.label.trim()}"? This cannot be undone.
                </p>
              </div>
            )}
            <div style={{ display: "flex" }}>
              {btn("Delete permanently", doDelete, "danger")}
              {btn("Cancel", reset, "ghost")}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MenuOption({ icon, title, desc, onClick, disabled, danger }) {
  return (
    <button className="btn" onClick={onClick} disabled={disabled}
      style={{
        background: "transparent", border: `1px solid ${disabled ? "#eee" : danger ? "#f0d0cb" : ARC_STONE}`,
        padding: "12px 16px", textAlign: "left", width: "100%",
        opacity: disabled ? 0.4 : 1, cursor: disabled ? "not-allowed" : "pointer",
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: danger ? ARC_TERRACOTTA : ARC_NAVY, letterSpacing: "0.01em" }}>{title}</div>
          <div style={{ fontSize: 11, color: "#9a9088", marginTop: 2 }}>{desc}</div>
        </div>
      </div>
    </button>
  );
}

// ── Compare Section ────────────────────────────────────────────────────────────

function CompareSection({ vaults, isAdmin }) {
  const [docA, setDocA] = useState(null);
  const [docB, setDocB] = useState(null);
  const [dragOverA, setDragOverA] = useState(false);
  const [dragOverB, setDragOverB] = useState(false);
  const [compareStatus, setCompareStatus] = useState("");
  const [compareRunning, setCompareRunning] = useState(false);
  const [compareAnswer, setCompareAnswer] = useState(null);
  const [compareHistory, setCompareHistory] = useState([]);
  const [followUp, setFollowUp] = useState("");

  // Compliance check state
  const [showVaultPicker, setShowVaultPicker] = useState(false);
  const [selectedVaultId, setSelectedVaultId] = useState("");
  const [complianceRunning, setComplianceRunning] = useState(false);
  const [complianceStatus, setComplianceStatus] = useState("");
  const [complianceProgress, setComplianceProgress] = useState({ select: 0, read: 0, answer: 0 });
  const [complianceAnswer, setComplianceAnswer] = useState(null);

  // Suggested compliance questions state
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

    // Two parallel prompts — Call A: Overview + Specifications, Call B: Key Differences + Specifier Notes
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
      // Attempt text extraction for both PDFs first
      setCompareStatus("Extracting document content…");
      const [extractA, extractB] = await Promise.all([
        api("/api/extract-text", { method: "POST", body: { base64: docA.base64 } }).catch(() => ({ hasText: false, text: "" })),
        api("/api/extract-text", { method: "POST", body: { base64: docB.base64 } }).catch(() => ({ hasText: false, text: "" })),
      ]);

      const useTextA = extractA.hasText;
      const useTextB = extractB.hasText;
      console.log(`Doc A text extraction: hasText=${useTextA}, chars=${extractA.text?.length}`);
      console.log(`Doc B text extraction: hasText=${useTextB}, chars=${extractB.text?.length}`);

      // Require text extraction to succeed with meaningful content — no PDF fallback
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

      // Fire both calls in parallel
      setCompareStatus("Analysing both documents…");
      const [resultA, resultB] = await Promise.all([
        callClaude([{ role: "user", content: contentA }], COMPARE_SYSTEM, 8000, 2, "gemini-2.5-flash", 240000, COMPARE_OPTIONS),
        callClaude([{ role: "user", content: contentB }], COMPARE_SYSTEM, 8000, 2, "gemini-2.5-flash", 240000, COMPARE_OPTIONS),
      ]);

      const text = `${resultA.text}\n\n${resultB.text}`;
      setCompareAnswer(text);
      setCompareHistory([{ role: "user", content: `Compare ${docA.name} and ${docB.name}`, isInitial: true }, { role: "assistant", content: text }]);
      setCompareStatus("Comparison complete.");

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
        65000,
        2,
        "gemini-2.5-flash",
        240000
      );
      setCompareAnswer(text);
      setCompareHistory(prev => [...prev, { role: "user", content: q }, { role: "assistant", content: text }]);
      setCompareStatus("Answer ready.");
    } catch (e) {
      setCompareStatus("Error: " + e.message);
    }
    setCompareRunning(false);
  };

  // ── Compliance check against vaults ──────────────────────────────────────────
  const runComplianceCheck = async () => {
    if (!selectedVaultId || !compareAnswer) return;
    setShowVaultPicker(false);
    setComplianceRunning(true);
    setComplianceAnswer(null);
    setComplianceProgress({ select: 0, read: 0, answer: 0 });

    const complianceQuestion = selectedQuestion || `Are these products compliant with the relevant requirements in this vault?`;

    try {
      // Resolve vault object
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

      // Load vault index
      let vaultIndex = null;
      try { vaultIndex = await api(`/api/vaults/${encodeURIComponent(selectedVaultId)}/index`); } catch (_) {}
      if (!vaultIndex?.documents?.length) {
        setComplianceStatus("Vault has no index — please index this vault first.");
        setComplianceRunning(false);
        return;
      }

      // ── PASS 1: Score index (flash-lite for speed) ───────────────────────────
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

      // ── PASS 2: Load and extract relevant pages ───────────────────────────────
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

      // ── PASS 3: Compliance synthesis ──────────────────────────────────────────
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
*Document | Page X | Clause title*

PAGE NUMBERS: Use the printed page number visible on the page itself, not its position in the extracted set. If unclear, use the page numbers in the document title block (e.g. "BS 9991:2024 — pages 101, 102").

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

  // ── Build flat vault options list for picker ──────────────────────────────────
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

  const selectVaultForCompliance = (id) => {
    setSelectedVaultId(id);
  };

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
            padding: "40px 24px",
            textAlign: "center",
            cursor: "pointer",
            background: dragOver ? "#f0f5f6" : "#faf8f5",
            transition: "all 0.2s",
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

        {/* Chat history (prior questions) */}
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
                    <p style={{ fontSize: 11, color: "#9a9088", marginBottom: 12, lineHeight: 1.6 }}>
                      Only indexed vaults can be used.
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16, maxHeight: 200, overflowY: "auto" }}>
                      {vaultOptions.length === 0 && (
                        <p style={{ fontSize: 12, color: "#9a9088", fontStyle: "italic" }}>No vaults available.</p>
                      )}
                      {vaultOptions.map(v => (
                        <label key={v.id} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "8px 12px", background: selectedVaultId === v.id ? "#f0f5f6" : "transparent", border: `1px solid ${selectedVaultId === v.id ? AD_GREEN : "#e8e0d5"}` }}>
                          <input type="radio" name="vaultSelect" checked={selectedVaultId === v.id} onChange={() => selectVaultForCompliance(v.id)}
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
                {/* Option to run another compliance check against different vaults */}
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

// ── Landing Page ───────────────────────────────────────────────────────────────

function LandingPage({ onSelect, isAdmin }) {
  const [hoverVault, setHoverVault] = useState(false);
  const [hoverCompare, setHoverCompare] = useState(false);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: ARC_STONE, padding: "40px 24px" }}>
      <div style={{ marginBottom: 48, textAlign: "center" }}>
        <p style={{ fontSize: 13, color: "#9a9088", letterSpacing: "0.1em", textTransform: "uppercase" }}>Select a tool to get started</p>
      </div>

      <div style={{ display: "flex", gap: 24, width: "100%", maxWidth: 800 }}>

        {/* Vault tile */}
        <button className="btn" onClick={() => onSelect("vault")}
          onMouseEnter={() => setHoverVault(true)}
          onMouseLeave={() => setHoverVault(false)}
          style={{
            flex: 1, background: hoverVault ? ARC_NAVY : "#ffffff",
            border: `2px solid ${hoverVault ? ARC_NAVY : "#ddd8d0"}`,
            padding: "48px 32px", textAlign: "left", cursor: "pointer",
            transition: "all 0.2s", display: "flex", flexDirection: "column", gap: 16,
          }}>
          <div style={{ fontSize: 40 }}>🗄️</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 300, color: hoverVault ? "#ffffff" : ARC_NAVY, letterSpacing: "0.01em", fontFamily: "Inter, Arial, sans-serif", marginBottom: 8 }}>
              Vault
            </div>
            <div style={{ fontSize: 13, color: hoverVault ? "#b8d4da" : "#9a9088", lineHeight: 1.7, fontFamily: "Inter, Arial, sans-serif" }}>
              Query your building regulations documents. Upload PDFs, index vaults, and ask natural language questions across Approved Documents, British Standards, and NHBC guidance.
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: hoverVault ? AD_GREEN_MID : AD_GREEN, display: "flex", alignItems: "center", gap: 6 }}>
              Open Vault →
            </span>
          </div>
        </button>

        {/* Compare tile */}
        <button className="btn" onClick={() => onSelect("compare")}
          onMouseEnter={() => setHoverCompare(true)}
          onMouseLeave={() => setHoverCompare(false)}
          style={{
            flex: 1, background: hoverCompare ? ARC_TERRACOTTA : "#ffffff",
            border: `2px solid ${hoverCompare ? ARC_TERRACOTTA : "#ddd8d0"}`,
            padding: "48px 32px", textAlign: "left", cursor: "pointer",
            transition: "all 0.2s", display: "flex", flexDirection: "column", gap: 16,
          }}>
          <div style={{ fontSize: 40 }}>⚖️</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 300, color: hoverCompare ? "#ffffff" : ARC_NAVY, letterSpacing: "0.01em", fontFamily: "Inter, Arial, sans-serif", marginBottom: 8 }}>
              Compare
            </div>
            <div style={{ fontSize: 13, color: hoverCompare ? "#f0d0cb" : "#9a9088", lineHeight: 1.7, fontFamily: "Inter, Arial, sans-serif" }}>
              Upload two product datasheets or technical documents. Get a detailed AI comparison of key differences, then check both products against your vault documents for compliance.
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: hoverCompare ? "#f0d0cb" : ARC_TERRACOTTA, display: "flex", alignItems: "center", gap: 6 }}>
              Open Compare →
            </span>
          </div>
        </button>
      </div>
    </div>
  );
}

// ── main app ──────────────────────────────────────────────────────────────────

export default function App() {
  const [appSection, setAppSection] = useState("home"); // "home" | "vault" | "compare"
  const [vaults, setVaults] = useState([]);
  const [selectedVault, setSelectedVault] = useState(null);
  const [queryScope, setQueryScope] = useState("single");
  const [expandedMasters, setExpandedMasters] = useState({});
  const [pdfs, setPdfs] = useState([]);
  const [vaultIndex, setVaultIndex] = useState(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [stage, setStage] = useState(null);
  const [progress, setProgress] = useState({ index: 0, select: 0, read: 0, answer: 0 });
  const [statusMsg, setStatusMsg] = useState("");
  const [creating, setCreating] = useState(false);
  const [newVaultName, setNewVaultName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [costEst, setCostEst] = useState(null);
  const [history, setHistory] = useState([]);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [loadingVaults, setLoadingVaults] = useState(true);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [authenticated, setAuthenticated] = useState(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [tempDocs, setTempDocs] = useState([]);
  const [tempDocDragOver, setTempDocDragOver] = useState(false);
  const [lastQuestion, setLastQuestion] = useState("");
  const [timedOut, setTimedOut] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const fileInputRef = useRef();
  const tempDocInputRef = useRef();

  const PASSWORDS = {
    "4Rawbn11": "user",
    "H8ndh0le": "admin",
  };

  const handleLogin = () => {
    const role = PASSWORDS[passwordInput];
    if (role) {
      setAuthenticated(role);
      setPasswordError(false);
    } else {
      setPasswordError(true);
      setPasswordInput("");
    }
  };

  const loadTempDocs = async (files) => {
    const pdfs = Array.from(files).filter(f => f.type === "application/pdf");
    for (const file of pdfs) {
      const base64 = await fileToBase64(file);
      setTempDocs(prev => {
        if (prev.find(d => d.name === file.name)) return prev;
        return [...prev, { name: file.name, base64 }];
      });
    }
  };

  const isAdmin = authenticated === "admin";

  const vault = (() => {
    for (const v of vaults) {
      if (v.id === selectedVault) return v;
      if (v.type === "master") {
        const sub = (v.subVaults || []).find(sv => sv.id === selectedVault);
        if (sub) return sub;
      }
    }
    return null;
  })();

  const parentMaster = vaults.find(v => v.type === "master" && (v.subVaults || []).some(sv => sv.id === selectedVault));
  const vaultHistory = history.filter(h => h.vaultId === selectedVault);

  useEffect(() => {
    const isStaging = process.env.REACT_APP_API_URL?.includes("staging");
    document.title = isStaging ? "Archimind [Staging]" : "Archimind";
  }, []);

  useEffect(() => { loadVaults(); }, []);

  const loadVaults = async () => {
    setLoadingVaults(true);
    try {
      const data = await api("/api/vaults");
      setVaults(data.vaults || []);
    } catch (e) {
      console.error("Failed to load vaults:", e);
    }
    setLoadingVaults(false);
  };

  useEffect(() => {
    if (!selectedVault) return;
    loadVaultContents(selectedVault);
  }, [selectedVault]);

  const loadVaultContents = async (vaultId) => {
    setAnswer(null);
    setStage(null);
    setStatusMsg("Loading vault…");
    setPdfs([]);
    setVaultIndex(null);
    setConversationHistory([]);

    try {
      const [pdfsData, indexData] = await Promise.all([
        api(`/api/vaults/${encodeURIComponent(vaultId)}/pdfs`),
        api(`/api/vaults/${encodeURIComponent(vaultId)}/index`).catch(() => null),
      ]);
      setPdfs(pdfsData.pdfs || []);
      setVaultIndex(indexData);
      if (indexData) {
        const total = (indexData.documents || []).reduce((s, d) => s + (d.headings?.length || 0), 0);
        setStatusMsg(`✓ Vault ready — ${total} sections indexed across ${pdfsData.pdfs.length} document${pdfsData.pdfs.length !== 1 ? "s" : ""}.`);
      } else {
        setStatusMsg(pdfsData.pdfs.length > 0 ? "Documents loaded — click Index Vault to prepare for questions." : "No documents yet — upload PDFs to get started.");
      }
    } catch (e) {
      setStatusMsg("Error loading vault: " + e.message);
    }
  };

  const createVault = async () => {
    if (!newVaultName.trim()) return;
    try {
      const v = await api("/api/vaults", { method: "POST", body: { name: newVaultName.trim() } });
      await loadVaults();
      setSelectedVault(v.id);
      setNewVaultName("");
      setCreating(false);
    } catch (e) {
      alert("Failed to create vault: " + e.message);
    }
  };

  const addPDFs = useCallback(async (files) => {
    if (!vault) return;
    const pdfFiles = Array.from(files).filter(f => f.type === "application/pdf");
    if (!pdfFiles.length) return;
    setUploadingPdf(true);
    for (const file of pdfFiles) {
      setStatusMsg(`Uploading ${file.name}…`);
      try {
        const base64 = await fileToBase64(file);
        await api(`/api/vaults/${encodeURIComponent(vault.id)}/pdfs`, { method: "POST", body: { name: file.name, base64 } });
      } catch (e) {
        console.error("Upload failed:", e);
        setStatusMsg(`Failed to upload ${file.name}: ${e.message}`);
      }
    }
    setUploadingPdf(false);
    await loadVaultContents(vault.id);
    setVaultIndex(null);
    setStatusMsg("Upload complete — click Index Vault to update the index.");
  }, [vault]);

  const onDrop = (e) => { e.preventDefault(); setDragOver(false); addPDFs(e.dataTransfer.files); };

  const deletePdf = async (pdf) => {
    if (!window.confirm(`Remove "${pdf.name}" from this vault? This cannot be undone.`)) return;
    try {
      await api(`/api/vaults/${encodeURIComponent(vault.id)}/pdfs/${encodeURIComponent(pdf.name)}`, { method: "DELETE" });
      setVaultIndex(null);
      await loadVaultContents(vault.id);
      setStatusMsg(`"${pdf.name}" removed — re-index the vault to update.`);
    } catch (e) {
      setStatusMsg("Failed to remove: " + e.message);
    }
  };

  const extractPdfPages = async (base64, pageIndices) => {
    if (!window.PDFLib) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
        script.onload = resolve; script.onerror = reject;
        document.head.appendChild(script);
      });
    }
    const { PDFDocument } = window.PDFLib;
    const pdfBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const newDoc = await PDFDocument.create();
    const valid = pageIndices.filter(i => i >= 0 && i < srcDoc.getPageCount());
    const copied = await newDoc.copyPages(srcDoc, valid);
    copied.forEach(p => newDoc.addPage(p));
    const bytes = await newDoc.save();
    const uint8 = new Uint8Array(bytes);
    let binary = "";
    for (let b = 0; b < uint8.length; b++) binary += String.fromCharCode(uint8[b]);
    return { base64: btoa(binary), pageCount: srcDoc.getPageCount() };
  };

  const indexOnePdf = async (pdfName, base64) => {
    const SYSTEM = "You are a document indexer. Extract only structural metadata. Return pure JSON only, no markdown, no explanation.";
    const INDEX_PROMPT = `Extract structural headings from this document — chapter titles, numbered sections (e.g. 6.6, 6.6.1), named sub-sections, AND the titles of all numbered tables and figures (e.g. "Table 3 — Fire resistance of cavity barriers", "Figure 24 — Cavity barrier locations"). Include table and figure titles as they are essential navigation landmarks.

Do not extract body text or bullet points.

For pageHint, use only the position of the page within this PDF file — page 1 is the first page of this file, page 2 is the second, etc. Ignore all printed page numbers on the pages.

Output ONLY valid JSON: {"headings": [{"level": 1, "title": "heading text", "pageHint": 1}]}`;

    const tryParse = (text) => {
      const clean = text.replace(/```json|```/g, "").trim();
      try { return JSON.parse(clean); } catch {}
      const m = clean.match(/\{[\s\S]*\}/);
      if (m) try { return JSON.parse(m[0]); } catch {}
      return null;
    };

    const dedupe = (headings) => {
      const map = {};
      for (const h of headings) {
        const key = h.title.toLowerCase().trim();
        if (!map[key] || h.pageHint > map[key].pageHint) map[key] = h;
      }
      return Object.values(map);
    };

    try {
      const { text: result } = await callClaude(
        [{ role: "user", content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 }, title: pdfName },
          { type: "text", text: INDEX_PROMPT }
        ]}],
        SYSTEM, 65000, 2, "gemini-2.5-flash-lite"
      );
      console.log(`Raw index response for ${pdfName} (first 200 chars):`, result.slice(0, 200));
      const parsed = tryParse(result);
      if (parsed?.headings?.length > 0) {
        const deduped = dedupe(parsed.headings);
        console.log(`Indexed ${pdfName}: ${deduped.length} headings`);
        return { headings: deduped };
      }
      console.warn(`${pdfName}: full-PDF index returned no headings, trying chunked…`);
    } catch (e) {
      console.warn(`${pdfName}: full-PDF indexing failed (${e.message}), trying chunked…`);
    }

    try {
      const { pageCount } = await extractPdfPages(base64, [0]);
      const CHUNK_SIZE = 60;
      const numChunks = Math.ceil(pageCount / CHUNK_SIZE);
      const allHeadings = [];
      console.log(`${pdfName}: splitting into ${numChunks} chunks (${pageCount} pages total)`);

      for (let chunk = 0; chunk < numChunks; chunk++) {
        const startPage = chunk * CHUNK_SIZE;
        const endPage = Math.min(startPage + CHUNK_SIZE, pageCount);
        setStatusMsg(`Indexing ${pdfName} — pages ${startPage + 1}–${endPage} of ${pageCount}…`);
        const { base64: chunkBase64 } = await extractPdfPages(base64, Array.from({ length: endPage - startPage }, (_, i) => startPage + i));
        try {
          const chunkPrompt = `Extract structural headings from this document — chapter titles, numbered sections (e.g. 6.6, 6.6.1), named sub-sections, AND the titles of all numbered tables and figures (e.g. "Table 3 — Fire resistance of cavity barriers", "Figure 24 — Cavity barrier locations"). Include table and figure titles as they are essential navigation landmarks.

Do not extract body text or bullet points.

For pageHint, use only the page number within this chunk — page 1 is the first page of this chunk, page 2 is the second, up to page ${endPage - startPage}. Ignore all printed page numbers on the pages completely.

Output ONLY valid JSON: {"headings": [{"level": 1, "title": "heading text", "pageHint": 1}]}`;
          const { text: result } = await callClaude(
            [{ role: "user", content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: chunkBase64 } },
              { type: "text", text: chunkPrompt }
            ]}],
            SYSTEM, 65000, 2, "gemini-2.5-flash-lite"
          );
          const parsed = tryParse(result);
          if (parsed?.headings) {
            const offsetHeadings = parsed.headings.map(h => ({
              ...h,
              pageHint: Math.max(1, (h.pageHint || 1) + startPage)
            }));
            allHeadings.push(...offsetHeadings);
            console.log(`${pdfName} chunk ${chunk + 1}/${numChunks}: ${parsed.headings.length} headings (pages ${startPage + 1}–${endPage})`);
          }
        } catch (e) {
          console.warn(`${pdfName} chunk ${chunk + 1} failed:`, e.message);
          if (e.message?.includes("503") || e.message?.includes("UNAVAILABLE")) {
            try {
              await new Promise(r => setTimeout(r, 3000));
              const { text: result2 } = await callClaude(
                [{ role: "user", content: [
                  { type: "document", source: { type: "base64", media_type: "application/pdf", data: chunkBase64 } },
                  { type: "text", text: chunkPrompt }
                ]}],
                SYSTEM, 65000, 1, "gemini-2.5-flash-lite"
              );
              const parsed2 = tryParse(result2);
              if (parsed2?.headings) {
                allHeadings.push(...parsed2.headings);
                console.log(`${pdfName} chunk ${chunk + 1} retry: ${parsed2.headings.length} headings`);
              }
            } catch (e2) {
              console.warn(`${pdfName} chunk ${chunk + 1} retry also failed:`, e2.message);
            }
          }
        }
      }

      const deduped = dedupe(allHeadings);
      console.log(`Indexed ${pdfName}: ${deduped.length} headings (deduped from ${allHeadings.length})`);
      return { headings: deduped };
    } catch (e) {
      console.warn(`${pdfName}: chunked indexing failed:`, e.message);
      return { headings: [] };
    }
  };

  const indexVault = async () => {
    if (!vault || pdfs.length === 0) return;
    setStage("indexing");
    setProgress({ index: 0, select: 0, read: 0, answer: 0 });
    setStatusMsg("Loading documents for indexing…");
    setAnswer(null);

    try {
      const allDocuments = [];

      for (let i = 0; i < pdfs.length; i++) {
        const pdf = pdfs[i];
        setStatusMsg(`Fetching document ${i + 1} of ${pdfs.length}: ${pdf.name}…`);

        const pdfData = await api(`/api/vaults/${encodeURIComponent(vault.id)}/pdfs/${encodeURIComponent(pdf.name)}`);
        const base64 = pdfData.base64;

        setStatusMsg(`Scanning ${pdf.name}…`);
        setProgress(p => ({ ...p, index: Math.round((i / pdfs.length) * 80) }));

        const { headings } = await indexOnePdf(pdf.name, base64);
        allDocuments.push({ name: pdf.name, headings });
      }

      setProgress(p => ({ ...p, index: 100 }));

      const indexData = { documents: allDocuments, indexedAt: new Date().toISOString() };

      setStatusMsg("Saving index…");
      await api(`/api/vaults/${encodeURIComponent(vault.id)}/index`, { method: "POST", body: indexData });

      setVaultIndex(indexData);
      setStage("done-index");
      const totalHeadings = allDocuments.reduce((s, d) => s + (d.headings?.length || 0), 0);
      setStatusMsg(`✓ Vault indexed — ${totalHeadings} sections mapped across ${allDocuments.length} document${allDocuments.length !== 1 ? "s" : ""}. Ready for questions.`);
    } catch (err) {
      setStage(null);
      setStatusMsg("Indexing failed: " + err.message);
    }
  };

  const indexSinglePdf = async (pdf) => {
    if (!vault) return;
    setStage("indexing");
    setStatusMsg(`Re-indexing ${pdf.name}…`);
    setAnswer(null);
    try {
      const pdfData = await api(`/api/vaults/${encodeURIComponent(vault.id)}/pdfs/${encodeURIComponent(pdf.name)}`);
      const base64 = pdfData.base64;
      const { headings } = await indexOnePdf(pdf.name, base64);
      if (!headings.length) throw new Error("No headings found — document may be too large or unreadable");

      const existingDocs = (vaultIndex?.documents || []).filter(d => d.name !== pdf.name);
      const newIndex = { documents: [...existingDocs, { name: pdf.name, headings }], indexedAt: new Date().toISOString() };

      await api(`/api/vaults/${encodeURIComponent(vault.id)}/index`, { method: "POST", body: newIndex });
      setVaultIndex(newIndex);
      setStage("done-index");
      const total = newIndex.documents.reduce((s, d) => s + (d.headings?.length || 0), 0);
      setStatusMsg(`✓ ${pdf.name} re-indexed — ${headings.length} sections found. ${total} total sections across vault.`);
    } catch (e) {
      setStage(null);
      setStatusMsg(`Re-index failed for ${pdf.name}: ${e.message}`);
    }
  };

  const buildCombinedIndex = async () => {
    if (!parentMaster) return vaultIndex;
    const subVaults = parentMaster.subVaults || [];
    const combinedDocs = [];
    for (const sv of subVaults) {
      try {
        const idx = await api(`/api/vaults/${encodeURIComponent(sv.id)}/index`).catch(() => null);
        if (idx?.documents) {
          idx.documents.forEach(doc => {
            combinedDocs.push({ ...doc, name: `${sv.name} >> ${doc.name}`, vaultId: sv.id, originalName: doc.name });
          });
        }
      } catch (_) {}
    }
    return combinedDocs.length > 0 ? { documents: combinedDocs } : vaultIndex;
  };

  // ── temp doc direct question ─────────────────────────────────────────────────
  const askTempDocQuestion = async () => {
    if (!tempDocs.length || !question.trim()) return;
    const q = question.trim();
    setAnswer(null);
    setQuestion("");
    setLastQuestion(q);
    setStage("answering");
    setStatusMsg("Reading document…");
    try {
      const docBlocks = tempDocs.map(d => ({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: d.base64 },
        title: d.name,
      }));
      const { text: finalAnswer } = await callClaude(
        [{ role: "user", content: [
          ...docBlocks,
          { type: "text", text: `You are an expert consultant. Answer the following question using ONLY the provided document${tempDocs.length > 1 ? "s" : ""}. Be thorough and precise. If the documents do not contain relevant information, say so clearly.\n\nQUESTION: ${q}` }
        ]}],
        "You are an expert consultant. Answer using only the provided documents.",
        65536, 2, "gemini-2.5-flash", 240000
      );
      setAnswer(finalAnswer);
      setStage("done");
      setStatusMsg("Answer ready.");
    } catch (err) {
      setStage(null);
      setStatusMsg("Error: " + err.message);
    }
  };

  const askQuestion = async () => {
    if ((!vaultIndex && !tempDocs.length) || !question.trim()) return;
    const q = question.trim();
    setAnswer(null);
    setCostEst(null);
    setQuestion("");
    setLastQuestion(q);
    setTimedOut(false);
    setStage("selecting");
    setProgress({ index: 100, select: 0, read: 0, answer: 0 });
    setStatusMsg("Pass 1/3 · Reading contents pages and scoring sections…");

    try {
      const useAllSubVaults = queryScope === "all" && parentMaster;
      const activeIndex = useAllSubVaults ? await buildCombinedIndex() : vaultIndex;

      setStatusMsg("Pass 1/3 · Scoring index — identifying relevant sections…");

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

      const indexSummary = (activeIndex.documents || []).map(doc => {
        const contentsPages = new Set(
          (doc.headings || [])
            .filter(h => /^(contents|table of contents|index)$/i.test(h.title.trim()))
            .map(h => h.pageHint)
        );
        const pageFrequency = {};
        (doc.headings || []).forEach(h => {
          const p = h.pageHint || 1;
          pageFrequency[p] = (pageFrequency[p] || 0) + 1;
        });
        const crowdedPages = new Set(
          Object.entries(pageFrequency)
            .filter(([, count]) => count > 8)
            .map(([page]) => Number(page))
        );
        const headings = (doc.headings || [])
          .filter(h => !isBoilerplate(h.title))
          .filter(h => !contentsPages.has(h.pageHint))
          .filter(h => !crowdedPages.has(h.pageHint))
          .map(h => `  p${h.pageHint || 1}: ${h.title}`)
          .join("\n");
        return `DOCUMENT: ${doc.name}\n${headings}`;
      }).join("\n\n");

      setProgress(p => ({ ...p, select: 30 }));

      const recentHistory = conversationHistory.slice(-5);
      const conversationContext = recentHistory.length > 0
        ? `\n\nCONVERSATION HISTORY (this is a continuing conversation — the current question may be a follow-up to earlier questions):\n${recentHistory.map((h, i) => `Q${i+1}: ${h.question}\nA${i+1}: ${h.answer.slice(0, 600)}…`).join("\n\n")}`
        : "";

      const scoringPrompt = `You are an expert technical document analyst. Using ONLY the document index below, identify which specific sections and pages are most likely to contain the answer to the question.

DOCUMENT INDEX (headings, sections and page numbers extracted from vault documents):
${indexSummary}
${conversationContext}

QUESTION: ${q}
${recentHistory.length > 0 ? "NOTE: This may be a follow-up question. Use the conversation history above to understand the full context before scoring." : ""}

Analyse the index carefully. For every section that could possibly be relevant — even tangentially — assign a probability score. Building regulations frequently contain cross-references, exceptions and caveats in unexpected sections. Be CONSERVATIVE — it is better to include a borderline section than to miss critical information.

NOTE: Select ALL sections that are relevant to the question — do not limit to just one section if multiple sections are relevant.

TABLES AND FIGURES: If the question relates to a requirement that is likely defined or quantified in a table or figure (e.g. fire resistance ratings, dimensions, classifications), you MUST also select any table or figure entries in the index that are likely to contain that data. For example, if the index contains "Table 3 — Fire resistance of cavity barriers" or "Table 5 — Minimum fire resistance", select those entries with high probability. Never rely solely on clause text pages when the actual values are in a table.

Respond ONLY as compact JSON — no other text, no explanations, no reasons:
{
  "selectedDocs": [
    {
      "docName": "exact filename from index",
      "sections": [
        {"heading": "exact heading from index", "pageHint": 42, "probability": 0.95}
      ]
    }
  ]
}

Rules:
- Include sections with probability > 0.5
- pageHint MUST be a plain integer. Never use "p.12" or "page 12". Use 1 if unknown.
- Omit "styleNotes", "reason" and "crossRefs" fields entirely — keep JSON compact`;

      const { text: scoringText, usage: scoringUsage } = await callClaude(
        [{ role: "user", content: scoringPrompt }],
        "You are a technical document analyst. Score document sections for relevance using only the text index provided. Return pure JSON only, no markdown.",
        65000, 2, "gemini-2.5-flash"
      );

      setProgress(p => ({ ...p, select: 100 }));

      let scoring = { selectedDocs: [] };
      try {
        const clean = scoringText.replace(/```json|```/g, "").trim();
        scoring = JSON.parse(clean);
      } catch {
        const m = scoringText.match(/\{[\s\S]*\}/);
        if (m) try { scoring = JSON.parse(m[0]); } catch {}
      }

      if (!scoring.selectedDocs || scoring.selectedDocs.length === 0) {
        console.warn("Scoring returned empty — raw response:", scoringText.slice(0, 500));
      }
      console.log("Scoring result:", JSON.stringify(scoring).slice(0, 1000));
      console.log("Selected docs:", (scoring.selectedDocs || []).length);
      (scoring.selectedDocs || []).forEach(d => {
        console.log("Doc:", d.docName, "Sections:", (d.sections || []).length);
        (d.sections || []).forEach(s => {
          console.log("  Section:", s.heading?.slice(0, 50), "pageHint:", s.pageHint, "prob:", s.probability);
        });
      });

      setStatusMsg("Pass 1/3 · Loading documents for page extraction…");

      const contentsData = [];
      const selectedDocNames = (scoring.selectedDocs || []).map(d => d.docName);

      if (useAllSubVaults) {
        console.log("All-subvaults mode — selectedDocNames from scoring:", selectedDocNames);
        const allSubVaultPdfs = [];
        for (const sv of (parentMaster.subVaults || [])) {
          try {
            const pdfsData = await api(`/api/vaults/${encodeURIComponent(sv.id)}/pdfs`);
            for (const pdf of (pdfsData.pdfs || [])) {
              allSubVaultPdfs.push({
                prefixedName: `${sv.name} >> ${pdf.name}`,
                subVault: sv,
                fileName: pdf.name,
              });
            }
          } catch (e) {
            console.warn(`Could not list PDFs for sub-vault ${sv.name}:`, e);
          }
        }
        console.log("All sub-vault PDFs available:", allSubVaultPdfs.map(p => p.prefixedName));

        for (const docName of selectedDocNames) {
          if (contentsData.find(c => c.pdf.name === docName)) continue;
          let found = allSubVaultPdfs.find(p => p.prefixedName === docName);
          if (!found) {
            const filenamePart = docName.includes(">>") ? docName.split(">>").pop().trim()
              : docName.includes("]") ? docName.split("]").pop().trim()
              : docName;
            found = allSubVaultPdfs.find(p =>
              p.fileName === filenamePart ||
              p.fileName.includes(filenamePart) ||
              filenamePart.includes(p.fileName)
            );
          }
          if (!found) {
            const lower = docName.toLowerCase();
            found = allSubVaultPdfs.find(p =>
              p.prefixedName.toLowerCase().includes(lower) ||
              lower.includes(p.fileName.toLowerCase().replace(/\.pdf$/i, ""))
            );
          }
          if (!found) {
            console.warn(`Could not match scoring docName "${docName}" to any sub-vault PDF`);
            continue;
          }
          console.log(`Matched "${docName}" to ${found.subVault.name}/${found.fileName}`);
          try {
            const pdfData = await api(`/api/vaults/${encodeURIComponent(found.subVault.id)}/pdfs/${encodeURIComponent(found.fileName)}`);
            contentsData.push({ pdf: { name: found.prefixedName, size: 0 }, base64: pdfData.base64 });
          } catch (e) {
            console.warn(`Could not load ${found.fileName} from ${found.subVault.name}:`, e);
          }
        }
        console.log("contentsData loaded:", contentsData.map(c => c.pdf.name));
      } else {
        const docsNeeded = pdfs.filter(p =>
          selectedDocNames.some(n => p.name.includes(n) || n.includes(p.name))
        );
        const docsToFetch = docsNeeded.length > 0 ? docsNeeded : pdfs.slice(0, 2);

        for (const pdf of docsToFetch) {
          try {
            const pdfData = await api(`/api/vaults/${encodeURIComponent(vault.id)}/pdfs/${encodeURIComponent(pdf.name)}`);
            contentsData.push({ pdf, base64: pdfData.base64 });
          } catch (e) {
            console.warn(`Could not load ${pdf.name}:`, e);
          }
        }
      }

      setStage("reading");
      setStatusMsg("Pass 2/3 · Extracting specific relevant pages only…");

      const parsePageNums = (hint) => {
        const pages = new Set();
        if (hint === null || hint === undefined) return pages;
        if (typeof hint === "number") {
          if (hint > 0 && hint < 9999) pages.add(Math.round(hint));
          return pages;
        }
        const str = String(hint).trim();
        if (!str) return pages;
        const directInt = parseInt(str);
        if (!isNaN(directInt) && directInt > 0 && directInt < 9999) {
          pages.add(directInt);
          return pages;
        }
        const allNums = str.match(/\d+/g);
        if (!allNums) return pages;
        const nums = allNums.map(n => parseInt(n)).filter(n => n > 0 && n < 9999);
        if (nums.length === 0) return pages;
        if (nums.length >= 2 && nums[1] > nums[0] && nums[1] <= nums[0] + 30) {
          for (let i = nums[0]; i <= nums[1]; i++) pages.add(i);
          return pages;
        }
        nums.forEach(n => pages.add(n));
        return pages;
      };

      const HARD_PAGE_BUDGET = 80;
      const allScoredSections = [];

      (scoring.selectedDocs || []).forEach(selectedDoc => {
        const matchedDoc = contentsData.find(d =>
          d.pdf.name.includes(selectedDoc.docName) || selectedDoc.docName.includes(d.pdf.name)
        );
        if (!matchedDoc) return;
        (selectedDoc.sections || []).forEach(section => {
          const parsed = parsePageNums(section.pageHint);
          if (parsed.size > 0) {
            allScoredSections.push({
              docName: matchedDoc.pdf.name,
              contentsDoc: matchedDoc,
              pages: parsed,
              probability: section.probability || 0,
              heading: section.heading,
            });
          }
        });
      });

      allScoredSections.sort((a, b) => b.probability - a.probability);

      const docPageMap = {};
      let budgetRemaining = HARD_PAGE_BUDGET;

      const uniqueDocs = [...new Set(allScoredSections.map(s => s.docName))];
      const numDocs = Math.max(uniqueDocs.length, 1);
      const perDocBudget = Math.floor(HARD_PAGE_BUDGET / numDocs);

      for (const docName of uniqueDocs) {
        const docSections = allScoredSections.filter(s => s.docName === docName);
        let docBudget = perDocBudget;
        for (const section of docSections) {
          if (docBudget <= 0 || budgetRemaining <= 0) break;
          if (!docPageMap[docName]) docPageMap[docName] = { contentsDoc: section.contentsDoc, pages: new Set() };
          const pagesToAdd = [];
          const isTableSection = /^(table|figure)\s+\d+/i.test(section.heading || "");
          const lookahead = isTableSection ? [0, 1, 2, 3] : [0, 1];
          section.pages.forEach(p => {
            lookahead.forEach(offset => {
              const pg = p + offset;
              if (pg > 0 && !docPageMap[docName].pages.has(pg)) pagesToAdd.push(pg);
            });
          });
          pagesToAdd.sort((a, b) => a - b);
          for (const p of pagesToAdd) {
            if (docBudget <= 0 || budgetRemaining <= 0) break;
            docPageMap[docName].pages.add(p);
            docBudget--;
            budgetRemaining--;
          }
        }
      }

      if (budgetRemaining > 0) {
        for (const section of allScoredSections) {
          if (budgetRemaining <= 0) break;
          const key = section.docName;
          if (!docPageMap[key]) docPageMap[key] = { contentsDoc: section.contentsDoc, pages: new Set() };
          const pagesToAdd = [];
          section.pages.forEach(p => {
            [0, 1].forEach(offset => {
              const pg = p + offset;
              if (pg > 0 && !docPageMap[key].pages.has(pg)) pagesToAdd.push(pg);
            });
          });
          pagesToAdd.sort((a, b) => a - b);
          for (const p of pagesToAdd) {
            if (budgetRemaining <= 0) break;
            if (!docPageMap[key].pages.has(p)) {
              docPageMap[key].pages.add(p);
              budgetRemaining--;
            }
          }
        }
      }

      if (Object.keys(docPageMap).length === 0 && contentsData.length > 0) {
        contentsData.slice(0, 2).forEach(d => {
          docPageMap[d.pdf.name] = { contentsDoc: d, pages: new Set() };
          for (let i = 1; i <= 5; i++) docPageMap[d.pdf.name].pages.add(i);
        });
      }

      Object.entries(docPageMap).forEach(([key, val]) => {
        if (val.pages.size === 0) {
          for (let i = 1; i <= 5; i++) val.pages.add(i);
        }
      });

      const pagesUsed = HARD_PAGE_BUDGET - budgetRemaining;
      console.log(`Page budget used: ${pagesUsed}/${HARD_PAGE_BUDGET} pages across ${Object.keys(docPageMap).length} documents`);

      const docBlocks = [];
      let totalPagesExtracted = 0;

      for (const [docName, { contentsDoc, pages }] of Object.entries(docPageMap)) {
        setStatusMsg(`Pass 2/3 · Extracting pages from ${docName}…`);
        const pageList = Array.from(pages).sort((a, b) => a - b);
        if (pageList.length === 0) continue;
        try {
          const result = await api("/api/extract-pages", {
            method: "POST",
            body: { base64: contentsDoc.base64, pages: pageList }
          });
          totalPagesExtracted += result.pagesExtracted;
          docBlocks.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: result.base64 },
            title: `${docName} — pages ${result.pageNumbers.join(", ")}`,
          });
          console.log(`Extracted ${result.pagesExtracted} pages from ${docName}`);
        } catch (e) {
          console.warn(`Page extraction failed for ${docName}, skipping:`, e.message);
        }
      }

      if (tempDocs.length > 0) {
        tempDocs.forEach(d => {
          docBlocks.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: d.base64 },
            title: `TEMPORARY DOCUMENT (not in vault): ${d.name}`,
          });
        });
        console.log(`Temp docs included: ${tempDocs.map(d => d.name).join(", ")}`);
      }

      setStatusMsg(`Pass 2/3 · ${totalPagesExtracted} specific pages extracted across ${docBlocks.length} document${docBlocks.length !== 1 ? "s" : ""}…`);
      setProgress(p => ({ ...p, read: 100 }));

      setStage("answering");
      setStatusMsg("Pass 3/3 · Deep reading selected pages and synthesising answer…");

      const focusSections = (scoring.selectedDocs || [])
        .flatMap(d => (d.sections || []).map(s => `${d.docName}: ${s.heading} (p.${s.pageHint})`))
        .join("; ");

      const priorContext = conversationHistory.slice(-5);
      const contextBlock = priorContext.length > 0
        ? `CONVERSATION SO FAR — this question is part of a continuing discussion. Build on what has already been established rather than starting fresh. Do not repeat information already covered unless directly relevant to this new question.\n\n${priorContext.map((h, i) => `Question ${i+1}: ${h.question}\nAnswer ${i+1}: ${h.answer.slice(0, 1000)}`).join("\n\n---\n\n")}\n\n---\n\n`
        : "";

      const answerPrompt = `You are an expert building regulations consultant at an architectural practice. Use ONLY the provided document pages to answer.${tempDocs.length > 0 ? `\n\nNOTE: ${tempDocs.length} temporary document${tempDocs.length > 1 ? "s have" : " has"} been included for reference: ${tempDocs.map(d => d.name).join(", ")}. These are not part of the permanent vault — treat them as additional reference documents when answering.` : ""}

${contextBlock}CURRENT QUESTION: ${q}

PRIORITY SECTIONS: ${focusSections || "all sections"}

---

TABLES — GLOBAL RULE (applies to every section):
When multiple documents contain tables that are near-identical in structure and content (e.g. minimum fire resistance performance tables across different versions of the same standard), do NOT reproduce each one separately. Instead:
1. Reproduce the single most complete and relevant version in full
2. After the citation, add a plain italic note: *Note: [Other Document] [Table X] contains equivalent/near-identical data. [Note any meaningful differences, e.g. if one table lacks a cavity barrier row.]*

For the one table you reproduce:
1. Output the table title on its own line in bold: **Table X — Title of table**
2. Reproduce the COMPLETE table — EVERY row, EVERY column, NO exceptions. Do not extract only the relevant row. Do not summarise. If the table has 30 rows, output all 30 rows. Every row starts and ends with | pipe characters.
3. After the header row output a separator row: | --- | --- | --- |
4. For the specific row(s) that directly answer the question, prefix that ENTIRE ROW with >> ONCE at the very start, before the first pipe: >> | cell | cell | cell |
   CRITICAL: The >> prefix appears ONCE at the start of the row only. Do NOT put >> before each cell.
5. Do NOT wrap tables in > block quote syntax
6. Place the citation immediately below the table, then the equivalence note
7. If the table spans multiple pages, combine ALL parts into one complete table — do not stop at the first page

If only one table is referenced, reproduce it in full without any equivalence note.

RESPONSE FORMAT — output in this exact order every time:

## Summary

WRITE THIS FIRST. A confident, definitive answer in 2–4 sentences. Must:
- Open with a direct answer in plain English
- Cite ALL relevant documents provided — not just one
- Build on any prior conversation context where relevant
- Reproduce any table directly relevant to the answer
- After any table include footnotes/qualifications as plain italic text

For each key fact, include the exact supporting phrase and citation as a consecutive pair:

> "Exact short phrase from document."
*Document Name | Page X | X.X.X Clause Title (Parent Section Title)*

CITATION FORMAT: *Document | Page X | Clause number and title (Parent section title)*
CRITICAL: Citation MUST start AND end with * asterisk.

CITATION PLACEMENT — strictly follow these rules:
- Every citation goes on its OWN LINE, never embedded within a sentence
- Never write: "Quote." *Citation* and more text continues here.
- Never chain citations with "and": *Citation A* and *Citation B* — WRONG
- If multiple documents support the same fact, each citation goes on its own separate line:
  > "Quote."
  *Document A | Page X | Clause*
  *Document B | Page Y | Clause*
- A citation always ends a paragraph, never appears mid-sentence

PAGE NUMBERS: Use the printed page number visible on the extracted page. Do NOT count from the start of the PDF file — British Standards have front matter so PDF position ≠ printed page number. Omit if not clearly visible.

---

## Detailed Analysis

WRITE THIS SECOND. Only content that adds value beyond the summary.

Check ALL of the following — if ANY apply, write Case 2:
- Location/scenario-specific requirements beyond the general rule?
- Exceptions or conditions where the rule does NOT apply?
- Construction/specification requirements beyond the fire rating?
- Cross-references to other clauses, standards, or ADs?
- Do the multiple documents differ or add to each other?
- Inspection, testing, or certification requirements?

CASE 1 — Only if ALL checks negative: "The summary above fully addresses this question."

CASE 2 — Concise bullet points. One sentence each. Reproduce any referenced table in full below the bullet. Citation after each bullet or table:
*Document Name | Page X | X.X.X Clause Title (Parent Section Title)*

RULES:
- No repetition of summary content
- Citations: opening AND closing * required
- Page numbers: printed page only, never PDF position
- Cite ALL documents where relevant — never rely on just one
- Maximum 6 bullets

---

## Regulatory Context

WRITE THIS THIRD. Broader background tightly scoped to the question. 2–4 bullets maximum.
Citation after each bullet: *Document Name | Page X | X.X.X Clause Title (Parent Section Title)*
If nothing to add: "No additional context required."

---

## Contradictions & Conflicts

WRITE THIS LAST. Conflicts: state conflict, quote both sides with citations, give practical conclusion.
No conflicts: "No contradictions identified."

---

RULES:
- Fixed order: Summary, Detailed Analysis, Regulatory Context, Contradictions
- Use ONLY the provided document pages — no external knowledge
- Every factual statement needs a citation with opening AND closing asterisks
- Draw from ALL provided documents — never rely on just one
- Omit citations rather than guess page numbers`;

      const { text: finalAnswer, usage: answerUsage } = await callClaude(
        [{ role: "user", content: [...docBlocks, { type: "text", text: answerPrompt }] }],
        `You are an expert building regulations consultant. Answer using ONLY the provided document pages. Always output in this exact order: (1) ## Summary, (2) ## Detailed Analysis, (3) ## Regulatory Context, (4) ## Contradictions & Conflicts. Never change this order. Every citation MUST start and end with asterisks: *Document | Page X | Clause (Section)*. Draw from ALL provided documents.`,
        65536
      );

      setProgress(p => ({ ...p, answer: 100 }));
      setAnswer(finalAnswer);
      setStage("done");
      setHistory(prev => [...prev, { vaultId: vault.id, question: q, answer: finalAnswer, timestamp: new Date() }]);
      setConversationHistory(prev => [...prev, { question: q, answer: finalAnswer }]);

      const GEMINI_INPUT_PRICE_USD = 0.15;
      const GEMINI_OUTPUT_PRICE_USD = 0.60;
      const USD_TO_GBP = 0.79;
      const totalInput = (scoringUsage?.input_tokens || 0) + (answerUsage?.input_tokens || 0);
      const totalOutput = (scoringUsage?.output_tokens || 0) + (answerUsage?.output_tokens || 0);
      const costGBP = ((totalInput / 1_000_000) * GEMINI_INPUT_PRICE_USD + (totalOutput / 1_000_000) * GEMINI_OUTPUT_PRICE_USD) * USD_TO_GBP;
      console.log(`Token usage — input: ${totalInput}, output: ${totalOutput}, cost: £${costGBP.toFixed(6)}`);
      setCostEst(costGBP);
      setStatusMsg("Answer ready");
    } catch (err) {
      setStage(null);
      if (err.message === "TIMEOUT") {
        setTimedOut(true);
        setStatusMsg("Request timed out — Gemini is experiencing high traffic.");
      } else if (err.message && err.message.includes('rate_limit')) {
        setStatusMsg('Rate limit reached — retrying automatically in 15 seconds…');
      } else {
        setStatusMsg("Error: " + err.message);
      }
    }
  };

  const isRunning = ["indexing", "selecting", "reading", "answering"].includes(stage);

  const toggleMaster = (masterId) => {
    setExpandedMasters(prev => ({ ...prev, [masterId]: !prev[masterId] }));
  };

  const selectVault = (vaultId) => {
    setSelectedVault(vaultId);
    setAnswer(null);
    setStage(null);
    setCostEst(null);
    setQueryScope("single");
  };

  // ── render ─────────────────────────────────────────────────────────────────

  const globalStyles = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #f5f3f0; } ::-webkit-scrollbar-thumb { background: #c8c0b8; border-radius: 2px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    .vault-item { cursor: pointer; transition: all 0.2s; }
    .vault-item:hover { background: #f0f5f6 !important; }
    .master-item { cursor: pointer; transition: all 0.2s; }
    .master-item:hover { background: rgba(0,0,0,0.04) !important; }
    .btn { cursor: pointer; transition: all 0.2s; border: none; font-family: Inter, Arial, sans-serif; letter-spacing: 0.01em; }
    .btn:hover { opacity: 0.85; }
    .btn:disabled { cursor: not-allowed; opacity: 0.35; }
    .arc-input:focus { outline: 2px solid #0d6478; outline-offset: 0; }
    body { font-family: Inter, Arial, sans-serif; }
  `;

  // ── login screen ─────────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <div style={{ fontFamily: "Arial, sans-serif", background: "#f3f2f1", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <style>{globalStyles}</style>
        <div style={{ background: ARC_NAVY, padding: "20px 40px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ color: "#ffffff", fontSize: 22, fontWeight: 300, letterSpacing: "0.02em", fontFamily: "Inter, Arial, sans-serif" }}>Architectus</span>
          <span style={{ color: "#7a9aaa", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase" }}>Document Intelligence</span>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: ARC_STONE }}>
          <div style={{ background: "#ffffff", padding: "48px 48px", width: 400, borderTop: `3px solid ${ARC_TERRACOTTA}` }}>
            <p style={{ fontSize: 11, color: "#9a9088", marginBottom: 32, letterSpacing: "0.1em", textTransform: "uppercase" }}>Secure Access</p>
            <label style={{ fontSize: 12, fontWeight: 500, color: ARC_NAVY, display: "block", marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase" }}>Password</label>
            <input
              type="password"
              value={passwordInput}
              onChange={e => { setPasswordInput(e.target.value); setPasswordError(false); }}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              autoFocus
              className="arc-input"
              style={{ width: "100%", border: passwordError ? `1px solid ${ARC_TERRACOTTA}` : `1px solid #ccc`, padding: "12px 14px", fontSize: 14, marginBottom: 6, outline: "none", fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY }}
            />
            {passwordError && <p style={{ color: ARC_TERRACOTTA, fontSize: 12, marginBottom: 16, letterSpacing: "0.02em" }}>Incorrect password. Please try again.</p>}
            <button className="btn" onClick={handleLogin}
              style={{ marginTop: 20, width: "100%", background: ARC_NAVY, color: "#ffffff", padding: "12px 0", fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── main UI ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "Arial, sans-serif", background: "#f3f2f1", minHeight: "100vh", color: "#0b0c0c", display: "flex", flexDirection: "column" }}>
      <style>{globalStyles}</style>

      {showManageModal && (
        <VaultManagementModal
          vaults={vaults}
          onClose={() => setShowManageModal(false)}
          onRefresh={async () => { await loadVaults(); }}
          isAdmin={isAdmin}
        />
      )}

      {/* Top nav */}
      <div style={{ background: ARC_NAVY, padding: "0 40px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, height: 56 }}>
        {/* Left: logo + section nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <button className="btn" onClick={() => setAppSection("home")}
            style={{ background: "none", padding: 0, color: "#ffffff", fontSize: 20, fontWeight: 300, letterSpacing: "0.02em", fontFamily: "Inter, Arial, sans-serif" }}>
            Architectus
          </button>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="btn" onClick={() => setAppSection("vault")}
              style={{ background: appSection === "vault" ? "rgba(255,255,255,0.12)" : "none", color: appSection === "vault" ? "#ffffff" : "#7a9aaa", padding: "6px 14px", fontSize: 12, fontWeight: appSection === "vault" ? 600 : 400, letterSpacing: "0.06em", textTransform: "uppercase", border: "none" }}>
              Vault
            </button>
            <button className="btn" onClick={() => setAppSection("compare")}
              style={{ background: appSection === "compare" ? "rgba(255,255,255,0.12)" : "none", color: appSection === "compare" ? "#ffffff" : "#7a9aaa", padding: "6px 14px", fontSize: 12, fontWeight: appSection === "compare" ? 600 : 400, letterSpacing: "0.06em", textTransform: "uppercase", border: "none" }}>
              Compare
            </button>
          </div>
        </div>
        {/* Right: role badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ color: "#7a9aaa", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>Document Intelligence</span>
          <span style={{ fontSize: 10, color: isAdmin ? ARC_TERRACOTTA : "#7a9aaa", letterSpacing: "0.1em", textTransform: "uppercase", border: `1px solid ${isAdmin ? ARC_TERRACOTTA : "#3a5a6a"}`, padding: "2px 8px" }}>
            {isAdmin ? "Admin" : "User"}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden", maxHeight: "calc(100vh - 56px)" }}>

        {/* ── HOME landing page ─────────────────────────────────────────────── */}
        {appSection === "home" && (
          <LandingPage onSelect={setAppSection} isAdmin={isAdmin} />
        )}

        {/* ── COMPARE section ───────────────────────────────────────────────── */}
        {appSection === "compare" && (
          <CompareSection vaults={vaults} isAdmin={isAdmin} />
        )}

        {/* ── VAULT section ─────────────────────────────────────────────────── */}
        {appSection === "vault" && (
          <>
            {/* sidebar */}
            <div style={{ width: 260, borderRight: "1px solid #e8e0d5", background: ARC_STONE, display: "flex", flexDirection: "column", flexShrink: 0 }}>

              <div style={{ padding: "20px 24px 8px", fontSize: 10, color: "#9a9088", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", borderBottom: "1px solid #ddd8d0" }}>Vaults</div>

              <div style={{ flex: 1, overflowY: "auto" }}>
                {loadingVaults ? (
                  <div style={{ padding: 16, display: "flex", alignItems: "center", gap: 8, color: "#9a9088", fontSize: 12 }}><Spinner size={12} /> Loading…</div>
                ) : vaults.map(v => {
                  if (v.type === "master") {
                    const isExpanded = !!expandedMasters[v.id];
                    return (
                      <div key={v.id}>
                        <div className="master-item"
                          onClick={() => toggleMaster(v.id)}
                          style={{ padding: "10px 24px", display: "flex", alignItems: "center", gap: 8, borderLeft: "3px solid transparent" }}>
                          <span style={{ fontSize: 10, color: "#9a9088", transition: "transform 0.15s", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▶</span>
                          <span style={{ fontSize: 13, color: ARC_NAVY, fontWeight: 500, letterSpacing: "0.01em", flex: 1 }}>{v.name}</span>
                          <span style={{ fontSize: 10, color: "#b0a8a0" }}>{(v.subVaults || []).length}</span>
                        </div>
                        {isExpanded && (v.subVaults || []).map(sv => (
                          <div key={sv.id} className="vault-item"
                            onClick={() => selectVault(sv.id)}
                            style={{
                              padding: "9px 24px 9px 44px",
                              background: selectedVault === sv.id ? "#ffffff" : "transparent",
                              borderLeft: selectedVault === sv.id ? `3px solid ${ARC_TERRACOTTA}` : "3px solid transparent",
                              display: "flex", alignItems: "center", gap: 6,
                            }}>
                            <span style={{ fontSize: 10, color: "#b0a8a0" }}>📄</span>
                            <span style={{ fontSize: 12, color: ARC_NAVY, fontWeight: selectedVault === sv.id ? 600 : 400, letterSpacing: "0.01em" }}>{sv.name}</span>
                          </div>
                        ))}
                        {isExpanded && (v.subVaults || []).length === 0 && (
                          <div style={{ padding: "6px 24px 6px 44px", fontSize: 11, color: "#b0a8a0", fontStyle: "italic" }}>No sub-vaults yet</div>
                        )}
                      </div>
                    );
                  } else {
                    return (
                      <div key={v.id} className="vault-item"
                        onClick={() => selectVault(v.id)}
                        style={{ padding: "12px 24px", background: selectedVault === v.id ? "#ffffff" : "transparent", borderLeft: selectedVault === v.id ? `3px solid ${ARC_TERRACOTTA}` : "3px solid transparent" }}>
                        <div style={{ fontSize: 13, color: ARC_NAVY, fontWeight: selectedVault === v.id ? 600 : 400, letterSpacing: "0.01em" }}>{v.name}</div>
                      </div>
                    );
                  }
                })}
              </div>

              {/* Temp doc upload */}
              <div style={{ borderTop: "1px solid #ddd8d0", padding: "12px 24px" }}>
                <div style={{ padding: "10px 0" }}>
                  <div style={{ fontSize: 9, color: "#9a9088", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Temporary Documents</div>
                  {tempDocs.map((d, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, background: "#fdf5f3", border: `1px solid ${ARC_TERRACOTTA}`, padding: "6px 10px", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: ARC_TERRACOTTA, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📄 {d.name}</span>
                      <button className="btn" onClick={() => setTempDocs(prev => prev.filter((_, j) => j !== i))} title="Remove"
                        style={{ background: "none", color: ARC_TERRACOTTA, fontSize: 14, padding: "0 2px", fontWeight: 700, lineHeight: 1, flexShrink: 0 }}>×</button>
                    </div>
                  ))}
                  <div
                    onDragOver={e => { e.preventDefault(); setTempDocDragOver(true); }}
                    onDragLeave={() => setTempDocDragOver(false)}
                    onDrop={e => { e.preventDefault(); setTempDocDragOver(false); loadTempDocs(e.dataTransfer.files); }}
                    onClick={() => tempDocInputRef.current.click()}
                    style={{ border: `1px dashed ${tempDocDragOver ? AD_GREEN : "#ccc"}`, padding: "8px 12px", background: tempDocDragOver ? "#f0f5f6" : "transparent", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: tempDocs.length ? 4 : 0 }}>
                    <span style={{ fontSize: 12, opacity: 0.4 }}>📎</span>
                    <span style={{ fontSize: 11, color: ARC_NAVY, letterSpacing: "0.01em" }}>Add PDF{tempDocs.length ? "s" : ""}</span>
                  </div>
                  <p style={{ fontSize: 10, color: "#b0a8a0", marginTop: 6, lineHeight: 1.5, letterSpacing: "0.02em" }}>Temporary — will not be saved. Included in all questions.</p>
                  <input ref={tempDocInputRef} type="file" accept="application/pdf" multiple style={{ display: "none" }} onChange={e => { if (e.target.files.length) loadTempDocs(e.target.files); }} />
                </div>
              </div>

              {/* Admin controls */}
              {isAdmin && (
                <div style={{ borderTop: "1px solid #ddd8d0", padding: "12px 24px", display: "flex", flexDirection: "column", gap: 8 }}>
                  {creating ? (
                    <div style={{ background: "#f5f3f0", padding: "12px" }}>
                      <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", display: "block", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>New Vault Name</label>
                      <input value={newVaultName} onChange={e => setNewVaultName(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && createVault()}
                        placeholder="Name" autoFocus className="arc-input"
                        style={{ width: "100%", border: `1px solid #ccc`, padding: "7px 10px", fontSize: 13, color: ARC_NAVY, marginBottom: 8, outline: "none", background: "#fff", fontFamily: "Inter, Arial, sans-serif" }} />
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn" onClick={createVault} style={{ background: ARC_NAVY, color: "#fff", padding: "6px 14px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Create</button>
                        <button className="btn" onClick={() => setCreating(false)} style={{ background: "transparent", color: "#9a9088", padding: "6px 10px", fontSize: 11, border: "1px solid #ccc" }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button className="btn" onClick={() => setCreating(true)}
                      style={{ width: "100%", background: "transparent", color: ARC_NAVY, padding: "8px 0", fontSize: 11, fontWeight: 600, textAlign: "center", border: `1px solid ${ARC_NAVY}`, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      + New Vault
                    </button>
                  )}
                  <button className="btn" onClick={() => setShowManageModal(true)}
                    style={{ width: "100%", background: "transparent", color: "#9a9088", padding: "7px 0", fontSize: 11, fontWeight: 500, textAlign: "center", border: "1px solid #ccc", letterSpacing: "0.04em" }}>
                    Manage Vaults
                  </button>
                </div>
              )}
            </div>

            {/* main vault panel */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#faf8f5" }}>
              {!vault ? (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  {!tempDocs.length ? (
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <p style={{ fontSize: 20, color: ARC_NAVY, fontWeight: 300, letterSpacing: "0.02em" }}>Select a vault</p>
                      <p style={{ fontSize: 12, color: "#9a9088", letterSpacing: "0.04em" }}>Upload documents and query building regulations</p>
                    </div>
                  ) : (
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                      <div style={{ background: "#ffffff", borderBottom: "1px solid #e8e0d5", padding: "20px 32px", flexShrink: 0 }}>
                        <h1 style={{ fontSize: 22, fontWeight: 300, color: ARC_NAVY, letterSpacing: "0.01em", fontFamily: "Inter, Arial, sans-serif" }}>Temporary Documents</h1>
                        <p style={{ fontSize: 11, color: "#9a9088", marginTop: 4, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                          {tempDocs.map(d => d.name).join(", ")} &nbsp;·&nbsp; <span style={{ color: ARC_TERRACOTTA }}>Not saved to vault</span>
                        </p>
                      </div>
                      <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
                        {isRunning && (
                          <div style={{ padding: "14px 0", fontSize: 12, color: ARC_NAVY, display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
                            <Spinner size={12} /> {statusMsg}
                          </div>
                        )}
                        {answer && !isRunning && (
                          <div style={{ animation: "fadeIn 0.4s ease" }}>
                            <div style={{ background: "#ffffff", border: "1px solid #b1b4b6", borderTop: "4px solid #4a7c20", padding: "24px 28px" }}>
                              <p style={{ fontSize: 12, color: "#505a5f", marginBottom: 16, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Response</p>
                              <AnswerRenderer text={answer} />
                            </div>
                          </div>
                        )}
                        {!answer && !isRunning && (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 10 }}>
                            <div style={{ width: 32, height: 2, background: ARC_TERRACOTTA }} />
                            <p style={{ fontSize: 16, color: ARC_NAVY, fontWeight: 300, letterSpacing: "0.02em" }}>Ask a question</p>
                            <p style={{ fontSize: 11, color: "#9a9088", letterSpacing: "0.03em" }}>Questions will be answered using the temporary documents only</p>
                          </div>
                        )}
                      </div>
                      <div style={{ padding: "16px 32px 20px", borderTop: "1px solid #e8e0d5", background: "#ffffff", flexShrink: 0 }}>
                        <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
                          <textarea value={question} onChange={e => setQuestion(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askTempDocQuestion(); } }}
                            placeholder="Ask a question about these documents…"
                            disabled={isRunning} rows={2} className="arc-input"
                            style={{ flex: 1, border: "1px solid #ddd8d0", borderRight: "none", padding: "12px 16px", color: ARC_NAVY, fontSize: 13, outline: "none", resize: "none", lineHeight: 1.6, fontFamily: "Inter, Arial, sans-serif", opacity: isRunning ? 0.5 : 1, background: isRunning ? "#faf8f5" : "#ffffff", letterSpacing: "0.01em" }} />
                          <button className="btn" onClick={askTempDocQuestion} disabled={isRunning || !question.trim()}
                            style={{ background: isRunning || !question.trim() ? "#f0ede8" : ARC_NAVY, color: isRunning || !question.trim() ? "#9a9088" : "#ffffff", padding: "0 24px", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${isRunning || !question.trim() ? "#ddd8d0" : ARC_NAVY}`, minWidth: 90, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            {isRunning ? <Spinner size={14} /> : "Search"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Vault header */}
                  <div style={{ borderBottom: `1px solid #e8e0d5`, background: "#ffffff", flexShrink: 0 }}>
                    <div style={{ padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        {parentMaster && (
                          <div style={{ fontSize: 10, color: "#9a9088", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
                            📁 {parentMaster.name}
                          </div>
                        )}
                        <h1 style={{ fontSize: 22, fontWeight: 300, color: ARC_NAVY, letterSpacing: "0.01em", fontFamily: "Inter, Arial, sans-serif" }}>{vault.name}</h1>
                        <p style={{ fontSize: 11, color: "#9a9088", marginTop: 4, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                          {pdfs.length} document{pdfs.length !== 1 ? "s" : ""} &nbsp;·&nbsp;
                          {vaultIndex
                            ? <span style={{ color: AD_GREEN, fontWeight: 600 }}>Indexed</span>
                            : <span style={{ color: ARC_TERRACOTTA }}>Not indexed</span>}
                        </p>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        {parentMaster && (
                          <div style={{ display: "flex", border: `1px solid ${ARC_STONE}`, overflow: "hidden" }}>
                            <button className="btn" onClick={() => setQueryScope("single")}
                              style={{ padding: "6px 14px", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", background: queryScope === "single" ? ARC_NAVY : "transparent", color: queryScope === "single" ? "#fff" : "#9a9088", border: "none" }}>
                              This vault
                            </button>
                            <button className="btn" onClick={() => setQueryScope("all")}
                              style={{ padding: "6px 14px", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", background: queryScope === "all" ? ARC_NAVY : "transparent", color: queryScope === "all" ? "#fff" : "#9a9088", border: "none", borderLeft: `1px solid ${ARC_STONE}` }}>
                              All in {parentMaster.name}
                            </button>
                          </div>
                        )}
                        {pdfs.length > 0 && isAdmin && (
                          <button className="btn" onClick={indexVault} disabled={isRunning}
                            style={{ background: vaultIndex ? "transparent" : ARC_NAVY, color: vaultIndex ? ARC_NAVY : "#ffffff", border: `1px solid ${ARC_NAVY}`, padding: "8px 20px", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                            {stage === "indexing" ? <><Spinner size={12} /> Indexing…</> : vaultIndex ? "Re-index" : "Index Vault"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

                    {/* PDF panel */}
                    <div style={{ width: 220, borderRight: "1px solid #e8e0d5", background: "#faf8f5", display: "flex", flexDirection: "column", flexShrink: 0 }}>
                      {isAdmin && (
                        <div onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}
                          onClick={() => fileInputRef.current.click()}
                          style={{ margin: 12, border: `1px dashed ${dragOver ? AD_GREEN : "#ccc"}`, padding: "14px 10px", textAlign: "center", cursor: "pointer", background: dragOver ? "#f0f5f6" : "transparent" }}>
                          {uploadingPdf ? (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: AD_GREEN, fontSize: 12 }}><Spinner size={12} /> Uploading…</div>
                          ) : (
                            <>
                              <div style={{ fontSize: 18, marginBottom: 4, opacity: 0.4 }}>📄</div>
                              <p style={{ fontSize: 11, color: "#9a9088", lineHeight: 1.6, letterSpacing: "0.02em" }}>Drop PDFs here<br />or click to browse</p>
                            </>
                          )}
                          <input ref={fileInputRef} type="file" multiple accept="application/pdf" style={{ display: "none" }} onChange={e => addPDFs(e.target.files)} />
                        </div>
                      )}

                      <div style={{ flex: 1, overflowY: "auto" }}>
                        {pdfs.length > 0 && (
                          <div style={{ padding: "4px 12px 4px", fontSize: 9, color: "#b0a8a0", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", display: "flex", gap: 12, borderBottom: "1px solid #eae5df" }}>
                            <span style={{ color: AD_GREEN }}>● indexed</span>
                            <span style={{ color: "#c0b8b0" }}>○ pending</span>
                          </div>
                        )}
                        {pdfs.map(pdf => {
                          const isIndexed = vaultIndex?.documents?.some(d => d.name === pdf.name);
                          return (
                            <div key={pdf.id} style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 6, borderBottom: "1px solid #eae5df" }}>
                              <span style={{ fontSize: 8, color: isIndexed ? AD_GREEN : "#c0b8b0", flexShrink: 0 }}>{isIndexed ? "●" : "○"}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 11, color: ARC_NAVY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: "0.01em" }}>{pdf.name}</div>
                                <div style={{ fontSize: 9, color: "#b0a8a0", marginTop: 1 }}>{(pdf.size / 1024).toFixed(0)} KB</div>
                              </div>
                              {isAdmin && <>
                                <button className="btn" onClick={() => indexSinglePdf(pdf)} disabled={isRunning} title="Re-index"
                                  style={{ background: "none", color: "#b0a8a0", fontSize: 11, padding: "2px 4px", lineHeight: 1, flexShrink: 0 }}
                                  onMouseEnter={e => e.target.style.color = AD_GREEN}
                                  onMouseLeave={e => e.target.style.color = "#b0a8a0"}>↻</button>
                                <button className="btn" onClick={() => deletePdf(pdf)} disabled={isRunning} title="Remove"
                                  style={{ background: "none", color: "#b0a8a0", fontSize: 14, padding: "2px 4px", lineHeight: 1, flexShrink: 0 }}
                                  onMouseEnter={e => e.target.style.color = ARC_TERRACOTTA}
                                  onMouseLeave={e => e.target.style.color = "#b0a8a0"}>×</button>
                              </>}
                            </div>
                          );
                        })}
                        {pdfs.length === 0 && <p style={{ fontSize: 11, color: "#b0a8a0", textAlign: "center", marginTop: 24, letterSpacing: "0.02em" }}>No documents yet</p>}
                      </div>
                    </div>

                    {/* Q&A panel */}
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#faf8f5" }}>

                      {isRunning && (
                        <div style={{ padding: "14px 32px", borderBottom: "1px solid #e8e0d5", background: "#ffffff", flexShrink: 0, animation: "fadeIn 0.3s ease" }}>
                          <div style={{ fontSize: 12, color: ARC_NAVY, marginBottom: 10, display: "flex", alignItems: "center", gap: 8, fontWeight: 500, letterSpacing: "0.02em" }}><Spinner size={12} /> {statusMsg}</div>
                          <ProgressBar label="Pass 1 · Index scoring" pct={progress.select} color={AD_GREEN} />
                          <ProgressBar label="Pass 2 · Page extraction" pct={progress.read} color={ARC_TERRACOTTA} />
                          <ProgressBar label="Pass 3 · Answer synthesis" pct={progress.answer} color={ARC_NAVY} />
                        </div>
                      )}

                      {!isRunning && statusMsg && (
                        <div style={{ padding: "8px 24px", borderBottom: "1px solid #e8e0d5", background: "#ffffff", fontSize: 12, color: "#505a5f", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, gap: 12 }}>
                          <span style={{ color: timedOut ? ARC_TERRACOTTA : "#505a5f" }}>{statusMsg}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                            {timedOut && lastQuestion && (
                              <button className="btn" onClick={() => { setTimedOut(false); setQuestion(lastQuestion); askQuestion(); }}
                                style={{ background: ARC_TERRACOTTA, color: "#fff", padding: "4px 14px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", border: "none" }}>
                                ↻ Retry
                              </button>
                            )}
                            {costEst !== null && !timedOut && (
                              <span style={{ fontSize: 11, color: "#9a9088", fontStyle: "italic" }}>
                                Est. cost: {costEst < 0.01 ? "< 1p" : `${(costEst * 100).toFixed(2)}p`}
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {queryScope === "all" && parentMaster && (
                        <div style={{ padding: "8px 28px", background: "#f0f5f6", borderBottom: `1px solid ${AD_GREEN_MID}`, fontSize: 11, color: AD_GREEN, display: "flex", alignItems: "center", gap: 8 }}>
                          <span>🔍</span>
                          <span>Searching across all {(parentMaster.subVaults || []).length} vaults in <strong>{parentMaster.name}</strong></span>
                        </div>
                      )}

                      <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
                        {vaultHistory.length > 0 && (
                          <div style={{ marginBottom: 20 }}>
                            {vaultHistory.map((h, i) => (
                              <div key={i} style={{ marginBottom: 8 }}>
                                <div style={{ fontSize: 13, color: "#505a5f", background: "#ffffff", border: "1px solid #b1b4b6", padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                                  <span style={{ color: "#4a7c20", fontWeight: 700, flexShrink: 0 }}>Q:</span>
                                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.question}</span>
                                  <span style={{ fontSize: 11, color: "#6f777b", flexShrink: 0 }}>{new Date(h.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {answer && (
                          <div style={{ animation: "fadeIn 0.4s ease" }}>
                            <div style={{ background: "#ffffff", border: "1px solid #b1b4b6", borderTop: "4px solid #4a7c20", padding: "24px 28px" }}>
                              <p style={{ fontSize: 12, color: "#505a5f", marginBottom: 16, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                Response — {queryScope === "all" && parentMaster ? parentMaster.name + " (all vaults)" : vault.name}
                              </p>
                              <AnswerRenderer text={answer} />
                            </div>
                          </div>
                        )}

                        {!answer && !isRunning && (vaultIndex || tempDocs.length) && vaultHistory.length === 0 && (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 10 }}>
                            <div style={{ width: 32, height: 2, background: ARC_TERRACOTTA }} />
                            <p style={{ fontSize: 16, color: ARC_NAVY, fontWeight: 300, letterSpacing: "0.02em" }}>Ask a question</p>
                            <p style={{ fontSize: 11, color: "#9a9088", letterSpacing: "0.03em" }}>AI selects the most relevant pages before answering</p>
                          </div>
                        )}

                        {!vaultIndex && !tempDocs.length && !isRunning && pdfs.length > 0 && (
                          <div style={{ border: `1px solid ${ARC_TERRACOTTA}`, borderLeft: `3px solid ${ARC_TERRACOTTA}`, padding: "14px 20px", margin: "24px 0", background: "#fdf5f3" }}>
                            <p style={{ fontSize: 13, fontWeight: 600, color: ARC_NAVY, marginBottom: 4 }}>Vault not indexed</p>
                            <p style={{ fontSize: 12, color: "#9a9088" }}>Click Index Vault to prepare documents for searching.</p>
                          </div>
                        )}

                        {pdfs.length === 0 && !isRunning && (
                          <div style={{ border: `1px solid #b8d4da`, borderLeft: `3px solid ${AD_GREEN}`, padding: "14px 20px", margin: "24px 0", background: "#f0f5f6" }}>
                            <p style={{ fontSize: 13, fontWeight: 600, color: ARC_NAVY, marginBottom: 4 }}>No documents uploaded</p>
                            <p style={{ fontSize: 12, color: "#9a9088" }}>Use the panel on the left to upload PDF documents to this vault.</p>
                          </div>
                        )}
                      </div>

                      {(vaultIndex || tempDocs.length || (queryScope === "all" && parentMaster)) && (
                        <div style={{ padding: "16px 32px 20px", borderTop: `1px solid #e8e0d5`, background: "#ffffff", flexShrink: 0 }}>
                          <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
                            <textarea value={question} onChange={e => setQuestion(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askQuestion(); } }}
                              placeholder="Ask a question about your building regulations documents…"
                              disabled={isRunning} rows={2} className="arc-input"
                              style={{ flex: 1, border: `1px solid #ddd8d0`, borderRight: "none", padding: "12px 16px", color: ARC_NAVY, fontSize: 13, outline: "none", resize: "none", lineHeight: 1.6, fontFamily: "Inter, Arial, sans-serif", opacity: isRunning ? 0.5 : 1, background: isRunning ? "#faf8f5" : "#ffffff", letterSpacing: "0.01em" }} />
                            <button className="btn" onClick={askQuestion} disabled={isRunning || !question.trim()}
                              style={{ background: isRunning || !question.trim() ? "#f0ede8" : ARC_NAVY, color: isRunning || !question.trim() ? "#9a9088" : "#ffffff", padding: "0 24px", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${isRunning || !question.trim() ? "#ddd8d0" : ARC_NAVY}`, minWidth: 90, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                              {isRunning ? <Spinner size={14} /> : "Search"}
                            </button>
                          </div>
                          {costEst !== null && <p style={{ fontSize: 10, color: "#b0a8a0", marginTop: 6, letterSpacing: "0.04em" }}>Est. cost: {costEst < 0.01 ? "< 1p" : `${(costEst * 100).toFixed(2)}p`}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
