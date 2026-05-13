import { AD_GREEN, AD_GREEN_MID, ARC_NAVY, ARC_TERRACOTTA } from "../../constants";

function formatInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} style={{ color: "#e8d5a3" }}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} style={{ background: "#1e1e1e", color: "#c8a96e", padding: "1px 5px", borderRadius: 3, fontSize: 12 }}>{p.slice(1, -1)}</code>;
    return p;
  });
}

function parseCitation(citationText) {
  const pipeIdx = citationText.indexOf("|");
  if (pipeIdx === -1) return { docName: citationText.trim(), heading: "" };
  const docName = citationText.slice(0, pipeIdx).trim();
  const heading = citationText.slice(pipeIdx + 1).trim();
  return { docName, heading };
}

function isCitationLine(trimmed) {
  return (
    trimmed.startsWith("*") && trimmed.endsWith("*") &&
    trimmed.length > 2 && !trimmed.startsWith("**") &&
    trimmed.includes("|")
  );
}

function extractCitationText(trimmed) {
  if (trimmed.startsWith("*") && trimmed.endsWith("*")) return trimmed.slice(1, -1);
  return trimmed.slice(1).trim();
}

function SectionHeader({ text }) {
  const lower = text.toLowerCase();
  let bg, borderColor, labelColor;
  if (lower.includes("summary")) {
    bg = "#f0f5f6"; borderColor = "#3d9970"; labelColor = "#3d9970";
  } else if (lower.includes("detailed")) {
    bg = "#f5f7fa"; borderColor = ARC_NAVY; labelColor = ARC_NAVY;
  } else if (lower.includes("regulatory")) {
    bg = "#faf6f0"; borderColor = ARC_TERRACOTTA; labelColor = ARC_TERRACOTTA;
  } else if (lower.includes("contradiction") || lower.includes("conflict")) {
    bg = "#fdf5f5"; borderColor = "#9a3030"; labelColor = "#9a3030";
  } else {
    bg = "#f5f7fa"; borderColor = ARC_NAVY; labelColor = ARC_NAVY;
  }
  return (
    <div style={{
      display: "flex", alignItems: "center",
      padding: "10px 16px", margin: "24px 0 12px",
      background: bg, borderLeft: `3px solid ${borderColor}`, borderRadius: "0 3px 3px 0"
    }}>
      <span style={{
        fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
        textTransform: "uppercase", color: labelColor
      }}>{text}</span>
    </div>
  );
}

function SourceCard({ quoteText, citationText, onCitationClick }) {
  const { docName, heading } = parseCitation(citationText);
  return (
    <div style={{
      border: "1px solid #e0dcd6", borderLeft: "3px solid #c8c0b8",
      borderRadius: "0 3px 3px 0", margin: "8px 0 14px", overflow: "hidden"
    }}>
      <div style={{
        padding: "10px 14px", fontStyle: "italic", fontSize: 13,
        color: "#3a4a5a", lineHeight: 1.7, background: "#fafaf9",
        borderBottom: "1px solid #e8e4e0"
      }}>
        {quoteText}
      </div>
      <div style={{ display: "flex", alignItems: "stretch", background: "#fff" }}>
        <div style={{ padding: "7px 12px", flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: ARC_NAVY, letterSpacing: "0.02em" }}>{docName}</div>
          {heading && <div style={{ fontSize: 11, color: "#6b6560", marginTop: 2 }}>{heading}</div>}
        </div>
        {onCitationClick && (
          <button
            onClick={() => onCitationClick(docName, heading)}
            style={{
              background: ARC_NAVY, color: "#fff", border: "none", cursor: "pointer",
              fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase",
              fontFamily: "Inter, Arial, sans-serif", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 2,
              minWidth: 84, padding: "0 14px", transition: "background 0.15s", flexShrink: 0
            }}
            onMouseEnter={e => e.currentTarget.style.background = "#2a3a52"}
            onMouseLeave={e => e.currentTarget.style.background = ARC_NAVY}
          >
            <span>Open PDF</span>
            <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.7 }}>↗ source</span>
          </button>
        )}
      </div>
    </div>
  );
}

function CitationChip({ citationText, onCitationClick }) {
  const { docName, heading } = parseCitation(citationText);
  return (
    <div
      onClick={() => onCitationClick && onCitationClick(docName, heading)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        background: "#f0f4f8", border: "1px solid #d0dce8", borderRadius: 3,
        padding: "3px 8px 3px 10px", margin: "3px 0 8px",
        fontSize: 11, cursor: onCitationClick ? "pointer" : "default",
        transition: "background 0.15s", fontFamily: "Inter, Arial, sans-serif"
      }}
      onMouseEnter={e => { if (onCitationClick) e.currentTarget.style.background = "#e4ecf4"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "#f0f4f8"; }}
    >
      <span style={{ fontWeight: 600, color: ARC_NAVY }}>{docName}</span>
      {heading && <span style={{ color: "#5a6a7a" }}>· {heading}</span>}
      {onCitationClick && <span style={{ color: ARC_NAVY, fontSize: 12 }}>↗</span>}
    </div>
  );
}

export default function AnswerRenderer({ text, onCitationClick, answerStats }) {
  if (!text) return null;
  const lines = text.split("\n");
  const elements = [];
  let tableBuffer = [];
  let inTable = false;
  let lastCitationKey = null;

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

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // ── Table rows ───────────────────────────────────────────────────────────
    if (line.startsWith(">> ")) {
      inTable = true;
      if (tableBuffer._pendingTitle) { tableBuffer._title = tableBuffer._pendingTitle; delete tableBuffer._pendingTitle; }
      const chevronContent = line.slice(3).trim();
      const normalised = chevronContent.startsWith("|") ? `>> ${chevronContent}` : `>> | ${chevronContent} |`;
      tableBuffer.push(normalised);
      i++; continue;
    }
    if (line.startsWith("|")) {
      inTable = true;
      if (tableBuffer._pendingTitle) { tableBuffer._title = tableBuffer._pendingTitle; delete tableBuffer._pendingTitle; }
      tableBuffer.push(line);
      i++; continue;
    }
    if (inTable) flushTable(i);

    const trimmedLine = line.trim();

    // ── Table title detection ────────────────────────────────────────────────
    const isBoldTitle = (trimmedLine.startsWith("**") && trimmedLine.endsWith("**") && /table|figure/i.test(trimmedLine));
    const isPlainTitle = (!trimmedLine.startsWith("|") && !trimmedLine.startsWith(">") && !trimmedLine.startsWith("*") && /^(table|figure)\s+\d+/i.test(trimmedLine) && !trimmedLine.includes("  "));
    if (isBoldTitle || isPlainTitle) {
      tableBuffer._pendingTitle = trimmedLine.replace(/\*\*/g, "").trim();
      i++; continue;
    }
    if (!trimmedLine.startsWith("|") && !trimmedLine.startsWith(">") && trimmedLine.includes(" | ") && tableBuffer._pendingTitle && !inTable) {
      inTable = true;
      if (tableBuffer._pendingTitle) { tableBuffer._title = tableBuffer._pendingTitle; delete tableBuffer._pendingTitle; }
      tableBuffer.push(`| ${trimmedLine} |`);
      const colCount = trimmedLine.split(" | ").length;
      tableBuffer.push(`|${Array(colCount).fill("---").join("|")}|`);
      i++; continue;
    }

    // ── Section headers ──────────────────────────────────────────────────────
    if (line.startsWith("## ")) {
      elements.push(<SectionHeader key={i} text={line.slice(3)} />);
      lastCitationKey = null;
      i++; continue;
    }
    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={i} style={{ color: ARC_TERRACOTTA, fontSize: 11, fontWeight: 600, margin: "20px 0 6px", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "Inter, Arial, sans-serif" }}>
          {line.slice(4)}
        </h3>
      );
      i++; continue;
    }
    if (line.startsWith("# ")) {
      elements.push(
        <div key={i} style={{ borderBottom: `2px solid ${ARC_TERRACOTTA}`, marginTop: 32, marginBottom: 14, paddingBottom: 6 }}>
          <h1 style={{ color: ARC_NAVY, fontSize: 20, fontWeight: 300, margin: 0, fontFamily: "Inter, Arial, sans-serif", letterSpacing: "0.02em" }}>{line.slice(2)}</h1>
        </div>
      );
      i++; continue;
    }

    // ── Blockquote: pair with following citation if present ──────────────────
    if (line.startsWith("> ")) {
      const quoteText = line.slice(2);
      const isInlineCitation = quoteText.startsWith("*") && quoteText.endsWith("*");
      const isTableRow = quoteText.startsWith("|");
      const isSeparatorRow = /^\|[\s:|-]+\|/.test(quoteText);

      if (isInlineCitation) {
        // Legacy: > *Citation* — render as chip
        const citText = quoteText.slice(1, -1);
        const citKey = citText.toLowerCase().replace(/\s+/g, " ").trim();
        if (citKey !== lastCitationKey) {
          elements.push(<CitationChip key={i} citationText={citText} onCitationClick={onCitationClick} />);
          lastCitationKey = citKey;
        }
        i++; continue;
      }
      if (isTableRow && !isSeparatorRow) { inTable = true; tableBuffer.push(quoteText); i++; continue; }
      if (isSeparatorRow) { if (inTable) tableBuffer.push(quoteText); i++; continue; }

      // Look ahead for a citation on the next non-empty line
      let nextIdx = i + 1;
      while (nextIdx < lines.length && lines[nextIdx].trim() === "") nextIdx++;
      const nextTrimmed = nextIdx < lines.length ? lines[nextIdx].trim() : "";

      if (isCitationLine(nextTrimmed)) {
        const citText = extractCitationText(nextTrimmed);
        const citKey = citText.toLowerCase().replace(/\s+/g, " ").trim();
        elements.push(<SourceCard key={i} quoteText={quoteText} citationText={citText} onCitationClick={onCitationClick} />);
        lastCitationKey = citKey;
        i = nextIdx + 1;
        continue;
      }

      // Plain blockquote with no citation following
      elements.push(
        <div key={i} style={{ borderLeft: "2px solid #d0ccc8", padding: "2px 0 2px 14px", margin: "4px 0", fontStyle: "italic", fontSize: 13, color: "#4a5568", lineHeight: 1.8, fontFamily: "Inter, Arial, sans-serif" }}>
          {quoteText}
        </div>
      );
      i++; continue;
    }

    // ── Bullet points ────────────────────────────────────────────────────────
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const trimmedBullet = line.trim();
      const isBulletCitationWrapped = trimmedBullet.startsWith("*") && trimmedBullet.endsWith("*") && trimmedBullet.length > 2 && !trimmedBullet.startsWith("**");
      const isBulletCitationUnwrapped = trimmedBullet.startsWith("*") && !trimmedBullet.startsWith("**") && trimmedBullet.includes("|") && trimmedBullet.length > 10;
      if (isBulletCitationWrapped || isBulletCitationUnwrapped) {
        const citText = isBulletCitationWrapped ? trimmedBullet.slice(1, -1) : trimmedBullet.slice(1).trim();
        const citKey = citText.toLowerCase().replace(/\s+/g, " ").trim();
        if (citKey !== lastCitationKey) {
          elements.push(<CitationChip key={i} citationText={citText} onCitationClick={onCitationClick} />);
          lastCitationKey = citKey;
        }
      } else {
        lastCitationKey = null;
        elements.push(<li key={i} style={{ color: ARC_NAVY, fontSize: 13, lineHeight: 1.7, marginLeft: 20, marginBottom: 4, fontFamily: "Inter, Arial, sans-serif" }}>{formatInline(line.slice(2))}</li>);
      }
      i++; continue;
    }

    // ── Numbered sections ────────────────────────────────────────────────────
    if (line.match(/^\d+\.\d+ /)) {
      const numMatch = line.match(/^(\d+\.\d+) (.+)/);
      if (numMatch) {
        lastCitationKey = null;
        elements.push(
          <div key={i} style={{ display: "flex", gap: 12, margin: "6px 0" }}>
            <span style={{ color: ARC_TERRACOTTA, fontWeight: 600, fontSize: 12, flexShrink: 0, minWidth: 28 }}>{numMatch[1]}</span>
            <p style={{ color: ARC_NAVY, fontSize: 13, lineHeight: 1.7, margin: 0, fontFamily: "Inter, Arial, sans-serif" }}>{formatInline(numMatch[2])}</p>
          </div>
        );
      }
      i++; continue;
    }
    if (line.match(/^\d+\. /)) {
      lastCitationKey = null;
      elements.push(<li key={i} style={{ color: "#0b0c0c", fontSize: 14, lineHeight: 1.7, marginLeft: 20, marginBottom: 3, listStyleType: "decimal", fontFamily: "Arial, sans-serif" }}>{formatInline(line.replace(/^\d+\. /, ""))}</li>);
      i++; continue;
    }

    // ── Empty lines ──────────────────────────────────────────────────────────
    if (line === "") {
      elements.push(<div key={i} style={{ height: 10 }} />);
      i++; continue;
    }

    // ── Standalone citation lines ────────────────────────────────────────────
    const isWrappedCitation = trimmedLine.startsWith("*") && trimmedLine.endsWith("*") && trimmedLine.length > 2 && !trimmedLine.startsWith("**");
    const isUnwrappedCitation = trimmedLine.startsWith("*") && !trimmedLine.startsWith("**") && trimmedLine.includes("|") && trimmedLine.length > 10;
    if (isWrappedCitation || isUnwrappedCitation) {
      const citText = isWrappedCitation ? trimmedLine.slice(1, -1) : trimmedLine.slice(1).trim();
      const citKey = citText.toLowerCase().replace(/\s+/g, " ").trim();
      if (citKey !== lastCitationKey) {
        elements.push(<CitationChip key={i} citationText={citText} onCitationClick={onCitationClick} />);
        lastCitationKey = citKey;
      }
      i++; continue;
    }

    // ── Regular paragraph ────────────────────────────────────────────────────
    lastCitationKey = null;
    elements.push(<p key={i} style={{ color: ARC_NAVY, fontSize: 13, lineHeight: 1.8, margin: "6px 0", fontFamily: "Inter, Arial, sans-serif", letterSpacing: "0.01em" }}>{formatInline(line)}</p>);
    i++;
  }

  if (inTable) flushTable("end");

  return (
    <div>
      {answerStats && (
        <div style={{
          fontSize: 11, color: "#6b8fa8", background: "#eef4f8",
          border: "1px solid #c8dce8", borderRadius: 3,
          padding: "4px 10px", display: "inline-block", marginBottom: 14,
          fontFamily: "Inter, Arial, sans-serif"
        }}>
          {answerStats.docsTotal} document{answerStats.docsTotal !== 1 ? "s" : ""} searched
          {" · "}{answerStats.docsRead} contained relevant content
          {" · "}{answerStats.pagesRead} page{answerStats.pagesRead !== 1 ? "s" : ""} read
        </div>
      )}
      {elements}
    </div>
  );
}
