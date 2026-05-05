import { AD_GREEN, AD_GREEN_MID, ARC_NAVY, ARC_TERRACOTTA } from "../../constants";

function formatInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} style={{ color: "#e8d5a3" }}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} style={{ background: "#1e1e1e", color: "#c8a96e", padding: "1px 5px", borderRadius: 3, fontSize: 12 }}>{p.slice(1, -1)}</code>;
    return p;
  });
}

// Parse "Document Name | Clause Title (Parent)" into { docName, heading }
function parseCitation(citationText) {
  const pipeIdx = citationText.indexOf("|");
  if (pipeIdx === -1) return { docName: citationText.trim(), heading: "" };
  const docName = citationText.slice(0, pipeIdx).trim();
  const heading = citationText.slice(pipeIdx + 1).trim();
  return { docName, heading };
}

function CitationLine({ citationText, onCitationClick, keyProp }) {
  const { docName, heading } = parseCitation(citationText);
  return (
    <p key={keyProp} style={{ fontSize: 11, color: "#9a9088", fontStyle: "italic", margin: "2px 0 8px 0", fontFamily: "Inter, Arial, sans-serif", display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
      <span>{citationText}</span>
      {onCitationClick && (
        <button
          onClick={() => onCitationClick(docName, heading)}
          title="Open source PDF"
          style={{ background: "none", border: "none", cursor: "pointer", color: "#9a9088", fontSize: 10, padding: "0 2px", fontStyle: "normal", lineHeight: 1, flexShrink: 0, textDecoration: "underline", fontFamily: "Inter, Arial, sans-serif" }}
          onMouseEnter={e => e.target.style.color = ARC_NAVY}
          onMouseLeave={e => e.target.style.color = "#9a9088"}
        >↗ open</button>
      )}
    </p>
  );
}

export default function AnswerRenderer({ text, onCitationClick }) {
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
          <CitationLine key={i} keyProp={i} citationText={quoteText.slice(1, -1)} onCitationClick={onCitationClick} />
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
          <CitationLine key={i} keyProp={i} citationText={citationText} onCitationClick={onCitationClick} />
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
          <CitationLine key={i} keyProp={i} citationText={citationText} onCitationClick={onCitationClick} />
        );
      } else {
        elements.push(<p key={i} style={{ color: ARC_NAVY, fontSize: 13, lineHeight: 1.8, margin: "6px 0", fontFamily: "Inter, Arial, sans-serif", letterSpacing: "0.01em" }}>{formatInline(line)}</p>);
      }
    }
  });
  if (inTable) flushTable("end");
  return <div>{elements}</div>;
}
