import { useState, useRef, useEffect } from "react";
import { DESIGN_SHELL } from "../constants";
import { Spinner } from "./common/Spinner";

// ── Vault PDF Viewer Modal ────────────────────────────────────────────────────
export default function VaultPdfViewer({ base64, fileName, page, heading, onClose }) {
  const iframeRef = useRef(null);
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!base64) return;
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [base64, page]);

  // Close on Escape
  useEffect(() => {
    const handleKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Build a self-contained viewer page using PDF.js from cdnjs
  const safeFileName = (fileName || "Document")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const viewerHtml = blobUrl ? `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #525659; display: flex; flex-direction: column; height: 100vh; font-family: Inter, Arial, sans-serif; }
  #toolbar { background: #1a2332; padding: 8px 16px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
  #toolbar span { color: rgba(255,255,255,0.7); font-size: 12px; }
  #toolbar strong { color: #fff; font-size: 12px; }
  #page-controls { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  #page-controls button { background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 4px 10px; cursor: pointer; font-size: 13px; border-radius: 2px; }
  #page-controls button:hover { background: rgba(255,255,255,0.2); }
  #page-controls input { width: 48px; text-align: center; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: #fff; padding: 4px; font-size: 12px; border-radius: 2px; }
  #zoom-controls { display: flex; align-items: center; gap: 6px; margin-left: 20px; }
  #zoom-controls button { background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 4px 10px; cursor: pointer; font-size: 13px; border-radius: 2px; }
  #zoom-controls button:hover { background: rgba(255,255,255,0.2); }
  #zoom-controls button.active { background: rgba(255,255,255,0.85); color: #1a2332; border-color: rgba(255,255,255,0.85); }
  #zoom-level { color: rgba(255,255,255,0.7); font-size: 12px; min-width: 42px; text-align: center; }
  #canvas-container { flex: 1; overflow: auto; display: flex; justify-content: center; align-items: flex-start; padding: 16px; }
  #canvas-container.fit { align-items: center; }
  canvas { box-shadow: 0 2px 16px rgba(0,0,0,0.5); }
</style>
</head>
<body>
<div id="toolbar">
  <strong id="filename">${safeFileName}</strong>
  <div id="zoom-controls">
    <button id="zoom-out" title="Zoom out">−</button>
    <span id="zoom-level">150%</span>
    <button id="zoom-in" title="Zoom in">+</button>
    <button id="fit-page" title="Fit whole page — scroll wheel flips pages">Fit page</button>
  </div>
  <div id="page-controls">
    <button id="prev">‹</button>
    <input id="page-input" type="number" min="1" value="${page || 1}" />
    <span>/ <span id="total-pages">…</span></span>
    <button id="next">›</button>
  </div>
</div>
<div id="canvas-container"><canvas id="pdf-canvas"></canvas></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  let pdfDoc = null;
  let currentPage = ${page || 1};
  let scale = 1.5;
  let fitMode = false;
  const canvas = document.getElementById('pdf-canvas');
  const ctx = canvas.getContext('2d');
  const container = document.getElementById('canvas-container');

  function effectiveScale(page) {
    if (!fitMode) return scale;
    const base = page.getViewport({ scale: 1 });
    const availH = container.clientHeight - 32; // 16px padding top + bottom
    const availW = container.clientWidth - 32;
    return Math.max(0.1, Math.min(availH / base.height, availW / base.width));
  }

  function renderPage(num) {
    pdfDoc.getPage(num).then(page => {
      const s = effectiveScale(page);
      const viewport = page.getViewport({ scale: s });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      page.render({ canvasContext: ctx, viewport }).promise.then(() => {
        document.getElementById('page-input').value = num;
        document.getElementById('zoom-level').textContent = Math.round(s * 100) + '%';
      });
    });
  }

  pdfjsLib.getDocument('${blobUrl}').promise.then(pdf => {
    pdfDoc = pdf;
    const total = pdf.numPages;
    document.getElementById('total-pages').textContent = total;
    currentPage = Math.min(Math.max(1, ${page || 1}), total);
    renderPage(currentPage);

    const headingTarget = ${JSON.stringify(heading || "")};
    if (headingTarget) {
      (async () => {
        const norm = s => s.toLowerCase().split(/[^a-z0-9]+/).join(' ').trim();
        const target = norm(headingTarget);
        const words = target.split(' ').filter(w => w.length > 3);
        if (!target) return;
        const hint = currentPage;

        const matches = text => text.includes(target) || (words.length >= 2 && words.every(w => text.includes(w)));

        // Pass 1: search within ±20 pages of hint (covers minor drift, avoids TOC false positives)
        const closeRange = [hint];
        for (let d = 1; d <= 20; d++) {
          if (hint - d >= 1) closeRange.push(hint - d);
          if (hint + d <= total) closeRange.push(hint + d);
        }
        for (const n of closeRange) {
          const pg = await pdfDoc.getPage(n);
          const tc = await pg.getTextContent();
          if (matches(norm(tc.items.map(i => i.str).join(' ')))) {
            if (n !== currentPage) { currentPage = n; renderPage(currentPage); }
            return;
          }
        }

        // Pass 2: search rest of document, skip early pages (TOC / front matter zone)
        const earlySkip = Math.min(20, Math.floor(hint / 2));
        for (let n = 1; n <= total; n++) {
          if (Math.abs(n - hint) <= 20) continue; // already checked in pass 1
          if (n <= earlySkip) continue;            // skip likely TOC pages
          const pg = await pdfDoc.getPage(n);
          const tc = await pg.getTextContent();
          if (matches(norm(tc.items.map(i => i.str).join(' ')))) {
            currentPage = n; renderPage(currentPage);
            return;
          }
        }
      })();
    }
  });

  document.getElementById('prev').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderPage(currentPage); }
  });
  document.getElementById('next').addEventListener('click', () => {
    if (pdfDoc && currentPage < pdfDoc.numPages) { currentPage++; renderPage(currentPage); }
  });
  document.getElementById('page-input').addEventListener('change', e => {
    const n = parseInt(e.target.value);
    if (pdfDoc && n >= 1 && n <= pdfDoc.numPages) { currentPage = n; renderPage(currentPage); }
  });

  function exitFit() {
    fitMode = false;
    document.getElementById('fit-page').classList.remove('active');
    container.classList.remove('fit');
  }
  document.getElementById('zoom-in').addEventListener('click', () => {
    exitFit(); scale = Math.min(4, scale + 0.25); renderPage(currentPage);
  });
  document.getElementById('zoom-out').addEventListener('click', () => {
    exitFit(); scale = Math.max(0.5, scale - 0.25); renderPage(currentPage);
  });
  document.getElementById('fit-page').addEventListener('click', () => {
    fitMode = !fitMode;
    document.getElementById('fit-page').classList.toggle('active', fitMode);
    container.classList.toggle('fit', fitMode);
    renderPage(currentPage);
  });

  // In Fit-page mode the page fills the view, so the scroll wheel flips pages
  // (one notch = one page). When zoomed in, normal scrolling is left alone.
  let wheelLock = false;
  container.addEventListener('wheel', e => {
    if (!fitMode || !pdfDoc) return;
    e.preventDefault();
    if (wheelLock) return;
    wheelLock = true;
    setTimeout(() => { wheelLock = false; }, 250);
    if (e.deltaY > 0 && currentPage < pdfDoc.numPages) { currentPage++; renderPage(currentPage); }
    else if (e.deltaY < 0 && currentPage > 1) { currentPage--; renderPage(currentPage); }
  }, { passive: false });
  window.addEventListener('resize', () => { if (fitMode && pdfDoc) renderPage(currentPage); });
</script>
</body>
</html>` : "";

  return (
    <div style={{ position: "fixed", inset: 0, background: "#1a1a1a", zIndex: 3000, display: "flex", flexDirection: "column" }}>
      <div style={{ background: DESIGN_SHELL, padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{fileName}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>Source document</div>
          </div>
        </div>
        <button className="btn" onClick={onClose}
          style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", padding: "7px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em" }}>
          Close ✕
        </button>
      </div>
      <div style={{ flex: 1, background: "#525659", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {!blobUrl && <div style={{ color: "#fff", fontSize: 13, display: "flex", alignItems: "center", gap: 10 }}><Spinner size={14} /> Loading document…</div>}
        {blobUrl && (
          <iframe
            srcDoc={viewerHtml}
            style={{ width: "100%", height: "100%", border: "none" }}
            title={fileName}
            sandbox="allow-scripts allow-same-origin"
          />
        )}
      </div>
    </div>
  );
}
