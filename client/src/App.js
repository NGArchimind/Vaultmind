import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { api, callClaude, fileToBase64, supabase } from "./api/client";
import AnswerRenderer from "./components/common/AnswerRenderer";
import { Spinner, ProgressBar } from "./components/common/Spinner";
import VaultManagementModal from "./components/VaultManagementModal";
import CompareSection from "./components/CompareSection";
import LandingPage from "./components/LandingPage";
import ProjectsSection from "./components/ProjectsSection";
import DatasheetsLibrarySection from "./components/DatasheetsLibrarySection";
import AdminSection from "./components/AdminSection";
import QuizModal from "./components/QuizModal";
import ShareModal from "./components/ShareModal";
import TimesheetsSection from "./components/TimesheetsSection";
import ScheduleSection from "./components/ScheduleSection";
import { BOILERPLATE_HEADINGS, isBoilerplate, DESIGN_SHELL, DESIGN_GROUND, DESIGN_GOLD, DESIGN_TEXT, DESIGN_MUTED, VAULT_FULL, COMPARE_FULL } from "./constants";

// ── Vault PDF Viewer Modal ────────────────────────────────────────────────────
function VaultPdfViewer({ base64, fileName, page, heading, onClose }) {
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

export default function App() {
  const [appSection, setAppSection] = useState("home");
  const [sectionKey, setSectionKey] = useState(0);
  const navigate = (section) => { setAppSection(section); setSectionKey(k => k + 1); };
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
  const [recentQuestions, setRecentQuestions] = useState([]); // persisted per-user question history for the open vault
  const [conversationHistory, setConversationHistory] = useState([]);
  const [loadingVaults, setLoadingVaults] = useState(true);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [tempDoc, setTempDoc] = useState(null);
  const [tempDocIndex, setTempDocIndex] = useState(null);
  const [tempDocIndexing, setTempDocIndexing] = useState(false);
  const tempDocIndexRef = useRef(null); // ref so askQuestion can await it
  const [tempDocDragOver, setTempDocDragOver] = useState(false);
  const [tempDocMode, setTempDocMode] = useState("query-vault-with-temp"); // "query-temp" | "query-vault-with-temp"
  const [followUpVaultId, setFollowUpVaultId] = useState("");
  const [followUpQuestion, setFollowUpQuestion] = useState("");
  const [answerVaultName, setAnswerVaultName] = useState("");
  const [citationPageMap, setCitationPageMap] = useState({}); // { docName → { page, vaultId, fileName } }
  const [lastAnswerIndex, setLastAnswerIndex] = useState(null); // vault index from most recent answer — used for accurate citation pages
  const [lastQuestion, setLastQuestion] = useState("");
  const [timedOut, setTimedOut] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);
  const [shareId, setShareId] = useState(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const fileInputRef = useRef();
  const tempDocInputRef = useRef();
  const tempDocTextareaRef = useRef(null);
  const prevTempDocIndexingRef = useRef(null);

  // ── Auth state ────────────────────────────────────────────────────────────────
  const [authLoading, setAuthLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  // ── Bootstrap auth session ────────────────────────────────────────────────────
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        const role = session.user?.app_metadata?.role || "user";
        setUserRole(role);
      }
      setAuthLoading(false);
    });

    // Listen for auth state changes (sign in / sign out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        const role = session.user?.app_metadata?.role || "user";
        setUserRole(role);
      } else {
        setUserRole(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) return;
    setLoggingIn(true);
    setLoginError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setLoginError("Incorrect email or password. Please try again.");
      setPassword("");
    }
    setLoggingIn(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setAppSection("home");
    setSelectedVault(null);
    setVaults([]);
    setAnswer(null);
    setHistory([]);
    setRecentQuestions([]);
  };

  const loadTempDoc = async (file) => {
    if (!file || file.type !== "application/pdf") return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(",")[1];
      setTempDoc({ name: file.name, base64 });
      setTempDocIndex(null);
      setTempDocIndexing(true);
      // Index in background — store a promise in ref so askQuestion can await it
      const indexPromise = indexOnePdf(file.name, base64).then(result => {
        const idx = { documents: [{ name: file.name, headings: result.headings, base64 }] };
        tempDocIndexRef.current = idx; // store result directly so askQuestion can use it immediately
        setTempDocIndex(idx);
        setTempDocIndexing(false);
        return idx;
      }).catch(err => {
        console.warn("Temp doc indexing failed:", err.message);
        setTempDocIndexing(false);
        tempDocIndexRef.current = null;
      });
      tempDocIndexRef.current = indexPromise; // initially a promise, replaced with result on completion
    };
    reader.readAsDataURL(file);
  };

  const isAdmin = userRole === "admin";
  const isHr    = userRole === "hr";

  const vault = useMemo(() => {
    for (const v of vaults) {
      if (v.id === selectedVault) return v;
      if (v.type === "master") {
        const sub = (v.subVaults || []).find(sv => sv.id === selectedVault);
        if (sub) return sub;
      }
    }
    return null;
  }, [vaults, selectedVault]);

  const parentMaster = vaults.find(v => v.type === "master" && (v.subVaults || []).some(sv => sv.id === selectedVault));
  const vaultHistory = history.filter(h => h.vaultId === selectedVault);

  // Flat list of all queryable vaults (excluding current) for follow-up dropdown
  const allQueryableVaults = vaults.flatMap(v =>
    v.type === "master" ? (v.subVaults || []) : [v]
  );

  useEffect(() => {
    const isStaging = process.env.REACT_APP_API_URL?.includes("staging");
    document.title = isStaging ? "Archimind [Staging]" : "Archimind";
  }, []);

  useEffect(() => {
    if (session) loadVaults();
  }, [session]);

  const loadVaults = useCallback(async () => {
    setLoadingVaults(true);
    try {
      const data = await api("/api/vaults");
      setVaults(data.vaults || []);
    } catch (e) {
      console.error("Failed to load vaults:", e);
    }
    setLoadingVaults(false);
  }, []);

  useEffect(() => {
    if (!selectedVault) return;
    loadVaultContents(selectedVault);
    loadRecentQuestions(selectedVault);
  }, [selectedVault]);

  // Persisted per-user question history for the open vault
  const loadRecentQuestions = useCallback(async (vaultId) => {
    if (!vaultId) { setRecentQuestions([]); return; }
    try {
      const data = await api(`/api/vault-history?vault_id=${encodeURIComponent(vaultId)}`);
      setRecentQuestions(data.questions || []);
    } catch {
      setRecentQuestions([]);
    }
  }, []);

  const deleteRecentQuestion = async (id) => {
    setRecentQuestions(prev => prev.filter(q => q.id !== id)); // optimistic
    try { await api(`/api/vault-history/${id}`, { method: "DELETE" }); }
    catch { loadRecentQuestions(selectedVault); } // reload on failure to resync
  };

  const clearRecentQuestions = async () => {
    if (!selectedVault) return;
    const prev = recentQuestions;
    setRecentQuestions([]); // optimistic
    try { await api(`/api/vault-history?vault_id=${encodeURIComponent(selectedVault)}`, { method: "DELETE" }); }
    catch { setRecentQuestions(prev); } // restore on failure
  };

  // Re-focus the temp doc textarea when indexing completes so Enter still works,
  // and clear any stale "Indexing…" status message left over from background indexing.
  useEffect(() => {
    if (prevTempDocIndexingRef.current === true && !tempDocIndexing && tempDocIndex) {
      tempDocTextareaRef.current?.focus();
      setStatusMsg("");
    }
    prevTempDocIndexingRef.current = tempDocIndexing;
  }, [tempDocIndexing, tempDocIndex]);

  useEffect(() => { setShareId(null); }, [answer]);

  const loadVaultContents = useCallback(async (vaultId) => {
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
  }, []);

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

    const tryParse = (text) => {
      const clean = text.replace(/```json|```/g, "").trim();
      try { return JSON.parse(clean); } catch {}
      const m = clean.match(/\{[\s\S]*\}/);
      if (m) try { return JSON.parse(m[0]); } catch {}
      return null;
    };

    const dedupe = (headings) => {
      // Key includes the page so repeated titles on DIFFERENT pages are all kept —
      // documents like AD Part M have several sections titled "General provisions"
      // and collapsing them loses real headings. Only true duplicates (same title,
      // same page — e.g. from overlapping indexing chunks) are removed.
      const map = {};
      for (const h of headings) {
        const key = `${h.title.toLowerCase().trim()}@p${h.pageHint || 1}`;
        if (!map[key]) map[key] = h;
      }
      return Object.values(map);
    };

    // ── Primary: text-based indexing via mupdf [Page X] markers ────────────────
    // /api/extract-text returns the full document text with physical [Page X]
    // markers injected by mupdf. Gemini reads these directly as pageHint values,
    // giving accurate physical page numbers with no offset arithmetic needed.
    // Text chunks are ~10x smaller than PDF chunks — no 413 errors.
    try {
      const { text: extractedText, hasText } = await api("/api/extract-text", { method: "POST", body: { base64 } });
      if (hasText && extractedText) {
        const TEXT_PROMPT = `Extract structural headings from this document text — chapter titles, numbered sections (e.g. 6.6, 6.6.1), named sub-sections, AND the titles of all numbered tables, figures and diagrams (e.g. "Table 3 — Fire resistance of cavity barriers", "Figure 24 — Cavity barrier locations", "Diagram 3.1 Guarding design"). Include table, figure and diagram titles as they are essential navigation landmarks.\n\nAlso include unnumbered named sub-headings — category labels that introduce a distinct block of content even without a clause number (e.g. "Siting of pedestrian guarding", "Design of guarding", "In dwellings", "For all buildings when used by children"). In regulatory documents these are structural headings even though they carry no number.\n\nImportant: diagram and table captions often appear at the very bottom of a table block in the text. Do not treat them as table row content — they are structural titles and must be extracted as headings.\n\nDo not extract body text, bullet points, or individual table row content.\n\nThe text contains [Page X] markers showing the exact physical page number in the PDF file. Use the [Page X] number of the page the heading appears on as pageHint.\n\nOutput ONLY valid JSON: {"headings": [{"level": 1, "title": "heading text", "pageHint": 1}]}`;

        const PAGE_CHUNK_SIZE = 80;
        const pageSplit = extractedText.split(/(?=\[Page \d+\])/);
        const chunks = [];
        for (let i = 0; i < pageSplit.length; i += PAGE_CHUNK_SIZE) {
          chunks.push(pageSplit.slice(i, i + PAGE_CHUNK_SIZE).join(""));
        }

        const allHeadings = [];
        for (let c = 0; c < chunks.length; c++) {
          const chunkText = chunks[c];
          const startMatch = chunkText.match(/\[Page (\d+)\]/);
          const endMatch = chunks[c + 1]?.match(/\[Page (\d+)\]/);
          if (chunks.length > 1) {
            setStatusMsg(`Indexing ${pdfName} — pages ${startMatch?.[1] ?? "?"}–${endMatch ? String(Number(endMatch[1]) - 1) : "end"}…`);
          }
          try {
            const { text: result } = await callClaude(
              [{ role: "user", content: TEXT_PROMPT + "\n\n" + chunkText }],
              SYSTEM, 65000, 2, "gemini-2.5-flash-lite"
            );
            const parsed = tryParse(result);
            if (parsed?.headings) allHeadings.push(...parsed.headings);
          } catch (e) {
            console.warn(`${pdfName} text chunk ${c + 1} failed:`, e.message);
            if (e.message?.includes("503") || e.message?.includes("UNAVAILABLE")) {
              try {
                await new Promise(r => setTimeout(r, 3000));
                const { text: result2 } = await callClaude(
                  [{ role: "user", content: TEXT_PROMPT + "\n\n" + chunkText }],
                  SYSTEM, 65000, 1, "gemini-2.5-flash-lite"
                );
                const parsed2 = tryParse(result2);
                if (parsed2?.headings) allHeadings.push(...parsed2.headings);
              } catch (e2) {
                console.warn(`${pdfName} text chunk ${c + 1} retry also failed:`, e2.message);
              }
            }
          }
        }

        if (allHeadings.length > 0) return { headings: dedupe(allHeadings) };
        console.warn(`${pdfName}: text-based indexing returned no headings, falling back to full PDF…`);
      }
    } catch (e) {
      console.warn(`${pdfName}: text extraction failed (${e.message}), falling back to full PDF…`);
    }

    // ── Fallback: full PDF visual (less accurate pages, but better than nothing) ─
    const INDEX_PROMPT = `Extract structural headings from this document — chapter titles, numbered sections (e.g. 6.6, 6.6.1), named sub-sections, AND the titles of all numbered tables, figures and diagrams (e.g. "Table 3 — Fire resistance of cavity barriers", "Figure 24 — Cavity barrier locations", "Diagram 3.1 Guarding design"). Include table, figure and diagram titles as they are essential navigation landmarks.\r\n\r\nAlso include unnumbered named sub-headings — category labels that introduce a distinct block of content even without a clause number (e.g. "Siting of pedestrian guarding", "Design of guarding", "In dwellings", "For all buildings when used by children"). In regulatory documents these are structural headings even though they carry no number.\r\n\r\nImportant: diagram and table captions often appear at the very bottom of a table block. Do not treat them as table row content — they are structural titles and must be extracted as headings.\r\n\r\nDo not extract body text, bullet points, or individual table row content.\r\n\r\nFor pageHint, use only the position of the page within this PDF file — page 1 is the first page of this file, page 2 is the second, etc. Ignore all printed page numbers on the pages.\r\n\r\nOutput ONLY valid JSON: {"headings": [{"level": 1, "title": "heading text", "pageHint": 1}]}`;

    try {
      const { text: result } = await callClaude(
        [{ role: "user", content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 }, title: pdfName },
          { type: "text", text: INDEX_PROMPT }
        ]}],
        SYSTEM, 65000, 2, "gemini-2.5-flash-lite"
      );
      const parsed = tryParse(result);
      if (parsed?.headings?.length > 0) {
        return { headings: dedupe(parsed.headings) };
      }
      console.warn(`${pdfName}: full-PDF index returned no headings`);
    } catch (e) {
      console.warn(`${pdfName}: full-PDF indexing failed (${e.message})`);
    }

    return { headings: [] };
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

  // ── Retry wrapper for transient Gemini errors ────────────────────────────────
  const withRetry = async (fn, retries = 3, delayMs = 4000, label = "") => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const isTransient = err.message?.includes("503") ||
          err.message?.includes("UNAVAILABLE") ||
          err.message?.includes("timed out") ||
          err.message?.includes("overloaded");
        if (isTransient && attempt < retries) {
          const wait = delayMs * attempt;
          setStatusMsg(`${label} — Gemini busy, retrying in ${wait / 1000}s… (attempt ${attempt}/${retries})`);
          await new Promise(r => setTimeout(r, wait));
        } else {
          throw err;
        }
      }
    }
  };

  // ── 3-pass Q&A pipeline ───────────────────────────────────────────────────────
  const askQuestion = async (overrideVaultId = null, overrideQuestion = null) => {
    // usingTempOnly: no vault selected, OR vault selected but mode is "query temp doc directly"
    const usingTempOnly = tempDoc && (!vault || tempDocMode === "query-temp");
    const effectiveQuestion = overrideQuestion || question;
    if ((!vault && !tempDoc) || !effectiveQuestion.trim()) return;
    const q = effectiveQuestion.trim();
    setAnswer(null);
    setCostEst(null);
    setAnswerVaultName("");
    setCitationPageMap({});
    setFollowUpQuestion("");
    setFollowUpVaultId("");
    setLastQuestion(q);
    setTimedOut(false);
    setStage("selecting");
    setProgress({ index: 100, select: 0, read: 0, answer: 0 });
    setStatusMsg("Pass 1/3 · Reading contents pages and scoring sections…");

    // Resolve override vault data if a cross-vault follow-up
    let overrideVault = null;
    let overrideIndex = null;
    let overridePdfs = null;
    if (overrideVaultId) {
      try {
        setStatusMsg("Loading vault for follow-up…");
        const [pdfsData, indexFetch] = await Promise.all([
          api(`/api/vaults/${encodeURIComponent(overrideVaultId)}/pdfs`),
          api(`/api/vaults/${encodeURIComponent(overrideVaultId)}/index`)
            .then(data => ({ ok: true, data }))
            .catch(() => ({ ok: false })),
        ]);
        // Find vault object from all vaults (flat + sub)
        for (const v of vaults) {
          if (v.id === overrideVaultId) { overrideVault = v; break; }
          if (v.type === "master") {
            const sub = (v.subVaults || []).find(sv => sv.id === overrideVaultId);
            if (sub) { overrideVault = sub; break; }
          }
        }
        if (!indexFetch.ok) {
          setStage(null);
          setStatusMsg("Could not connect to vault — please try again.");
          return;
        }
        if (indexFetch.data === null) {
          setStage(null);
          setStatusMsg("That vault has not been indexed yet — select it and click Re-Index before asking a question.");
          return;
        }
        overrideIndex = indexFetch.data;
        overridePdfs = pdfsData.pdfs || [];
      } catch (e) {
        setStage(null);
        setStatusMsg("Could not connect to vault — please try again.");
        return;
      }
    }

    // Effective vault/index/pdfs for this query
    const effectiveVault = overrideVault || vault;
    const effectiveVaultIndex = overrideIndex || vaultIndex;
    const effectivePdfs = overridePdfs || pdfs;

    // If still running after 2 minutes, reassure the user it hasn't stalled.
    // Cleared in the finally below the moment the answer arrives or errors out.
    const slowWarnTimer = setTimeout(() => {
      setStatusMsg("⏳ Still working — this answer is taking longer than usual. Large documents or heavy demand on the AI can slow things down. It's still running, please hold on…");
    }, 120000);

    try {
      // ── Temp doc only mode — wait for background index then run full pipeline ──
      let resolvedTempIndex = null;
      if (usingTempOnly) {
        // Wait for background indexing to complete if still running
        if (tempDocIndexRef.current && typeof tempDocIndexRef.current.then === "function") {
          setStatusMsg("Waiting for document to finish indexing…");
          resolvedTempIndex = await tempDocIndexRef.current;
        } else {
          resolvedTempIndex = tempDocIndexRef.current; // already resolved
        }
        if (!resolvedTempIndex) {
          setStage(null);
          setStatusMsg("Document indexing failed — please try removing and re-uploading the file.");
          return; // question was never cleared so nothing to restore
        }
      }

      // Committed to running — now clear the question input
      if (!overrideQuestion) setQuestion("");

      const useAllSubVaults = !overrideVaultId && queryScope === "all" && parentMaster;
      const activeIndex = resolvedTempIndex ? resolvedTempIndex
        : useAllSubVaults ? await buildCombinedIndex() : effectiveVaultIndex;

      // ── PASS 1: Score index ──────────────────────────────────────────────────
      setStatusMsg("Pass 1/3 · Scoring index — identifying relevant sections…");

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
          .filter(h => !crowdedPages.has(h.pageHint) || /^(table|figure|diagram)\s+\d+/i.test(h.title.trim()))
          .map(h => `${"  ".repeat(Math.max(1, h.level || 1))}p${h.pageHint || 1}: ${h.title}`)
          .join("\n");
        return `DOCUMENT: ${doc.name}\n${headings}`;
      }).join("\n\n");

      setProgress(p => ({ ...p, select: 30 }));

      const recentHistory = conversationHistory.slice(-5);
      const conversationContext = recentHistory.length > 0
        ? `\n\nCONVERSATION HISTORY (this is a continuing conversation — the current question may be a follow-up to earlier questions):\n${recentHistory.map((h, i) => `Q${i+1}: ${h.question}\nA${i+1}: ${h.answer.slice(0, 600)}…`).join("\n\n")}`
        : "";

      const scoringPrompt = `You are an expert technical document analyst. Using ONLY the document index below, identify which specific sections and pages are most likely to contain the answer to the question.\n\nDOCUMENT INDEX (headings, sections and page numbers extracted from vault documents):\nINDEX FORMAT: each heading is indented to show its level in the document structure — deeper indentation means a sub-section of the heading above it. When you score any heading, also score its parent headings (less indented, above it) at the same or similar probability, as parent sections contain requirements that govern their sub-sections.\n${indexSummary}\n${conversationContext}\n\nQUESTION: ${q}\n${recentHistory.length > 0 ? "NOTE: This may be a follow-up question. Use the conversation history above to understand the full context before scoring." : ""}\n\nAnalyse the index carefully. For every section that could possibly be relevant — even tangentially — assign a probability score. Building regulations frequently contain cross-references, exceptions and caveats in unexpected sections. Be CONSERVATIVE — it is better to include a borderline section than to miss critical information.\n\nNOTE: Select ALL sections that are relevant to the question — do not limit to just one section if multiple sections are relevant.\n\nTABLES AND FIGURES: If the question relates to a requirement that is likely defined or quantified in a table or figure (e.g. fire resistance ratings, dimensions, classifications), you MUST also select any table or figure entries in the index that are likely to contain that data. For example, if the index contains "Table 3 — Fire resistance of cavity barriers" or "Table 5 — Minimum fire resistance", select those entries with high probability. Never rely solely on clause text pages when the actual values are in a table.\n\nDUTY CLAUSES AND IMPLEMENTATION SECTIONS: Building regulations pair high-level duty clauses (e.g. K2 'Protection from falling', B3 'Internal fire spread') with practical implementation sections that follow later in the same document (e.g. 'Section 3: Protection from falling', 'Design of guarding', 'Siting of pedestrian guarding'). The duty clause states the legal obligation only — the specific heights, dimensions, and values are always in the implementation sections. For any question asking for a specific measurement, height, distance, or threshold, you MUST select BOTH the duty clause AND the implementation sections from the same document. Never select only the duty clause and assume it contains the values — it does not.\n\nRespond ONLY as compact JSON — no other text, no explanations, no reasons:\n{\n  "selectedDocs": [\n    {\n      "docName": "exact filename from index",\n      "sections": [\n        {"heading": "exact heading from index", "pageHint": 42, "probability": 0.95}\n      ]\n    }\n  ]\n}\n\nRules:\n- Include sections with probability > 0.5\n- pageHint MUST be a plain integer. Never use "p.12" or "page 12". Use 1 if unknown.\n- Omit "styleNotes", "reason" and "crossRefs" fields entirely — keep JSON compact`;

const { text: scoringText, usage: scoringUsage } = await withRetry(
        () => callClaude(
          [{ role: "user", content: scoringPrompt }],
          "You are a technical document analyst. Score document sections for relevance using only the text index provided. Return pure JSON only, no markdown.",
          65000, 0, "gemini-2.5-flash"
        ), 1, 4000, "Pass 1/3 · Scoring index"
      );

      setProgress(p => ({ ...p, select: 100 }));

      // Salvage a truncated scoring response: walk back from the end, cut at the
      // last complete object, close any unbalanced brackets, and re-parse. Only
      // runs when the normal parse fails, so healthy responses are unaffected.
      const salvageScoring = (raw) => {
        let s = raw;
        for (let attempt = 0; attempt < 50; attempt++) {
          const idx = s.lastIndexOf("}");
          if (idx === -1) return null;
          s = s.slice(0, idx + 1);
          // Count unclosed brackets, ignoring those inside string literals
          let inStr = false, escaped = false;
          const stack = [];
          for (const c of s) {
            if (inStr) {
              if (escaped) escaped = false;
              else if (c === "\\") escaped = true;
              else if (c === '"') inStr = false;
              continue;
            }
            if (c === '"') inStr = true;
            else if (c === "{" || c === "[") stack.push(c);
            else if (c === "}" || c === "]") stack.pop();
          }
          const closers = stack.reverse().map(c => (c === "{" ? "}" : "]")).join("");
          try {
            const parsed = JSON.parse(s + closers);
            if (parsed?.selectedDocs?.length) return parsed;
          } catch {}
          s = s.slice(0, idx); // that cut didn't parse — try the previous }
        }
        return null;
      };

      // Gemini sometimes wraps long heading strings onto a second line — a raw
      // newline inside a JSON string literal is illegal and kills the whole parse.
      // Replace control characters that appear INSIDE quoted strings with a space;
      // everything outside strings (the JSON's own formatting) is untouched.
      const sanitizeJsonControlChars = (s) => {
        let out = "", inStr = false, escaped = false;
        for (const c of s) {
          if (inStr) {
            if (escaped) { out += c; escaped = false; continue; }
            if (c === "\\") { out += c; escaped = true; continue; }
            if (c === '"') { out += c; inStr = false; continue; }
            if (c.charCodeAt(0) < 32) { out += " "; continue; }
            out += c; continue;
          }
          if (c === '"') inStr = true;
          out += c;
        }
        return out;
      };

      let scoring = { selectedDocs: [] };
      let scoringParseError = null;
      const cleanScoringText = sanitizeJsonControlChars(scoringText.replace(/```json|```/g, "").trim());
      try {
        scoring = JSON.parse(cleanScoringText);
      } catch (e1) {
        scoringParseError = e1.message;
        const m = cleanScoringText.match(/\{[\s\S]*\}/);
        if (m) try { scoring = JSON.parse(m[0]); scoringParseError = null; } catch {}
      }

      if ((!scoring.selectedDocs || scoring.selectedDocs.length === 0) && scoringParseError) {
        console.warn(`[Scoring] Parse failed: ${scoringParseError}`);
        console.warn(`[Scoring] Response length: ${scoringText.length} chars`);
        console.warn(`[Scoring] Response tail: …${scoringText.slice(-300)}`);
        const salvaged = salvageScoring(cleanScoringText);
        if (salvaged) {
          const sectionCount = salvaged.selectedDocs.reduce((n, d) => n + (d.sections?.length || 0), 0);
          console.warn(`[Scoring] Salvaged truncated response: ${salvaged.selectedDocs.length} docs, ${sectionCount} sections recovered`);
          scoring = salvaged;
        }
      }

      if (!scoring.selectedDocs || scoring.selectedDocs.length === 0) {
        console.warn("Scoring returned empty — raw response:", scoringText.slice(0, 500));
      }

      // ── General provisions: discovered server-side during page extraction ────────
      // The stored vault index collapses duplicate heading titles (e.g. the several
      // "General provisions" sections in AD Part M), so it cannot be trusted to list
      // every occurrence. Instead the extract-pages worker scans the live document
      // text for "General …" heading lines and includes those pages automatically.
      // Titles are collected here and added to PRIORITY SECTIONS so Pass 3 reads them.
      const generalSectionTitles = []; // "docName: title (p.X)"

      // ── Replace Gemini page estimates with accurate vault-index page numbers ─────
      // The vault index stores physical [Page X] numbers from mupdf — far more
      // reliable than Gemini's Pass 1 guesses, which can be off by several pages.
      const normalizeHeading = s => s.toLowerCase().replace(/[^a-z0-9.\s]+/g, ' ').replace(/\s+/g, ' ').trim();
      (scoring.selectedDocs || []).forEach(selectedDoc => {
        const indexDoc = (activeIndex.documents || []).find(d =>
          d.name === selectedDoc.docName ||
          d.name.includes(selectedDoc.docName) ||
          selectedDoc.docName.includes(d.name)
        );
        if (!indexDoc) return;
        const headingPageMap = {};
        (indexDoc.headings || []).forEach(h => {
          if (h.pageHint) headingPageMap[normalizeHeading(h.title)] = h.pageHint;
        });
        (selectedDoc.sections || []).forEach(section => {
          const key = normalizeHeading(section.heading || "");
          if (key && headingPageMap[key]) section.pageHint = headingPageMap[key];
        });
      });

      // ── Build citation page map — docName → { page, vaultId, fileName } ────────
      // Built now so AnswerRenderer can link citations to their source PDF + page
      const newCitationPageMap = {};
      (scoring.selectedDocs || []).forEach(selectedDoc => {
        const rawDocName = selectedDoc.docName;
        (selectedDoc.sections || []).forEach(section => {
          const page = typeof section.pageHint === "number" ? section.pageHint : parseInt(section.pageHint);
          if (!page || page < 1) return;
          const key = rawDocName;
          // Take the lowest (first) page hint per doc as a fallback, highest-prob section wins
          if (!newCitationPageMap[key] || section.probability > (newCitationPageMap[key]._prob || 0)) {
            // We'll resolve vaultId/fileName in Pass 2 once we know which sub-vault matched
            newCitationPageMap[key] = { page, vaultId: null, fileName: null, _prob: section.probability || 0 };
          }
          // Also store per-heading for finer-grained matching
          const headingKey = `${rawDocName}||${(section.heading || "").toLowerCase().trim()}`;
          if (!newCitationPageMap[headingKey]) {
            newCitationPageMap[headingKey] = { page, vaultId: null, fileName: null };
          }
        });
      });
      setStatusMsg("Pass 1/3 · Loading documents for page extraction…");

      const contentsData = [];
      const selectedDocNames = (scoring.selectedDocs || []).map(d => d.docName);

      if (useAllSubVaults) {
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
        for (const docName of selectedDocNames) {
          if (contentsData.find(c => c.pdf.name === docName)) continue;
          let found = allSubVaultPdfs.find(p => p.prefixedName === docName);
          if (!found) {
            const filenamePart = docName.includes(">>") ? docName.split(">>").pop().trim()
              : docName.includes("]") ? docName.split("]").pop().trim()
              : docName;
            found = allSubVaultPdfs.find(p =>
              p.fileName === filenamePart || p.fileName.includes(filenamePart) || filenamePart.includes(p.fileName)
            );
          }
          if (!found) {
            const lower = docName.toLowerCase();
            found = allSubVaultPdfs.find(p =>
              p.prefixedName.toLowerCase().includes(lower) ||
              lower.includes(p.fileName.toLowerCase().replace(/\.pdf$/i, ""))
            );
          }
          if (!found) { console.warn(`Could not match scoring docName "${docName}" to any sub-vault PDF`); continue; }
          // Resolve vaultId + fileName into citation map
          [docName, ...Object.keys(newCitationPageMap).filter(k => k.startsWith(`${docName}||`))].forEach(k => {
            if (newCitationPageMap[k]) { newCitationPageMap[k].vaultId = found.subVault.id; newCitationPageMap[k].fileName = found.fileName; }
          });
          try {
            const pdfData = await api(`/api/vaults/${encodeURIComponent(found.subVault.id)}/pdfs/${encodeURIComponent(found.fileName)}`);
            contentsData.push({ pdf: { name: found.prefixedName, size: 0 }, base64: pdfData.base64 });
          } catch (e) {
            console.warn(`Could not load ${found.fileName} from ${found.subVault.name}:`, e);
          }
        }
      } else if (usingTempOnly && resolvedTempIndex) {
        // Temp doc only mode — base64 already in memory, no server fetch needed
        // Mark all citation map entries as temp (no vaultId fetch needed — we have base64 in memory)
        Object.keys(newCitationPageMap).forEach(k => {
          newCitationPageMap[k].vaultId = "__temp__";
          newCitationPageMap[k].fileName = tempDoc.name;
        });
        contentsData.push({ pdf: { name: tempDoc.name, size: 0 }, base64: tempDoc.base64 });
      } else {
        const docsNeeded = effectivePdfs.filter(p =>
          selectedDocNames.some(n => p.name.includes(n) || n.includes(p.name))
        );
        if (docsNeeded.length === 0) {
          setStage(null);
          setStatusMsg("No relevant documents found for that question — try rephrasing.");
          return;
        }
        for (const pdf of docsNeeded) {
          // Resolve citation map entries that match this PDF
          selectedDocNames.forEach(docName => {
            if (pdf.name.includes(docName) || docName.includes(pdf.name)) {
              [docName, ...Object.keys(newCitationPageMap).filter(k => k.startsWith(`${docName}||`))].forEach(k => {
                if (newCitationPageMap[k]) { newCitationPageMap[k].vaultId = effectiveVault.id; newCitationPageMap[k].fileName = pdf.name; }
              });
            }
          });
          try {
            const pdfData = await api(`/api/vaults/${encodeURIComponent(effectiveVault.id)}/pdfs/${encodeURIComponent(pdf.name)}`);
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
        if (!isNaN(directInt) && directInt > 0 && directInt < 9999) { pages.add(directInt); return pages; }
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
          section.pages.forEach(p => { lookahead.forEach(offset => { const pg = p + offset; if (pg > 0 && !docPageMap[docName].pages.has(pg)) pagesToAdd.push(pg); }); });
          pagesToAdd.sort((a, b) => a - b);
          for (const p of pagesToAdd) {
            if (docBudget <= 0 || budgetRemaining <= 0) break;
            docPageMap[docName].pages.add(p);
            docBudget--; budgetRemaining--;
          }
        }
      }

      if (budgetRemaining > 0) {
        for (const section of allScoredSections) {
          if (budgetRemaining <= 0) break;
          const key = section.docName;
          if (!docPageMap[key]) docPageMap[key] = { contentsDoc: section.contentsDoc, pages: new Set() };
          const pagesToAdd = [];
          section.pages.forEach(p => { [0, 1].forEach(offset => { const pg = p + offset; if (pg > 0 && !docPageMap[key].pages.has(pg)) pagesToAdd.push(pg); }); });
          pagesToAdd.sort((a, b) => a - b);
          for (const p of pagesToAdd) {
            if (budgetRemaining <= 0) break;
            if (!docPageMap[key].pages.has(p)) { docPageMap[key].pages.add(p); budgetRemaining--; }
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
        if (val.pages.size === 0) { for (let i = 1; i <= 5; i++) val.pages.add(i); }
      });

      const docBlocks = [];
      const extractionMeta = []; // links each vault doc block to its source + priority-ordered pages, for byte-budget trimming
      let totalPagesExtracted = 0;

      for (const [docName, { contentsDoc, pages }] of Object.entries(docPageMap)) {
        setStatusMsg(`Pass 2/3 · Extracting pages from ${docName}…`);
        // Set preserves insertion order = the order pages were chosen (highest
        // priority first). Kept for trimming; sorted copy used for extraction.
        const orderedPages = Array.from(pages);
        const pageList = [...orderedPages].sort((a, b) => a - b);
        if (pageList.length === 0) continue;
        try {
          const result = await api("/api/extract-pages", { method: "POST", body: { base64: contentsDoc.base64, pages: pageList, scanGeneral: true } });
          totalPagesExtracted += result.pagesExtracted;
          (result.generalSections || []).forEach(gs => {
            generalSectionTitles.push(`${docName}: ${gs.title} (p.${gs.page})`);
          });
          extractionMeta.push({ blockIdx: docBlocks.length, docName, contentsDoc, orderedPages });
          docBlocks.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: result.base64 },
            title: `${docName} — pages ${result.pageNumbers.join(", ")}`,
          });
        } catch (e) {
          console.warn(`Page extraction failed for ${docName}, skipping:`, e.message);
        }
      }

      if (tempDoc) {
        docBlocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: tempDoc.base64 },
          title: `TEMPORARY DOCUMENT (not in vault): ${tempDoc.name}`,
        });
      }

      // ── Byte budget: keep the Pass 3 request inside Gemini's ~20 MB cap ─────────
      // Oversized requests never succeed — Gemini 400s them, or the server strains
      // building the payload. If the extracted documents total too much, scale every
      // document's page list down proportionally, dropping its LOWEST-priority pages
      // (insertion order = priority). General provisions pages are re-added by the
      // server scan on re-extraction, so they survive trimming.
      const MAX_PASS3_BASE64 = 15 * 1048576;
      const blocksTotal = () => docBlocks.reduce((n, b) => n + (b.source?.data?.length || 0), 0);
      for (let round = 0; round < 2 && blocksTotal() > MAX_PASS3_BASE64; round++) {
        const total = blocksTotal();
        const factor = (MAX_PASS3_BASE64 / total) * 0.95;
        setStatusMsg("Pass 2/3 · Slimming extracted pages to fit size limits…");
        for (const meta of extractionMeta) {
          const keep = Math.max(5, Math.floor(meta.orderedPages.length * factor));
          if (keep >= meta.orderedPages.length) continue;
          const trimmedPages = meta.orderedPages.slice(0, keep);
          try {
            const r = await api("/api/extract-pages", { method: "POST", body: { base64: meta.contentsDoc.base64, pages: [...trimmedPages].sort((a, b) => a - b), scanGeneral: true } });
            console.log(`[Pass3] Trimmed "${meta.docName}" ${meta.orderedPages.length} → ${r.pageNumbers.length} pages to fit the size limit`);
            meta.orderedPages = trimmedPages;
            docBlocks[meta.blockIdx] = {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: r.base64 },
              title: `${meta.docName} — pages ${r.pageNumbers.join(", ")}`,
            };
          } catch (e) {
            console.warn(`Trim re-extraction failed for ${meta.docName}, keeping original:`, e.message);
          }
        }
      }

      setStatusMsg(`Pass 2/3 · ${totalPagesExtracted} specific pages extracted across ${docBlocks.length} document${docBlocks.length !== 1 ? "s" : ""}…`);
      setProgress(p => ({ ...p, read: 100 }));

      // ── PASS 3: Answer synthesis ───────────────────────────────────────────────
      setStage("answering");
      setStatusMsg("Pass 3/3 · Deep reading selected pages and synthesising answer…");

      const focusSections = [
        ...(scoring.selectedDocs || []).flatMap(d => (d.sections || []).map(s => `${d.docName}: ${s.heading} (p.${s.pageHint})`)),
        ...generalSectionTitles
      ].join("; ");

      const priorContext = conversationHistory.slice(-5);
      const contextBlock = priorContext.length > 0
        ? `CONVERSATION SO FAR — this question is part of a continuing discussion. Build on what has already been established rather than starting fresh. Do not repeat information already covered unless directly relevant to this new question.\n\n${priorContext.map((h, i) => `Question ${i+1}: ${h.question}\nAnswer ${i+1}: ${h.answer.slice(0, 1000)}`).join("\n\n---\n\n")}\n\n---\n\n`
        : "";

      const answerPrompt = `You are an expert building regulations consultant at an architectural practice. Use ONLY the provided document pages to answer. Write for an architectural specialist who needs detailed, accurate legislative guidance — not a general audience. IMPORTANT: Answer ONLY what was specifically asked. If the question is about one particular requirement or detail, provide exactly that and nothing else from the surrounding pages. Do not include other requirements, dimensions, or tangential information unless they directly qualify or limit the specific requirement asked about. Actively exclude content that does not answer the question.${tempDoc ? `\n\nNOTE: A temporary document has been included: "${tempDoc.name}". Treat it as an additional reference document.` : ""}\n\n${contextBlock}QUESTION: ${q}\nPRIORITY SECTIONS: ${focusSections || "all sections"}\n\n---\n\nTABLES:\n1. Output the table title on its own line in bold: **Table X — Title**\n2. Reproduce EVERY row and EVERY column — no omissions. Every row starts and ends with | pipe characters.\n3. After the header row output a separator: | --- | --- | --- |\n4. Prefix each row that directly answers the question with >>: >> | cell | cell | cell |\n   The >> appears ONCE at the row start only — do NOT repeat before each cell.\n5. Do NOT wrap tables in > blockquote syntax.\n6. Place ONE citation on its own line IMMEDIATELY BEFORE the table title.\n7. If the table spans multiple pages, combine ALL parts into one complete table.\n8. Any notes relating to the table (e.g. footnotes, qualifications) must appear as plain italic text BELOW the table — never inside the table as rows.\n9. If multiple documents contain near-identical tables: reproduce only the most complete version, then note as plain italic text below: *Note: [Other Document] Table X contains equivalent data. [Note any meaningful differences.]*\n10. Remove all PDF artefacts from table cells: strip any notation like $^{1}$, $^{(1)}$, ^{1}, or similar superscript markers. Footnote references in cells should be omitted entirely.\n\n---\n\nRESPONSE FORMAT — always in this exact order:\n\n## Summary\n\nAnswer the question directly. Do not describe the regulatory framework, explain what factors determine the answer, or say 'it depends' — just state what the regulations require. Write as if summarising the answer for a colleague: the key requirements, the applicable standards, the most important facts. No preamble, no explanation of the question, no meta-commentary. No specific dimensions or thresholds — those go in the Practical Conclusion. No inline quotes, no citation headers, no verbatim extracts.\nIf a table would help summarise the answer, create a single synthesised summary table that collates the key figures (e.g. all applicable dimensions, heights, or classifications) from your full analysis into one clear table. Do NOT reproduce a source document table — this must be your own synthesised overview. No citation before or after it. No notes. Keep it simple and direct.\n\n## Detailed Analysis\n\nBefore writing any citation block, apply this test: does this clause contain a specific, actionable requirement directly relevant to the question — a dimension, gradient, tolerance, classification, or explicit rule? If the clause text is a generic duty statement (e.g. "shall be suitable for intended use", "shall be adequate for the location", "shall be designed in accordance with relevant codes") with no specific data, omit it entirely. Only cite clauses that would change or inform a specific design decision.\n\nGroup all citations by source document. For each document that has relevant content, output a document group header on its own line:\n### Document Name (use the exact filename as it appears in the source documents)\n\nAll citation blocks for that document must appear immediately under its group header. Do not interleave citations from different documents — complete all citations for one document before starting the next.\n\nFor each citation block within a group:\n\nPART 1 — Citation header (one line):\n*Document Name | Section title*\n\nPART 2 — Full verbatim text:\nReproduce the complete relevant paragraph(s) or clause(s) exactly as written in the source. If multiple paragraphs from the same section are relevant, reproduce them together here. Do not paraphrase, do not truncate, do not add speech marks.\n\nPART 3 — Explanation (only if needed):\n*Brief italic explanation if the relevance to the question is not immediately obvious.*\n\nPART 4 — Figure note (only if a diagram, figure, or image on this page directly illustrates the clause):\n*See Fig. X.X — [one phrase describing what the figure shows]*\n\nDo not repeat information already covered in the Summary or in a previous citation block. If a clause states the same dimension, height, or requirement already cited earlier, skip it — cite only the most specific or primary source for each requirement. Omit clauses that are purely cross-references to another document — i.e. clauses whose sole content is directing the reader elsewhere, with no specific dimensions, requirements, or guidance of their own. If a clause contains even one concrete requirement alongside a cross-reference, include only the concrete requirement. Also omit introductory and document-relationship clauses — e.g. clauses explaining which documents apply together, describing the scope or structure of the document, or stating how volumes relate to each other. These typically appear in introductory sections (numbered 0.x) and contain phrases like "should be read in conjunction with", "this volume covers", or "applies to new dwellings". They add no design guidance. The test: would omitting this clause change a specific design decision? If not, omit it. Treat all sub-clauses of the same parent section as one location — do not create separate blocks for 5.3.7 and 5.3.7.4, or for 9.3.4 and 9.3.4.1. Combine all relevant sub-clauses under the parent section heading.\n\n## Contradictions & Conflicts\n\nA critical analysis of apparent contradictions between the extracted documents. Where conflicts exist, examine them substantively: quote both sides with citations, explain the nature of the conflict, and give a practical resolution. If genuinely no conflicts: "No contradictions identified."\n\n## Practical Conclusion\n\nA short, condensed follow-on to the Summary — this is where the specific numbers go. List only the key dimensions, thresholds, and practical requirements an architect needs to apply this guidance. Keep it brief: a short paragraph or a tight list of the most critical specifics only. Do NOT reproduce or paraphrase the Detailed Analysis — this is a concise conclusion, not a summary of the evidence. No citations. No document names. No section references. No explanation.\n\n---\n\nCITATION RULES:\n- Format: *Document Name | Clause number and title* — must start AND end with a single *\n- Document Name MUST be the exact filename as it appears in the document pages provided — do not paraphrase or invent a name\n- Always on its own line, never embedded within a sentence\n- Always placed BEFORE the content it supports\n- One citation block per unique source location — never repeat the same citation header\n- Treat parent sections and their sub-clauses as one location: combine them into a single block under the parent heading\n- If multiple clauses from the same document address the same requirement, combine them under one citation block — do not create a separate block per clause number\n- Draw from ALL provided documents — never rely on just one`;
      // Approximate Pass 3 request size — logged client-side so the number survives
      // even when the server crashes mid-request. Gemini's hard cap is ~20 MB.
      const pass3Bytes = docBlocks.reduce((n, b) => n + (b.source?.data?.length || 0), 0) + answerPrompt.length;
      console.log(`[Pass3] Sending ~${(pass3Bytes / 1048576).toFixed(1)} MB to the answer model (${docBlocks.length} document blocks)`);

      const { text: finalAnswer, usage: answerUsage } = await withRetry(
        () => callClaude(
          [{ role: "user", content: [...docBlocks, { type: "text", text: answerPrompt }] }],
          `You are an expert building regulations consultant writing for architectural specialists. Answer using ONLY the provided document pages. Always output in this exact order: (1) ## Summary, (2) ## Detailed Analysis, (3) ## Contradictions & Conflicts, (4) ## Practical Conclusion. Never change this order. Every citation MUST start and end with asterisks: *Document | Clause (Section)*. In Detailed Analysis, start each document's citations with a ### Document Name header on its own line and group ALL citations from that document together before moving to the next. Draw from ALL provided documents.`,
          65536, 0, "gemini-2.5-flash"
        ), 1, 5000, "Pass 3/3 · Synthesising answer"
      );

      setProgress(p => ({ ...p, answer: 100 }));
      setAnswer(finalAnswer);
      setLastAnswerIndex(activeIndex);
      setAnswerVaultName(usingTempOnly ? "Temp Doc" : (effectiveVault?.name || vault?.name || ""));
      setCitationPageMap(newCitationPageMap);
      setFollowUpQuestion("");
      setStage("done");
      setHistory(prev => [...prev, { vaultId: usingTempOnly ? "temp" : (effectiveVault?.id || "temp"), vaultName: usingTempOnly ? "Temp Doc" : (effectiveVault?.name || ""), question: q, answer: finalAnswer, timestamp: new Date() }]);
      setConversationHistory(prev => [...prev, { question: q, answer: finalAnswer }]);

      // Persist the question to this user's per-vault history (question-only, real vaults only)
      if (!usingTempOnly && effectiveVault?.id) {
        api("/api/vault-history", {
          method: "POST",
          body: { vault_id: effectiveVault.id, vault_name: effectiveVault.name || "", question: q },
        })
          .then(({ question }) => { if (question) setRecentQuestions(prev => [question, ...prev.filter(p => p.question !== question.question)]); })
          .catch(() => {});
      }

      const GEMINI_INPUT_PRICE_USD = 0.15;
      const GEMINI_OUTPUT_PRICE_USD = 0.60;
      const USD_TO_GBP = 0.79;
      const totalInput = (scoringUsage?.input_tokens || 0) + (answerUsage?.input_tokens || 0);
      const totalOutput = (scoringUsage?.output_tokens || 0) + (answerUsage?.output_tokens || 0);
      const costGBP = ((totalInput / 1_000_000) * GEMINI_INPUT_PRICE_USD + (totalOutput / 1_000_000) * GEMINI_OUTPUT_PRICE_USD) * USD_TO_GBP;
      setCostEst(costGBP);
      setStatusMsg("Answer ready");
    } catch (err) {
      console.error("askQuestion error:", err);
      setStage(null);
      if (err.message === "TIMEOUT") {
        setTimedOut(true);
        setStatusMsg("Request timed out — Gemini is experiencing high traffic.");
      } else if (err.message && err.message.includes('rate_limit')) {
        setStatusMsg('Rate limit reached — retrying automatically in 15 seconds…');
      } else {
        setStatusMsg("Error: " + (err.message || String(err)));
      }
    } finally {
      clearTimeout(slowWarnTimer);
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

  const [citationViewer, setCitationViewer] = useState(null); // { base64, fileName, page }
  const docTextCacheRef = useRef({}); // fileName → [{ page, text }] — extracted text cache for clause-number page lookup

  // ── Look up the physical page for a heading from the vault index ──────────────
  // Uses the index stored when the last question was answered — the authoritative
  // source of page numbers (from mupdf [Page X] markers, not Gemini estimates).
  // Four matching levels tried in order; first hit wins.
  const findPageInVaultIndex = (fileName, headingText) => {
    if (!lastAnswerIndex?.documents || !headingText) return null;
    const stripPdf = s => (s || "").replace(/\.pdf$/i, "").trim();
    const indexDoc = lastAnswerIndex.documents.find(d => {
      const dn = stripPdf(d.name).toLowerCase();
      const fn = stripPdf(fileName).toLowerCase();
      return dn === fn || dn.includes(fn) || fn.includes(dn);
    });
    if (!indexDoc?.headings?.length) return null;

    // Type-aware candidate set: a citation for "Diagram 3.1" must only match
    // index headings that are themselves a Diagram/Table/Figure — never plain
    // section "3.1", which starts on a different page. Citations without a
    // type word skip diagram/table/figure headings for the same reason.
    // diagram/figure/fig are treated as one type (documents vary in naming).
    const typeOf = (s, anchored) => {
      const m = (s || "").match(anchored ? /^\s*(diagram|table|figure|fig)\b/i : /\b(diagram|table|figure|fig)\b/i);
      if (!m) return null;
      const t = m[1].toLowerCase();
      return t === "table" ? "table" : "figure";
    };
    const citType = typeOf(headingText, false);
    const candidates = indexDoc.headings.filter(h => typeOf(h.title, true) === citType);
    if (!candidates.length) return null;

    // Level 1: exact case-insensitive match
    const target = headingText.toLowerCase().trim();
    let h = candidates.find(h => h.title.toLowerCase().trim() === target);
    if (h?.pageHint) return h.pageHint;

    // Level 2: normalised match — keep dots (preserves "5.3"), strip other special chars
    const norm = s => s.toLowerCase().replace(/[^a-z0-9.\s]/g, " ").replace(/\s+/g, " ").trim();
    const nt = norm(headingText);
    h = candidates.find(h => norm(h.title) === nt);
    if (h?.pageHint) return h.pageHint;

    // Level 3: clause number prefix match — "5.3", "B3", "K2", "AD-B3" etc.
    const cnMatch = headingText.match(/\b([A-Z]?\d[\d.]*[A-Za-z]?)\b/i);
    if (cnMatch) {
      const cn = cnMatch[1].toLowerCase();
      h = candidates.find(h => {
        const m = h.title.match(/\b([A-Z]?\d[\d.]*[A-Za-z]?)\b/i);
        return m && m[1].toLowerCase() === cn;
      });
      if (h?.pageHint) return h.pageHint;
    }

    // Level 4: all significant words (>3 chars) appear in the vault heading
    const sigWords = s => s.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(w => w.length > 3);
    const tw = sigWords(headingText);
    if (tw.length >= 2) {
      h = candidates.find(h => {
        const hw = sigWords(h.title);
        return tw.every(w => hw.includes(w));
      });
      if (h?.pageHint) return h.pageHint;
    }

    return null;
  };

  // ── Find the exact page of a numbered clause by searching the document text ───
  // Paragraph numbers (3.36, 5.3.7, B1) are unique within a document, unlike
  // headings — Approved Documents repeat near-identical headings across chapters
  // (e.g. "Sanitary facilities — General provisions" in both M4(2) and M4(3)).
  // Searching the real text for the line that starts with the clause number gives
  // the definitive page. Text is fetched once per document and cached.
  const findPageByClauseNumber = async (base64, fileName, headingText) => {
    if (!headingText) return null;
    // Skip diagram/table/figure citations — the type-aware index lookup handles those
    if (/\b(diagram|table|figure|fig)\b/i.test(headingText)) return null;
    // Clause number must be dotted (3.36, 5.3.7) or letter+digits (B1, K2) —
    // bare integers like "2" are too ambiguous to search for, and category
    // references like "M4(2)" are excluded (the bracket is part of the name)
    const cnMatch = headingText.match(/\b(\d+(?:\.\d+)+|[A-Z]\d+(?!\())\b/);
    if (!cnMatch) return null;
    const clause = cnMatch[1];

    let pages = docTextCacheRef.current[fileName];
    if (!pages) {
      const { text, hasText } = await api("/api/extract-text", { method: "POST", body: { base64 } });
      if (!hasText || !text) return null;
      pages = text.split(/(?=\[Page \d+\])/).map(chunk => {
        const m = chunk.match(/^\[Page (\d+)\]/);
        return m ? { page: Number(m[1]), text: chunk } : null;
      }).filter(Boolean);
      docTextCacheRef.current[fileName] = pages;
    }

    // Line-anchored match: the clause number at the start of a line, not followed
    // by further digits or dots (so "3.3" never matches "3.36" or "3.3.1")
    const escaped = clause.replace(/\./g, "\\.");
    const clauseRe = new RegExp(`(^|\\n)\\s*${escaped}(?![\\d.])`);

    // A clause number can appear at a line start on several pages. The first one is
    // often a reference/contents table that LISTS the clause rather than the page
    // that DEFINES it — e.g. NHBC chapters open with a "Figure Reference Table" that
    // packs dozens of clause numbers (one per line) onto a single page, which sits
    // before the real clause. mupdf linearises that table cell-by-cell, so every
    // clause number lands at a line start there. The real clause page is sparse, so
    // among the matching pages pick the one with the FEWEST clause-style numbers.
    // Ties keep the earliest page (the original "first match" behaviour). This leaves
    // Approved Documents unchanged — they have no such dense tables (density 0).
    const clauseToken = /\d+(?:\.\d+){2,}/g;
    const matches = pages.filter(p => clauseRe.test(p.text));
    if (matches.length === 0) return null;
    let best = matches[0];
    let bestDensity = (best.text.match(clauseToken) || []).length;
    for (const p of matches.slice(1)) {
      const density = (p.text.match(clauseToken) || []).length;
      if (density < bestDensity) { best = p; bestDensity = density; }
    }
    return best.page;
  };

  // ── Open PDF viewer at page from citation ────────────────────────────────────
  const handleCitationClick = async (docName, rawHeading) => {
    // Gemini embeds the exact page number in citations: "Clause 5.3 [p.12]"
    // Extract it first — this is the definitive page, no guessing needed.
    const pageTagMatch = (rawHeading || "").match(/\[p\.(\d+)\]/i);
    const explicitPage = pageTagMatch ? parseInt(pageTagMatch[1]) : null;
    const heading = rawHeading ? rawHeading.replace(/\s*\[p\.\d+\]\s*$/i, "").trim() : rawHeading;
    const headingKey = `${docName}||${(heading || "").toLowerCase().trim()}`;
    const entry = citationPageMap[headingKey] || citationPageMap[docName];

    let resolved = entry;
    if (!resolved) {
      const lower = docName.toLowerCase();
      // Extract part letter e.g. "K" from "Approved Document K" or "AD Part K - ..."
      const partLetter = s => { const m = s.match(/(?:approved\s+document|ad\s+part|part)\s+([a-z])\b/i); return m ? m[1].toLowerCase() : null; };
      const citationPart = partLetter(docName);
      const normalize = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const normCitation = normalize(docName);
      const fallbackKey = Object.keys(citationPageMap).find(k => {
        const keyBase = k.split("||")[0];
        if (citationPart && partLetter(keyBase) === citationPart) return true;
        const normKey = normalize(keyBase);
        return normKey.includes(normCitation) || normCitation.includes(normKey);
      });
      resolved = fallbackKey ? citationPageMap[fallbackKey] : null;
    }

    if (!resolved || !resolved.vaultId || !resolved.fileName) {
      alert("Sorry — could not locate the source document for this citation.");
      return;
    }

    try {
      let base64;
      if (resolved.vaultId === "__temp__") {
        base64 = tempDoc?.base64;
      } else {
        const pdfData = await api(`/api/vaults/${encodeURIComponent(resolved.vaultId)}/pdfs/${encodeURIComponent(resolved.fileName)}`);
        base64 = pdfData.base64;
      }
      if (!base64) { alert("Could not load the PDF."); return; }
      let clausePage = null;
      try {
        clausePage = await findPageByClauseNumber(base64, resolved.fileName, heading);
      } catch (e) {
        console.warn("Clause-number page search failed, falling back to index:", e.message);
      }
      const indexPage = findPageInVaultIndex(resolved.fileName, heading);
      setCitationViewer({ base64, fileName: resolved.fileName, page: clausePage || indexPage || explicitPage || resolved.page || 1, heading });
    } catch (e) {
      alert("Failed to load PDF: " + e.message);
    }
  };

  // ── Global styles ─────────────────────────────────────────────────────────────
  const globalStyles = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #f5f3f0; } ::-webkit-scrollbar-thumb { background: #c8c0b8; border-radius: 2px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    .vault-item { cursor: pointer; transition: all 0.2s; }
    .vault-item:hover { background: ${DESIGN_GROUND} !important; }
    .master-item { cursor: pointer; transition: all 0.2s; }
    .master-item:hover { background: rgba(0,0,0,0.04) !important; }
    .btn { cursor: pointer; transition: all 0.2s; border: none; font-family: Inter, Arial, sans-serif; letter-spacing: 0.01em; }
    .btn:hover { opacity: 0.85; }
    .btn:disabled { cursor: not-allowed; opacity: 0.35; }
    .arc-input:focus { outline: 2px solid ${VAULT_FULL}; outline-offset: 0; }
    body { font-family: Inter, Arial, sans-serif; }
  `;

  // ── Auth loading screen ───────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: DESIGN_GROUND, fontFamily: "Inter, Arial, sans-serif" }}>
        <style>{globalStyles}</style>
        <Spinner size={20} />
      </div>
    );
  }

  // ── Login screen ──────────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div style={{ fontFamily: "Arial, sans-serif", background: DESIGN_SHELL, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <style>{globalStyles}</style>
        <div style={{ background: DESIGN_SHELL, padding: "20px 40px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ color: "#fff", fontSize: 14, fontWeight: 500, letterSpacing: ".22em", textTransform: "uppercase", fontFamily: "Inter, Arial, sans-serif" }}>Archimind</span>
          <span style={{ color: DESIGN_MUTED, fontSize: 9, letterSpacing: ".16em", textTransform: "uppercase" }}>Document Intelligence</span>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: DESIGN_GROUND }}>
          <div style={{ background: "#ffffff", padding: "48px 48px", width: 400, borderTop: `3px solid ${COMPARE_FULL}` }}>
            <p style={{ fontSize: 11, color: DESIGN_MUTED, marginBottom: 32, letterSpacing: "0.1em", textTransform: "uppercase" }}>Secure Access</p>
            <label style={{ fontSize: 9, fontWeight: 500, color: DESIGN_MUTED, display: "block", marginBottom: 8, letterSpacing: ".16em", textTransform: "uppercase" }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setLoginError(""); }}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              autoFocus
              className="arc-input"
              style={{ width: "100%", border: loginError ? `1px solid ${COMPARE_FULL}` : `1px solid #e4e4e8`, padding: "12px 14px", fontSize: 14, marginBottom: 14, outline: "none", fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, background: "#f8f8fa" }}
            />
            <label style={{ fontSize: 9, fontWeight: 500, color: DESIGN_MUTED, display: "block", marginBottom: 8, letterSpacing: ".16em", textTransform: "uppercase" }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setLoginError(""); }}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              className="arc-input"
              style={{ width: "100%", border: loginError ? `1px solid ${COMPARE_FULL}` : `1px solid #e4e4e8`, padding: "12px 14px", fontSize: 14, marginBottom: 6, outline: "none", fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, background: "#f8f8fa" }}
            />
            {loginError && <p style={{ color: COMPARE_FULL, fontSize: 12, marginBottom: 16, letterSpacing: "0.02em" }}>{loginError}</p>}
            <button className="btn" onClick={handleLogin} disabled={loggingIn}
              style={{ marginTop: 20, width: "100%", background: DESIGN_SHELL, color: "#fff", padding: "12px 0", fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {loggingIn ? <><Spinner size={13} /> Signing in…</> : "Sign In"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main UI ───────────────────────────────────────────────────────────────────
  const NAV_LABELS = {
    vault: "Vault",
    compare: "Data Sheet Compare",
    library: "Product Library",
    projects: "Projects",
    timesheets: "Timesheets",
  };

  const NAV_SECTIONS = isAdmin
    ? ["vault", "compare", "library", "projects", "timesheets"]
    : ["vault", "timesheets"];

  return (
    <div style={{ fontFamily: "Arial, sans-serif", background: DESIGN_GROUND, minHeight: "100vh", color: "#0b0c0c", display: "flex", flexDirection: "column" }}>
      <style>{globalStyles}</style>

      {showManageModal && (
        <VaultManagementModal
          vaults={vaults}
          onClose={() => setShowManageModal(false)}
          onRefresh={async () => { await loadVaults(); }}
          isAdmin={isAdmin}
        />
      )}

      {showQuiz && <QuizModal onClose={() => setShowQuiz(false)} />}
      {showShareModal && answer && (
        <ShareModal
          question={lastQuestion}
          answer={answer}
          vaultName={answerVaultName}
          shareId={shareId}
          setShareId={setShareId}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {/* Top nav */}
      <div style={{ background: DESIGN_SHELL, padding: "0 40px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, height: 56, borderBottom: "1px solid #1e2028" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button className="btn" onClick={() => navigate("home")}
            style={{ background: "none", color: "#fff", fontSize: 14, fontWeight: 500, letterSpacing: ".22em", textTransform: "uppercase", padding: 0 }}>
            Archimind
          </button>
          <div style={{ width: 1, height: 20, background: "#3a3c40" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            {NAV_SECTIONS.map(section => (
              <button key={section} className="btn" onClick={() => navigate(section)}
                style={appSection === section
                  ? { color: "#fff", fontSize: 9, fontWeight: 500, letterSpacing: ".18em", textTransform: "uppercase", background: "transparent", border: "none", padding: "0", cursor: "pointer", borderBottom: "1px solid " + DESIGN_GOLD, paddingBottom: 3 }
                  : { color: DESIGN_MUTED, fontSize: 9, fontWeight: 500, letterSpacing: ".18em", textTransform: "uppercase", background: "transparent", border: "none", padding: "0", cursor: "pointer" }}>
                {NAV_LABELS[section] ?? section}
              </button>
            ))}
            {isAdmin && (
              <button className="btn" onClick={() => navigate("admin")}
                style={appSection === "admin"
                  ? { color: "#fff", fontSize: 9, fontWeight: 500, letterSpacing: ".18em", textTransform: "uppercase", background: "transparent", border: "none", padding: "0", cursor: "pointer", borderBottom: "1px solid " + DESIGN_GOLD, paddingBottom: 3 }
                  : { color: DESIGN_MUTED, fontSize: 9, fontWeight: 500, letterSpacing: ".18em", textTransform: "uppercase", background: "transparent", border: "none", padding: "0", cursor: "pointer" }}>
                Admin
              </button>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 9, color: "#666", letterSpacing: ".1em", textTransform: "uppercase" }}>{session?.user?.email}</span>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: DESIGN_GOLD, color: DESIGN_SHELL, fontSize: 9, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {(session?.user?.email || "").slice(0, 2).toUpperCase()}
          </div>
          <button className="btn" onClick={handleSignOut}
            style={{ fontSize: 8, color: "#888", letterSpacing: ".1em", textTransform: "uppercase", background: "transparent", border: "none", cursor: "pointer" }}>
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden", maxHeight: "calc(100vh - 56px)" }}>

        {appSection === "home" && <LandingPage onSelect={navigate} isAdmin={isAdmin} />}
        {appSection === "compare"  && isAdmin && <CompareSection key={sectionKey} vaults={vaults} isAdmin={isAdmin} />}
        {appSection === "library"  && isAdmin && <DatasheetsLibrarySection key={sectionKey} vaults={vaults} isAdmin={isAdmin} />}
        {appSection === "projects" && isAdmin && <ProjectsSection key={sectionKey} isAdmin={isAdmin} />}
        {appSection === "timesheets" && <TimesheetsSection key={sectionKey} isAdmin={isAdmin} isHr={isHr} />}
        {appSection === "schedule" && isAdmin && <ScheduleSection key={sectionKey} />}
        {appSection === "admin" && isAdmin && <AdminSection key={sectionKey} />}

        {/* ── VAULT ─────────────────────────────────────────────────────── */}
        {appSection === "vault" && <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* ── Vault section header strip ── */}
          <div style={{ background: VAULT_FULL, padding: "12px 40px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: "#fff", letterSpacing: ".16em", textTransform: "uppercase" }}>Vault</span>
            <span style={{ fontSize: 9, fontWeight: 500, color: "rgba(255,255,255,0.45)", letterSpacing: ".14em", textTransform: "uppercase" }}>— Document Intelligence</span>
          </div>

          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

          {/* Sidebar */}
          <div style={{ width: 260, borderRight: "1px solid #e8e8ea", background: "#fff", display: "flex", flexDirection: "column", flexShrink: 0 }}>
            <div style={{ padding: "20px 24px 8px", fontSize: 10, color: "#9a9088", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", borderBottom: "1px solid #e4e4e8" }}>Vaults</div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {loadingVaults ? (
                <div style={{ padding: 16, display: "flex", alignItems: "center", gap: 8, color: "#9a9088", fontSize: 12 }}><Spinner size={12} /> Loading…</div>
              ) : vaults.map(v => {
                if (v.type === "master") {
                  const isExpanded = !!expandedMasters[v.id];
                  return (
                    <div key={v.id}>
                      <div className="master-item" onClick={() => toggleMaster(v.id)}
                        style={{ padding: "10px 24px", display: "flex", alignItems: "center", gap: 8, borderLeft: "3px solid transparent" }}>
                        <span style={{ fontSize: 10, color: "#9a9088", transition: "transform 0.15s", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▶</span>
                        <span style={{ fontSize: 13, color: DESIGN_TEXT, fontWeight: 500, letterSpacing: "0.01em", flex: 1 }}>{v.name}</span>
                        <span style={{ fontSize: 10, color: "#b0a8a0" }}>{(v.subVaults || []).length}</span>
                      </div>
                      {isExpanded && (v.subVaults || []).map(sv => (
                        <div key={sv.id} className="vault-item" onClick={() => selectVault(sv.id)}
                          style={{ padding: "9px 24px 9px 44px", background: selectedVault === sv.id ? DESIGN_GROUND : "transparent", borderLeft: selectedVault === sv.id ? `3px solid ${VAULT_FULL}` : "3px solid transparent", display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 10, color: "#b0a8a0" }}>📄</span>
                          <span style={{ fontSize: 12, color: DESIGN_TEXT, fontWeight: selectedVault === sv.id ? 600 : 400, letterSpacing: "0.01em" }}>{sv.name}</span>
                        </div>
                      ))}
                      {isExpanded && (v.subVaults || []).length === 0 && (
                        <div style={{ padding: "6px 24px 6px 44px", fontSize: 11, color: "#b0a8a0", fontStyle: "italic" }}>No sub-vaults yet</div>
                      )}
                    </div>
                  );
                } else {
                  return (
                    <div key={v.id} className="vault-item" onClick={() => selectVault(v.id)}
                      style={{ padding: "12px 24px", background: selectedVault === v.id ? DESIGN_GROUND : "transparent", borderLeft: selectedVault === v.id ? `3px solid ${VAULT_FULL}` : "3px solid transparent" }}>
                      <div style={{ fontSize: 13, color: DESIGN_TEXT, fontWeight: selectedVault === v.id ? 600 : 400, letterSpacing: "0.01em" }}>{v.name}</div>
                    </div>
                  );
                }
              })}
            </div>

            {/* Temp doc upload */}
            <div style={{ borderTop: "1px solid #e4e4e8", padding: "12px 24px" }}>
              {tempDoc ? (
                <div style={{ padding: "10px 0" }}>
                  <div style={{ fontSize: 9, color: "#9a9088", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Temporary Document</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#fdf5f3", border: `1px solid ${COMPARE_FULL}`, padding: "8px 10px" }}>
                    <span style={{ fontSize: 11, color: COMPARE_FULL, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📄 {tempDoc.name}</span>
                    <button className="btn" onClick={() => { setTempDoc(null); setTempDocIndex(null); setTempDocIndexing(false); tempDocIndexRef.current = null; setTempDocMode("query-vault-with-temp"); }} title="Remove"
                      style={{ background: "none", color: COMPARE_FULL, fontSize: 14, padding: "0 2px", fontWeight: 700, lineHeight: 1, flexShrink: 0 }}>×</button>
                  </div>
                  <p style={{ fontSize: 10, color: "#b0a8a0", marginTop: 6, lineHeight: 1.5, letterSpacing: "0.02em" }}>Temporary — will not be saved. Included in all questions.</p>
                  {vault && (
                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ fontSize: 9, color: "#9a9088", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>Query mode</div>
                      <button className="btn" onClick={() => setTempDocMode("query-vault-with-temp")}
                        style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, background: tempDocMode === "query-vault-with-temp" ? DESIGN_SHELL : "transparent", color: tempDocMode === "query-vault-with-temp" ? "#fff" : "#505a5f", border: `1px solid ${tempDocMode === "query-vault-with-temp" ? DESIGN_SHELL : "#e4e4e8"}`, letterSpacing: "0.02em" }}>
                        Ask vault, using temp doc as context
                      </button>
                      <button className="btn" onClick={() => setTempDocMode("query-temp")}
                        style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, background: tempDocMode === "query-temp" ? DESIGN_SHELL : "transparent", color: tempDocMode === "query-temp" ? "#fff" : "#505a5f", border: `1px solid ${tempDocMode === "query-temp" ? DESIGN_SHELL : "#e4e4e8"}`, letterSpacing: "0.02em" }}>
                        Ask temp doc directly
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div
                  onDragOver={e => { e.preventDefault(); setTempDocDragOver(true); }}
                  onDragLeave={() => setTempDocDragOver(false)}
                  onDrop={e => { e.preventDefault(); setTempDocDragOver(false); const f = e.dataTransfer.files[0]; if (f) loadTempDoc(f); }}
                  onClick={() => tempDocInputRef.current.click()}
                  style={{ padding: "10px 0", cursor: "pointer" }}>
                  <div style={{ fontSize: 9, color: "#9a9088", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Temporary Document</div>
                  <div style={{ border: `1px dashed ${tempDocDragOver ? VAULT_FULL : "#e4e4e8"}`, padding: "10px 12px", background: tempDocDragOver ? "#f0f5f6" : "transparent", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, opacity: 0.4 }}>📎</span>
                    <span style={{ fontSize: 11, color: DESIGN_TEXT, letterSpacing: "0.01em" }}>Upload a PDF</span>
                  </div>
                  <p style={{ fontSize: 10, color: "#b0a8a0", marginTop: 6, lineHeight: 1.5, letterSpacing: "0.02em" }}>Upload a temporary PDF here to include it in your questions. It will not be saved to the vault.</p>
                  <input ref={tempDocInputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) loadTempDoc(e.target.files[0]); }} />
                </div>
              )}
            </div>

            {/* Admin controls */}
            {isAdmin && (
              <div style={{ borderTop: "1px solid #e4e4e8", padding: "12px 24px", display: "flex", flexDirection: "column", gap: 8 }}>
                {creating ? (
                  <div style={{ background: DESIGN_GROUND, padding: "12px" }}>
                    <label style={{ fontSize: 10, fontWeight: 600, color: "#9a9088", display: "block", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>New Vault Name</label>
                    <input value={newVaultName} onChange={e => setNewVaultName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && createVault()}
                      placeholder="Name" autoFocus className="arc-input"
                      style={{ width: "100%", border: `1px solid #e4e4e8`, padding: "7px 10px", fontSize: 13, color: DESIGN_TEXT, marginBottom: 8, outline: "none", background: "#f8f8fa", fontFamily: "Inter, Arial, sans-serif" }} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn" onClick={createVault} style={{ background: VAULT_FULL, color: "#fff", padding: "6px 14px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Create</button>
                      <button className="btn" onClick={() => setCreating(false)} style={{ background: "transparent", color: "#9a9088", padding: "6px 10px", fontSize: 11, border: "1px solid #e4e4e8" }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button className="btn" onClick={() => setCreating(true)}
                    style={{ width: "100%", background: "transparent", color: VAULT_FULL, padding: "8px 0", fontSize: 11, fontWeight: 600, textAlign: "center", border: `1px solid ${VAULT_FULL}`, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    + New Vault
                  </button>
                )}
                <button className="btn" onClick={() => setShowManageModal(true)}
                  style={{ width: "100%", background: "transparent", color: "#9a9088", padding: "7px 0", fontSize: 11, fontWeight: 500, textAlign: "center", border: "1px solid #e4e4e8", letterSpacing: "0.04em" }}>
                  Manage Vaults
                </button>
              </div>
            )}
          </div>

          {/* Main panel */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: DESIGN_GROUND }}>
            {!vault ? (
              tempDoc ? (
                // Temp doc loaded with no vault — show question bar directly
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  <div style={{ flex: 1, overflowY: "auto", padding: "32px" }}>
                    {isRunning ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8 }}>
                        <p style={{ fontSize: 12, color: "#9a9088" }}>{statusMsg}</p>
                      </div>
                    ) : answer ? (
                      <div style={{ maxWidth: 680, margin: "0 auto" }}>
                        <AnswerRenderer text={answer} onCitationClick={handleCitationClick} accentColor={VAULT_FULL} />
                      </div>
                    ) : statusMsg && statusMsg !== "Answer ready" ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8 }}>
                        <p style={{ fontSize: 20, color: DESIGN_TEXT, fontWeight: 300, letterSpacing: "0.02em" }}>📄 {tempDoc.name}</p>
                        <p style={{ fontSize: 12, color: COMPARE_FULL }}>{statusMsg}</p>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8 }}>
                        <p style={{ fontSize: 20, color: DESIGN_TEXT, fontWeight: 300, letterSpacing: "0.02em" }}>📄 {tempDoc.name}</p>
                        {tempDocIndexing ? (
                          <p style={{ fontSize: 12, color: "#9a9088", display: "flex", alignItems: "center", gap: 6 }}>
                            <Spinner size={11} /> Indexing document — you can ask a question while this runs…
                          </p>
                        ) : tempDocIndex ? (
                          <p style={{ fontSize: 12, color: VAULT_FULL }}>✓ Indexed — ready to query</p>
                        ) : (
                          <p style={{ fontSize: 12, color: "#9a9088", letterSpacing: "0.04em" }}>Ask a question about this document</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ padding: "16px 32px 20px", borderTop: "1px solid #e4e4e8", background: "#ffffff", flexShrink: 0 }}>
                    <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
                      <textarea ref={tempDocTextareaRef} value={question} onChange={e => setQuestion(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askQuestion(); } }}
                        placeholder="Ask a question about this document…"
                        disabled={isRunning} rows={2} className="arc-input"
                        style={{ flex: 1, border: "1px solid #e4e4e8", borderRight: "none", padding: "12px 16px", color: DESIGN_TEXT, fontSize: 13, outline: "none", resize: "none", lineHeight: 1.6, fontFamily: "Inter, Arial, sans-serif", opacity: isRunning ? 0.5 : 1, background: isRunning ? "#f8f8fa" : "#ffffff", letterSpacing: "0.01em" }} />
                      <button className="btn" onClick={() => askQuestion()} disabled={isRunning || !question.trim()}
                        style={{ background: isRunning || !question.trim() ? DESIGN_GROUND : VAULT_FULL, color: isRunning || !question.trim() ? "#9a9088" : "#ffffff", padding: "0 24px", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${isRunning || !question.trim() ? "#e4e4e8" : VAULT_FULL}`, minWidth: 90, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        {isRunning ? <Spinner size={14} /> : "Search"}
                      </button>
                    </div>
                    {conversationHistory.length > 0 && (
                      <p style={{ fontSize: 10, color: "#b0a8a0", marginTop: 6, letterSpacing: "0.04em" }}>
                        Context: {conversationHistory.length} Q&A{conversationHistory.length !== 1 ? "s" : ""} stored —{" "}
                        <span onClick={() => setConversationHistory([])} style={{ cursor: "pointer", textDecoration: "underline" }}>clear</span>
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <p style={{ fontSize: 20, color: DESIGN_TEXT, fontWeight: 300, letterSpacing: "0.02em" }}>Select a vault</p>
                  <p style={{ fontSize: 12, color: "#9a9088", letterSpacing: "0.04em" }}>Upload documents and query building regulations</p>
                </div>
              )
            ) : (
              <>
                {/* Vault header */}
                <div style={{ borderBottom: `1px solid #e4e4e8`, background: "#ffffff", flexShrink: 0 }}>
                  <div style={{ padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      {parentMaster && (
                        <div style={{ fontSize: 10, color: "#9a9088", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
                          📁 {parentMaster.name}
                        </div>
                      )}
                      <h1 style={{ fontSize: 22, fontWeight: 300, color: DESIGN_TEXT, letterSpacing: "0.01em", fontFamily: "Inter, Arial, sans-serif" }}>{vault.name}</h1>
                      <p style={{ fontSize: 11, color: "#9a9088", marginTop: 4, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                        {pdfs.length} document{pdfs.length !== 1 ? "s" : ""} &nbsp;·&nbsp;
                        {vaultIndex
                          ? <span style={{ color: VAULT_FULL, fontWeight: 600 }}>Indexed</span>
                          : <span style={{ color: COMPARE_FULL }}>Not indexed</span>}
                      </p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {parentMaster && (
                        <div style={{ display: "flex", border: `1px solid #e4e4e8`, overflow: "hidden" }}>
                          <button className="btn" onClick={() => setQueryScope("single")}
                            style={{ padding: "6px 14px", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", background: queryScope === "single" ? DESIGN_SHELL : "transparent", color: queryScope === "single" ? "#fff" : "#9a9088", border: "none" }}>
                            This vault
                          </button>
                          <button className="btn" onClick={() => setQueryScope("all")}
                            style={{ padding: "6px 14px", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", background: queryScope === "all" ? DESIGN_SHELL : "transparent", color: queryScope === "all" ? "#fff" : "#9a9088", border: "none", borderLeft: `1px solid #e4e4e8` }}>
                            All in {parentMaster.name}
                          </button>
                        </div>
                      )}
                      {pdfs.length > 0 && isAdmin && (
                        <button className="btn" onClick={indexVault} disabled={isRunning}
                          style={{ background: vaultIndex ? "transparent" : VAULT_FULL, color: vaultIndex ? VAULT_FULL : "#ffffff", border: `1px solid ${VAULT_FULL}`, padding: "8px 20px", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                          {stage === "indexing" ? <><Spinner size={12} /> Indexing…</> : vaultIndex ? "Re-index" : "Index Vault"}
                        </button>
                      )}
                      <button
                        onClick={() => setShowQuiz(true)}
                        style={{ background: "none", border: "1px solid #d0ccc8", color: "#7a7a80", padding: "4px 12px", fontSize: 11, letterSpacing: "0.04em", cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}
                      >
                        ✎ Test Yourself
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

                  {/* PDF panel */}
                  <div style={{ width: 220, borderRight: "1px solid #e4e4e8", background: DESIGN_GROUND, display: "flex", flexDirection: "column", flexShrink: 0 }}>
                    {isAdmin && (
                      <div onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}
                        onClick={() => fileInputRef.current.click()}
                        style={{ margin: 12, border: `1px dashed ${dragOver ? VAULT_FULL : "#e4e4e8"}`, padding: "14px 10px", textAlign: "center", cursor: "pointer", background: dragOver ? "#f0f5f6" : "transparent" }}>
                        {uploadingPdf ? (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: VAULT_FULL, fontSize: 12 }}><Spinner size={12} /> Uploading…</div>
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
                        <div style={{ padding: "4px 12px 4px", fontSize: 9, color: "#b0a8a0", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", display: "flex", gap: 12, borderBottom: "1px solid #e4e4e8" }}>
                          <span style={{ color: VAULT_FULL }}>● indexed</span>
                          <span style={{ color: "#c0b8b0" }}>○ pending</span>
                        </div>
                      )}
                      {pdfs.map(pdf => {
                        const isIndexed = vaultIndex?.documents?.some(d => d.name === pdf.name);
                        return (
                          <div key={pdf.id} style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 6, borderBottom: "1px solid #e4e4e8" }}>
                            <span style={{ fontSize: 8, color: isIndexed ? VAULT_FULL : "#c0b8b0", flexShrink: 0 }}>{isIndexed ? "●" : "○"}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 11, color: DESIGN_TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: "0.01em" }}>{pdf.name}</div>
                              <div style={{ fontSize: 9, color: "#b0a8a0", marginTop: 1 }}>{(pdf.size / 1024).toFixed(0)} KB</div>
                            </div>
                            {isAdmin && <>
                              <button className="btn" onClick={() => indexSinglePdf(pdf)} disabled={isRunning} title="Re-index"
                                style={{ background: "none", color: "#b0a8a0", fontSize: 11, padding: "2px 4px", lineHeight: 1, flexShrink: 0 }}
                                onMouseEnter={e => e.target.style.color = VAULT_FULL}
                                onMouseLeave={e => e.target.style.color = "#b0a8a0"}>↻</button>
                              <button className="btn" onClick={() => deletePdf(pdf)} disabled={isRunning} title="Remove"
                                style={{ background: "none", color: "#b0a8a0", fontSize: 14, padding: "2px 4px", lineHeight: 1, flexShrink: 0 }}
                                onMouseEnter={e => e.target.style.color = COMPARE_FULL}
                                onMouseLeave={e => e.target.style.color = "#b0a8a0"}>×</button>
                            </>}
                          </div>
                        );
                      })}
                      {pdfs.length === 0 && <p style={{ fontSize: 11, color: "#b0a8a0", textAlign: "center", marginTop: 24, letterSpacing: "0.02em" }}>No documents yet</p>}
                    </div>
                  </div>

                  {/* Q&A panel */}
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: DESIGN_GROUND }}>

                    {isRunning && (
                      <div style={{ padding: "14px 32px", borderBottom: "1px solid #e4e4e8", background: "#ffffff", flexShrink: 0, animation: "fadeIn 0.3s ease" }}>
                        <div style={{ fontSize: 12, color: DESIGN_TEXT, marginBottom: 10, display: "flex", alignItems: "center", gap: 8, fontWeight: 500, letterSpacing: "0.02em" }}><Spinner size={12} /> {statusMsg}</div>
                        <ProgressBar label="Pass 1 · Index scoring" pct={progress.select} color={VAULT_FULL} />
                        <ProgressBar label="Pass 2 · Page extraction" pct={progress.read} color={COMPARE_FULL} />
                        <ProgressBar label="Pass 3 · Answer synthesis" pct={progress.answer} color={DESIGN_SHELL} />
                      </div>
                    )}

                    {!isRunning && statusMsg && (
                      <div style={{ padding: "8px 24px", borderBottom: "1px solid #e4e4e8", background: "#ffffff", fontSize: 12, color: "#505a5f", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, gap: 12 }}>
                        <span style={{ color: timedOut ? COMPARE_FULL : "#505a5f" }}>{statusMsg}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {timedOut && lastQuestion && (
                            <button className="btn" onClick={() => { setTimedOut(false); setQuestion(lastQuestion); askQuestion(); }}
                              style={{ background: COMPARE_FULL, color: "#fff", padding: "4px 14px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", border: "none" }}>
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
                      <div style={{ padding: "8px 28px", background: DESIGN_GROUND, borderBottom: `1px solid #e4e4e8`, fontSize: 11, color: VAULT_FULL, display: "flex", alignItems: "center", gap: 8 }}>
                        <span>🔍</span>
                        <span>Searching across all {(parentMaster.subVaults || []).length} vaults in <strong>{parentMaster.name}</strong></span>
                      </div>
                    )}

                    <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>

                      {vaultHistory.length > 0 && (
                        <div style={{ marginBottom: 20 }}>
                          {vaultHistory.map((h, i) => (
                            <div key={i} style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: 13, color: "#505a5f", background: "#ffffff", border: "1px solid #e4e4e8", padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                                <span style={{ color: VAULT_FULL, fontWeight: 700, flexShrink: 0 }}>Q:</span>
                                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.question}</span>
                                <span style={{ fontSize: 11, color: "#6f777b", flexShrink: 0 }}>{new Date(h.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {isRunning && lastQuestion && (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 13, color: "#505a5f", background: DESIGN_GROUND, border: `1px solid #e4e4e8`, padding: "8px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                            <span style={{ color: VAULT_FULL, fontWeight: 700, flexShrink: 0 }}>Q:</span>
                            <span style={{ flex: 1 }}>{lastQuestion}</span>
                            <Spinner size={11} />
                          </div>
                        </div>
                      )}

                      {answer && (
                        <div style={{ animation: "fadeIn 0.4s ease" }}>
                          <div style={{ background: "#ffffff", border: "1px solid #e4e4e8", borderTop: `4px solid ${VAULT_FULL}`, padding: "24px 28px" }}>
                            <p style={{ fontSize: 12, color: "#505a5f", marginBottom: 16, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                              Response — {answerVaultName || (queryScope === "all" && parentMaster ? parentMaster.name + " (all vaults)" : vault.name)}
                            </p>
                            <AnswerRenderer text={answer} onCitationClick={handleCitationClick} accentColor={VAULT_FULL} />
                          </div>

                          {/* ── Follow-up: ask another vault ── */}
                          {!isRunning && allQueryableVaults.length > 1 && (
                            <div style={{ marginTop: 12, background: DESIGN_GROUND, border: "1px solid #e4e4e8", padding: "12px 16px" }}>
                              <p style={{ fontSize: 10, color: "#9a9088", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Ask another vault</p>
                              <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
                                <select
                                  value={followUpVaultId}
                                  onChange={e => setFollowUpVaultId(e.target.value)}
                                  className="arc-input"
                                  style={{ border: "1px solid #e4e4e8", padding: "8px 10px", fontSize: 12, color: DESIGN_TEXT, background: "#f8f8fa", fontFamily: "Inter, Arial, sans-serif", minWidth: 180, flexShrink: 0 }}>
                                  <option value="">— Select vault —</option>
                                  {allQueryableVaults.map(v => (
                                    <option key={v.id} value={v.id}>{v.name}</option>
                                  ))}
                                </select>
                                <textarea
                                  value={followUpQuestion}
                                  onChange={e => setFollowUpQuestion(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && followUpVaultId && followUpQuestion.trim()) { e.preventDefault(); askQuestion(followUpVaultId, followUpQuestion); } }}
                                  placeholder="Ask this vault the same or a different question…"
                                  rows={2} className="arc-input"
                                  style={{ flex: 1, border: "1px solid #e4e4e8", borderRight: "none", padding: "8px 12px", color: DESIGN_TEXT, fontSize: 12, outline: "none", resize: "none", lineHeight: 1.5, fontFamily: "Inter, Arial, sans-serif", background: "#f8f8fa", letterSpacing: "0.01em", minWidth: 200 }} />
                                <button className="btn"
                                  onClick={() => { if (followUpVaultId && followUpQuestion.trim()) askQuestion(followUpVaultId, followUpQuestion); }}
                                  disabled={!followUpVaultId || !followUpQuestion.trim()}
                                  style={{ background: !followUpVaultId || !followUpQuestion.trim() ? DESIGN_GROUND : VAULT_FULL, color: !followUpVaultId || !followUpQuestion.trim() ? "#9a9088" : "#ffffff", padding: "0 18px", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${!followUpVaultId || !followUpQuestion.trim() ? "#e4e4e8" : VAULT_FULL}`, minWidth: 70, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                                  Ask
                                </button>
                              </div>
                            </div>
                          )}
                          {/* ── Share button ── */}
                          {!isRunning && (
                            <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
                              <button
                                onClick={() => setShowShareModal(true)}
                                style={{ background: "none", border: "1px solid #d0ccc8", color: "#7a7a80", padding: "4px 12px", fontSize: 11, letterSpacing: "0.04em", cursor: "pointer", fontFamily: "Inter, Arial, sans-serif" }}
                              >
                                Share
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {!answer && !isRunning && vaultIndex && recentQuestions.length > 0 && (
                        <div style={{ marginBottom: 20 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#b0a8a0", textTransform: "uppercase", letterSpacing: "0.08em" }}>Your recent questions</span>
                            <button className="btn" onClick={clearRecentQuestions}
                              style={{ background: "none", border: "none", color: "#b0a8a0", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer", padding: "2px 4px" }}>
                              Clear all
                            </button>
                          </div>
                          {recentQuestions.map(rq => (
                            <div key={rq.id}
                              style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, border: "1px solid #e4e4e8", background: "#fafafa" }}>
                              <button className="btn" onClick={() => { setQuestion(rq.question); askQuestion(); }}
                                title="Ask this again"
                                style={{ flex: 1, textAlign: "left", background: "none", border: "none", color: "#505a5f", fontSize: 13, padding: "9px 14px", cursor: "pointer", letterSpacing: "0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {rq.question}
                              </button>
                              <button className="btn" onClick={() => deleteRecentQuestion(rq.id)}
                                title="Remove from history"
                                style={{ background: "none", border: "none", color: "#c0b8b0", fontSize: 16, lineHeight: 1, cursor: "pointer", padding: "0 12px", flexShrink: 0 }}>
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {!answer && !isRunning && vaultIndex && vaultHistory.length === 0 && recentQuestions.length === 0 && (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 10 }}>
                          <div style={{ width: 32, height: 2, background: VAULT_FULL }} />
                          <p style={{ fontSize: 16, color: DESIGN_TEXT, fontWeight: 300, letterSpacing: "0.02em" }}>Ask a question</p>
                          <p style={{ fontSize: 11, color: "#9a9088", letterSpacing: "0.03em" }}>AI selects the most relevant pages before answering</p>
                        </div>
                      )}

                      {!vaultIndex && !isRunning && pdfs.length > 0 && (
                        <div style={{ border: `1px solid ${COMPARE_FULL}`, borderLeft: `3px solid ${COMPARE_FULL}`, padding: "14px 20px", margin: "24px 0", background: "#fdf5f3" }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: DESIGN_TEXT, marginBottom: 4 }}>Vault not indexed</p>
                          <p style={{ fontSize: 12, color: "#9a9088" }}>Click Index Vault to prepare documents for searching.</p>
                        </div>
                      )}

                      {pdfs.length === 0 && !isRunning && (
                        <div style={{ border: `1px solid #e4e4e8`, borderLeft: `3px solid ${VAULT_FULL}`, padding: "14px 20px", margin: "24px 0", background: DESIGN_GROUND }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: DESIGN_TEXT, marginBottom: 4 }}>No documents uploaded</p>
                          <p style={{ fontSize: 12, color: "#9a9088" }}>Use the panel on the left to upload PDF documents to this vault.</p>
                        </div>
                      )}
                    </div>

                    {(vaultIndex || (queryScope === "all" && parentMaster) || tempDoc) && (
                      <div style={{ padding: "16px 32px 20px", borderTop: `1px solid #e4e4e8`, background: "#ffffff", flexShrink: 0 }}>
                        <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
                          <textarea value={question} onChange={e => setQuestion(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askQuestion(); } }}
                            placeholder="Ask a question about your building regulations documents…"
                            disabled={isRunning} rows={2} className="arc-input"
                            style={{ flex: 1, border: `1px solid #e4e4e8`, borderRight: "none", padding: "12px 16px", color: DESIGN_TEXT, fontSize: 13, outline: "none", resize: "none", lineHeight: 1.6, fontFamily: "Inter, Arial, sans-serif", opacity: isRunning ? 0.5 : 1, background: isRunning ? "#f8f8fa" : "#ffffff", letterSpacing: "0.01em" }} />
                          <button className="btn" onClick={() => askQuestion()} disabled={isRunning || !question.trim()}
                            style={{ background: isRunning || !question.trim() ? DESIGN_GROUND : VAULT_FULL, color: isRunning || !question.trim() ? "#9a9088" : "#ffffff", padding: "0 24px", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${isRunning || !question.trim() ? "#e4e4e8" : VAULT_FULL}`, minWidth: 90, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            {isRunning ? <Spinner size={14} /> : "Search"}
                          </button>
                        </div>
                        {costEst !== null && <p style={{ fontSize: 10, color: "#b0a8a0", marginTop: 6, letterSpacing: "0.04em" }}>Est. cost: {costEst < 0.01 ? "< 1p" : `${(costEst * 100).toFixed(2)}p`}</p>}
                        {conversationHistory.length > 0 && (
                          <p style={{ fontSize: 10, color: "#b0a8a0", marginTop: 4, letterSpacing: "0.04em" }}>
                            Context: {conversationHistory.length} Q&A{conversationHistory.length !== 1 ? "s" : ""} stored —{" "}
                            <span onClick={() => setConversationHistory([])} style={{ cursor: "pointer", textDecoration: "underline" }}>clear</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          </div>{/* end inner flex row */}
        </div>}{/* end vault section */}

      </div>

      {/* ── Citation PDF Viewer ── */}
      {citationViewer && (
        <VaultPdfViewer
          base64={citationViewer.base64}
          fileName={citationViewer.fileName}
          page={citationViewer.page}
          heading={citationViewer.heading}
          onClose={() => setCitationViewer(null)}
        />
      )}
    </div>
  );
}