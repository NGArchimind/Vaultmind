import { useState, useRef, useCallback, useEffect } from "react";
import { api, callClaude, fileToBase64, supabase } from "./api/client";
import AnswerRenderer from "./components/common/AnswerRenderer";
import { Spinner, ProgressBar } from "./components/common/Spinner";
import VaultManagementModal from "./components/VaultManagementModal";
import CompareSection from "./components/CompareSection";
import LandingPage from "./components/LandingPage";
import ProjectsSection from "./components/ProjectsSection";
import DatasheetsLibrarySection from "./components/DatasheetsLibrarySection";
import AdminSection from "./components/AdminSection";
import { AD_GREEN, AD_GREEN_LIGHT, AD_GREEN_MID, ARC_NAVY, ARC_TERRACOTTA, ARC_STONE, MAX_PAGES_PER_CHUNK } from "./constants";

const IS_DEMO = false;
const MAX_PAGES_PER_CHUNK_LOCAL = MAX_PAGES_PER_CHUNK;

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

export default function App() {
  const [appSection, setAppSection] = useState("home");
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
  const [tempDoc, setTempDoc] = useState(null);
  const [tempDocDragOver, setTempDocDragOver] = useState(false);
  const [lastQuestion, setLastQuestion] = useState("");
  const [timedOut, setTimedOut] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const fileInputRef = useRef();
  const tempDocInputRef = useRef();

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
        const role = session.user?.user_metadata?.role || "user";
        setUserRole(role);
      }
      setAuthLoading(false);
    });

    // Listen for auth state changes (sign in / sign out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        const role = session.user?.user_metadata?.role || "user";
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
  };

  const loadTempDoc = async (file) => {
    if (!file || file.type !== "application/pdf") return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result.split(",")[1];
      setTempDoc({ name: file.name, base64 });
    };
    reader.readAsDataURL(file);
  };

  const isAdmin = userRole === "admin";

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

  useEffect(() => {
    if (session) loadVaults();
  }, [session]);

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
    const INDEX_PROMPT = `Extract structural headings from this document — chapter titles, numbered sections (e.g. 6.6, 6.6.1), named sub-sections, AND the titles of all numbered tables and figures (e.g. "Table 3 — Fire resistance of cavity barriers", "Figure 24 — Cavity barrier locations"). Include table and figure titles as they are essential navigation landmarks.\r\n\r\nDo not extract body text or bullet points.\r\n\r\nFor pageHint, use only the position of the page within this PDF file — page 1 is the first page of this file, page 2 is the second, etc. Ignore all printed page numbers on the pages.\r\n\r\nOutput ONLY valid JSON: {"headings": [{"level": 1, "title": "heading text", "pageHint": 1}]}`;

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
      const parsed = tryParse(result);
      if (parsed?.headings?.length > 0) {
        const deduped = dedupe(parsed.headings);
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

      for (let chunk = 0; chunk < numChunks; chunk++) {
        const startPage = chunk * CHUNK_SIZE;
        const endPage = Math.min(startPage + CHUNK_SIZE, pageCount);
        setStatusMsg(`Indexing ${pdfName} — pages ${startPage + 1}–${endPage} of ${pageCount}…`);
        const { base64: chunkBase64 } = await extractPdfPages(base64, Array.from({ length: endPage - startPage }, (_, i) => startPage + i));
        try {
          const chunkPrompt = `Extract structural headings from this document — chapter titles, numbered sections (e.g. 6.6, 6.6.1), named sub-sections, AND the titles of all numbered tables and figures (e.g. "Table 3 — Fire resistance of cavity barriers", "Figure 24 — Cavity barrier locations"). Include table and figure titles as they are essential navigation landmarks.\r\n\r\nDo not extract body text or bullet points.\r\n\r\nFor pageHint, use only the page number within this chunk — page 1 is the first page of this chunk, page 2 is the second, up to page ${endPage - startPage}. Ignore all printed page numbers on the pages completely.\r\n\r\nOutput ONLY valid JSON: {"headings": [{"level": 1, "title": "heading text", "pageHint": 1}]}`;
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
              if (parsed2?.headings) allHeadings.push(...parsed2.headings);
            } catch (e2) {
              console.warn(`${pdfName} chunk ${chunk + 1} retry also failed:`, e2.message);
            }
          }
        }
      }

      const deduped = dedupe(allHeadings);
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

  // ── 3-pass Q&A pipeline ───────────────────────────────────────────────────────
  const askQuestion = async () => {
    if ((!vaultIndex && !tempDoc) || !question.trim()) return;
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
      // ── Temp doc only mode (no vault indexed) ─────────────────────────────────
      if (!vaultIndex && tempDoc) {
        setStage("answering");
        setStatusMsg("Reading temporary document and synthesising answer…");
        setProgress({ index: 100, select: 100, read: 100, answer: 0 });
        const docBlocks = [{
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: tempDoc.base64 },
        }];
        const priorContext = conversationHistory.slice(-5);
        const contextBlock = priorContext.length > 0
          ? `CONVERSATION SO FAR:\n\n${priorContext.map((h, i) => `Question ${i+1}: ${h.question}\nAnswer ${i+1}: ${h.answer.slice(0, 1000)}`).join("\n\n---\n\n")}\n\n---\n\n`
          : "";
        const tempPrompt = `You are an expert building regulations consultant. Use ONLY the provided document to answer.

${contextBlock}CURRENT QUESTION: ${q}

Respond with:
## Summary
A direct answer in 2-4 sentences citing the document.

## Detailed Analysis
Supporting detail and any relevant clauses, tables, or cross-references.

## Regulatory Context
Broader context from the document if relevant.

## Contradictions & Conflicts
Any conflicts or caveats within the document. If none: "No contradictions identified."`;
        const { text: finalAnswer, usage: answerUsage } = await callClaude(
          [{ role: "user", content: [...docBlocks, { type: "text", text: tempPrompt }] }],
          `You are an expert building regulations consultant. Answer using ONLY the provided document. Always output in this exact order: (1) ## Summary, (2) ## Detailed Analysis, (3) ## Regulatory Context, (4) ## Contradictions & Conflicts.`,
          65536
        );
        setProgress(p => ({ ...p, answer: 100 }));
        setAnswer(finalAnswer);
        setStage("done");
        setHistory(prev => [...prev, { vaultId: "temp", question: q, answer: finalAnswer, timestamp: new Date() }]);
        setConversationHistory(prev => [...prev, { question: q, answer: finalAnswer }]);
        const inputCost  = ((answerUsage?.input_tokens  || 0) / 1_000_000) * 0.15 * 0.8;
        const outputCost = ((answerUsage?.output_tokens || 0) / 1_000_000) * 0.60 * 0.8;
        setCostEst(inputCost + outputCost);
        return;
      }

      const useAllSubVaults = queryScope === "all" && parentMaster;
      const activeIndex = useAllSubVaults ? await buildCombinedIndex() : vaultIndex;

      // ── PASS 1: Score index ──────────────────────────────────────────────────
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

      const scoringPrompt = `You are an expert technical document analyst. Using ONLY the document index below, identify which specific sections and pages are most likely to contain the answer to the question.\n\nDOCUMENT INDEX (headings, sections and page numbers extracted from vault documents):\n${indexSummary}\n${conversationContext}\n\nQUESTION: ${q}\n${recentHistory.length > 0 ? "NOTE: This may be a follow-up question. Use the conversation history above to understand the full context before scoring." : ""}\n\nAnalyse the index carefully. For every section that could possibly be relevant — even tangentially — assign a probability score. Building regulations frequently contain cross-references, exceptions and caveats in unexpected sections. Be CONSERVATIVE — it is better to include a borderline section than to miss critical information.\n\nNOTE: Select ALL sections that are relevant to the question — do not limit to just one section if multiple sections are relevant.\n\nTABLES AND FIGURES: If the question relates to a requirement that is likely defined or quantified in a table or figure (e.g. fire resistance ratings, dimensions, classifications), you MUST also select any table or figure entries in the index that are likely to contain that data. For example, if the index contains "Table 3 — Fire resistance of cavity barriers" or "Table 5 — Minimum fire resistance", select those entries with high probability. Never rely solely on clause text pages when the actual values are in a table.\n\nRespond ONLY as compact JSON — no other text, no explanations, no reasons:\n{\n  "selectedDocs": [\n    {\n      "docName": "exact filename from index",\n      "sections": [\n        {"heading": "exact heading from index", "pageHint": 42, "probability": 0.95}\n      ]\n    }\n  ]\n}\n\nRules:\n- Include sections with probability > 0.5\n- pageHint MUST be a plain integer. Never use "p.12" or "page 12". Use 1 if unknown.\n- Omit "styleNotes", "reason" and "crossRefs" fields entirely — keep JSON compact`;

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

      // ── PASS 2: Load PDFs and extract pages ──────────────────────────────────
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
          try {
            const pdfData = await api(`/api/vaults/${encodeURIComponent(found.subVault.id)}/pdfs/${encodeURIComponent(found.fileName)}`);
            contentsData.push({ pdf: { name: found.prefixedName, size: 0 }, base64: pdfData.base64 });
          } catch (e) {
            console.warn(`Could not load ${found.fileName} from ${found.subVault.name}:`, e);
          }
        }
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
      let totalPagesExtracted = 0;

      for (const [docName, { contentsDoc, pages }] of Object.entries(docPageMap)) {
        setStatusMsg(`Pass 2/3 · Extracting pages from ${docName}…`);
        const pageList = Array.from(pages).sort((a, b) => a - b);
        if (pageList.length === 0) continue;
        try {
          const result = await api("/api/extract-pages", { method: "POST", body: { base64: contentsDoc.base64, pages: pageList } });
          totalPagesExtracted += result.pagesExtracted;
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

      setStatusMsg(`Pass 2/3 · ${totalPagesExtracted} specific pages extracted across ${docBlocks.length} document${docBlocks.length !== 1 ? "s" : ""}…`);
      setProgress(p => ({ ...p, read: 100 }));

      // ── PASS 3: Answer synthesis ───────────────────────────────────────────────
      setStage("answering");
      setStatusMsg("Pass 3/3 · Deep reading selected pages and synthesising answer…");

      const focusSections = (scoring.selectedDocs || [])
        .flatMap(d => (d.sections || []).map(s => `${d.docName}: ${s.heading} (p.${s.pageHint})`))
        .join("; ");

      const priorContext = conversationHistory.slice(-5);
      const contextBlock = priorContext.length > 0
        ? `CONVERSATION SO FAR — this question is part of a continuing discussion. Build on what has already been established rather than starting fresh. Do not repeat information already covered unless directly relevant to this new question.\n\n${priorContext.map((h, i) => `Question ${i+1}: ${h.question}\nAnswer ${i+1}: ${h.answer.slice(0, 1000)}`).join("\n\n---\n\n")}\n\n---\n\n`
        : "";

      const answerPrompt = `You are an expert building regulations consultant at an architectural practice. Use ONLY the provided document pages to answer.${tempDoc ? `\n\nNOTE: A temporary document has been included for reference: "${tempDoc.name}". This is not part of the permanent vault — treat it as an additional reference document when answering.` : ""}\n\n${contextBlock}CURRENT QUESTION: ${q}\n\nPRIORITY SECTIONS: ${focusSections || "all sections"}\n\n---\n\nTABLES — GLOBAL RULE (applies to every section):\nWhen multiple documents contain tables that are near-identical in structure and content (e.g. minimum fire resistance performance tables across different versions of the same standard), do NOT reproduce each one separately. Instead:\n1. Reproduce the single most complete and relevant version in full\n2. After the citation, add a plain italic note: *Note: [Other Document] [Table X] contains equivalent/near-identical data. [Note any meaningful differences, e.g. if one table lacks a cavity barrier row.]*\n\nFor the one table you reproduce:\n1. Output the table title on its own line in bold: **Table X — Title of table**\n2. Reproduce the COMPLETE table — EVERY row, EVERY column, NO exceptions. Do not extract only the relevant row. Do not summarise. If the table has 30 rows, output all 30 rows. Every row starts and ends with | pipe characters.\n3. After the header row output a separator row: | --- | --- | --- |\n4. For the specific row(s) that directly answer the question, prefix that ENTIRE ROW with >> ONCE at the very start, before the first pipe: >> | cell | cell | cell |\n   CRITICAL: The >> prefix appears ONCE at the start of the row only. Do NOT put >> before each cell.\n5. Do NOT wrap tables in > block quote syntax\n6. Place the citation immediately below the table, then the equivalence note\n7. If the table spans multiple pages, combine ALL parts into one complete table — do not stop at the first page\n\nIf only one table is referenced, reproduce it in full without any equivalence note.\n\nRESPONSE FORMAT — output in this exact order every time:\n\n## Summary\n\nWRITE THIS FIRST. A confident, definitive answer in 2–4 sentences. Must:\n- Open with a direct answer in plain English\n- Cite ALL relevant documents provided — not just one\n- Build on any prior conversation context where relevant\n- Reproduce any table directly relevant to the answer\n- After any table include footnotes/qualifications as plain italic text\n\nFor each key fact, include the exact supporting phrase and citation as a consecutive pair:\n\n> "Exact short phrase from document."\n*Document Name | X.X.X Clause Title (Parent Section Title)*\n\nCITATION FORMAT: *Document | Clause number and title (Parent section title)*\nCRITICAL: Citation MUST start AND end with * asterisk.\n\nCITATION PLACEMENT — strictly follow these rules:\n- Every citation goes on its OWN LINE, never embedded within a sentence\n- Never write: "Quote." *Citation* and more text continues here.\n- Never chain citations with "and": *Citation A* and *Citation B* — WRONG\n- If multiple documents support the same fact, each citation goes on its own separate line:\n  > "Quote."\n  *Document A | Clause*\n  *Document B | Clause*\n- A citation always ends a paragraph, never appears mid-sentence\n\n---\n\n## Detailed Analysis\n\nWRITE THIS SECOND. Only content that adds value beyond the summary.\n\nCheck ALL of the following — if ANY apply, write Case 2:\n- Location/scenario-specific requirements beyond the general rule?\n- Exceptions or conditions where the rule does NOT apply?\n- Construction/specification requirements beyond the fire rating?\n- Cross-references to other clauses, standards, or ADs?\n- Do the multiple documents differ or add to each other?\n- Inspection, testing, or certification requirements?\n\nCASE 1 — Only if ALL checks negative: "The summary above fully addresses this question."\n\nCASE 2 — Concise bullet points. One sentence each. Reproduce any referenced table in full below the bullet. Citation after each bullet or table:\n*Document Name | X.X.X Clause Title (Parent Section Title)*\n\nRULES:\n- No repetition of summary content\n- Citations: opening AND closing * required\n- Cite ALL documents where relevant — never rely on just one\n- Maximum 6 bullets\n\n---\n\n## Regulatory Context\n\nWRITE THIS THIRD. Broader background tightly scoped to the question. 2–4 bullets maximum.\nCitation after each bullet: *Document Name | X.X.X Clause Title (Parent Section Title)*\nIf nothing to add: "No additional context required."\n\n---\n\n## Contradictions & Conflicts\n\nWRITE THIS LAST. Conflicts: state conflict, quote both sides with citations, give practical conclusion.\nNo conflicts: "No contradictions identified."\n\n---\n\nRULES:\n- Fixed order: Summary, Detailed Analysis, Regulatory Context, Contradictions\n- Use ONLY the provided document pages — no external knowledge\n- Every factual statement needs a citation with opening AND closing asterisks\n- Draw from ALL provided documents — never rely on just one`;

      const { text: finalAnswer, usage: answerUsage } = await callClaude(
        [{ role: "user", content: [...docBlocks, { type: "text", text: answerPrompt }] }],
        `You are an expert building regulations consultant. Answer using ONLY the provided document pages. Always output in this exact order: (1) ## Summary, (2) ## Detailed Analysis, (3) ## Regulatory Context, (4) ## Contradictions & Conflicts. Never change this order. Every citation MUST start and end with asterisks: *Document | Clause (Section)*. Draw from ALL provided documents.`,
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

  // ── Global styles ─────────────────────────────────────────────────────────────
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

  // ── Auth loading screen ───────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: ARC_STONE, fontFamily: "Inter, Arial, sans-serif" }}>
        <style>{globalStyles}</style>
        <Spinner size={20} />
      </div>
    );
  }

  // ── Login screen ──────────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div style={{ fontFamily: "Arial, sans-serif", background: "#f3f2f1", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <style>{globalStyles}</style>
        <div style={{ background: ARC_NAVY, padding: "20px 40px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ color: "#ffffff", fontSize: 22, fontWeight: 300, letterSpacing: "0.02em", fontFamily: "Inter, Arial, sans-serif" }}>Archimind</span>
          <span style={{ color: "#7a9aaa", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase" }}>Document Intelligence</span>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: ARC_STONE }}>
          <div style={{ background: "#ffffff", padding: "48px 48px", width: 400, borderTop: `3px solid ${ARC_TERRACOTTA}` }}>
            <p style={{ fontSize: 11, color: "#9a9088", marginBottom: 32, letterSpacing: "0.1em", textTransform: "uppercase" }}>Secure Access</p>
            <label style={{ fontSize: 12, fontWeight: 500, color: ARC_NAVY, display: "block", marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase" }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setLoginError(""); }}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              autoFocus
              className="arc-input"
              style={{ width: "100%", border: loginError ? `1px solid ${ARC_TERRACOTTA}` : `1px solid #ccc`, padding: "12px 14px", fontSize: 14, marginBottom: 14, outline: "none", fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY }}
            />
            <label style={{ fontSize: 12, fontWeight: 500, color: ARC_NAVY, display: "block", marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase" }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setLoginError(""); }}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              className="arc-input"
              style={{ width: "100%", border: loginError ? `1px solid ${ARC_TERRACOTTA}` : `1px solid #ccc`, padding: "12px 14px", fontSize: 14, marginBottom: 6, outline: "none", fontFamily: "Inter, Arial, sans-serif", color: ARC_NAVY }}
            />
            {loginError && <p style={{ color: ARC_TERRACOTTA, fontSize: 12, marginBottom: 16, letterSpacing: "0.02em" }}>{loginError}</p>}
            <button className="btn" onClick={handleLogin} disabled={loggingIn}
              style={{ marginTop: 20, width: "100%", background: ARC_NAVY, color: "#ffffff", padding: "12px 0", fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {loggingIn ? <><Spinner size={13} /> Signing in…</> : "Sign In"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main UI ───────────────────────────────────────────────────────────────────
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
        <button className="btn" onClick={() => setAppSection("home")}
          style={{ background: "none", color: "#ffffff", fontSize: 20, fontWeight: 300, letterSpacing: "0.02em", fontFamily: "Inter, Arial, sans-serif", padding: 0 }}>
          Archimind
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {["vault", "compare", "library", "projects"].map(section => (
            <button key={section} className="btn" onClick={() => setAppSection(section)}
              style={{ background: appSection === section ? "rgba(255,255,255,0.12)" : "none", color: appSection === section ? "#ffffff" : "#7a9aaa", padding: "6px 14px", fontSize: 12, fontWeight: appSection === section ? 600 : 400, letterSpacing: "0.06em", textTransform: "uppercase", border: "none" }}>
              {section.charAt(0).toUpperCase() + section.slice(1)}
            </button>
          ))}
          {isAdmin && (
            <button className="btn" onClick={() => setAppSection("admin")}
              style={{ background: appSection === "admin" ? "rgba(255,255,255,0.12)" : "none", color: appSection === "admin" ? "#ffffff" : ARC_TERRACOTTA, padding: "6px 14px", fontSize: 12, fontWeight: appSection === "admin" ? 600 : 400, letterSpacing: "0.06em", textTransform: "uppercase", border: "none", opacity: 0.85 }}>
              Admin
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ color: "#7a9aaa", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>Document Intelligence</span>
          <span style={{ fontSize: 10, color: isAdmin ? ARC_TERRACOTTA : "#7a9aaa", letterSpacing: "0.1em", textTransform: "uppercase", border: `1px solid ${isAdmin ? ARC_TERRACOTTA : "#3a5a6a"}`, padding: "2px 8px" }}>
            {isAdmin ? "Admin" : "User"}
          </span>
          <button className="btn" onClick={handleSignOut}
            style={{ background: "none", color: "#7a9aaa", fontSize: 11, border: "1px solid #3a5a6a", padding: "3px 10px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden", maxHeight: "calc(100vh - 56px)" }}>

        {appSection === "home" && <LandingPage onSelect={setAppSection} isAdmin={isAdmin} />}
        {appSection === "compare" && <CompareSection vaults={vaults} isAdmin={isAdmin} />}
        {appSection === "library" && <DatasheetsLibrarySection vaults={vaults} isAdmin={isAdmin} />}
        {appSection === "projects" && <ProjectsSection isAdmin={isAdmin} />}
        {appSection === "admin" && isAdmin && <AdminSection />}

        {/* ── VAULT ─────────────────────────────────────────────────────── */}
        {appSection === "vault" && <>

          {/* Sidebar */}
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
                      <div className="master-item" onClick={() => toggleMaster(v.id)}
                        style={{ padding: "10px 24px", display: "flex", alignItems: "center", gap: 8, borderLeft: "3px solid transparent" }}>
                        <span style={{ fontSize: 10, color: "#9a9088", transition: "transform 0.15s", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▶</span>
                        <span style={{ fontSize: 13, color: ARC_NAVY, fontWeight: 500, letterSpacing: "0.01em", flex: 1 }}>{v.name}</span>
                        <span style={{ fontSize: 10, color: "#b0a8a0" }}>{(v.subVaults || []).length}</span>
                      </div>
                      {isExpanded && (v.subVaults || []).map(sv => (
                        <div key={sv.id} className="vault-item" onClick={() => selectVault(sv.id)}
                          style={{ padding: "9px 24px 9px 44px", background: selectedVault === sv.id ? "#ffffff" : "transparent", borderLeft: selectedVault === sv.id ? `3px solid ${ARC_TERRACOTTA}` : "3px solid transparent", display: "flex", alignItems: "center", gap: 6 }}>
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
                    <div key={v.id} className="vault-item" onClick={() => selectVault(v.id)}
                      style={{ padding: "12px 24px", background: selectedVault === v.id ? "#ffffff" : "transparent", borderLeft: selectedVault === v.id ? `3px solid ${ARC_TERRACOTTA}` : "3px solid transparent" }}>
                      <div style={{ fontSize: 13, color: ARC_NAVY, fontWeight: selectedVault === v.id ? 600 : 400, letterSpacing: "0.01em" }}>{v.name}</div>
                    </div>
                  );
                }
              })}
            </div>

            {/* Temp doc upload */}
            <div style={{ borderTop: "1px solid #ddd8d0", padding: "12px 24px" }}>
              {tempDoc ? (
                <div style={{ padding: "10px 0" }}>
                  <div style={{ fontSize: 9, color: "#9a9088", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Temporary Document</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#fdf5f3", border: `1px solid ${ARC_TERRACOTTA}`, padding: "8px 10px" }}>
                    <span style={{ fontSize: 11, color: ARC_TERRACOTTA, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📄 {tempDoc.name}</span>
                    <button className="btn" onClick={() => setTempDoc(null)} title="Remove"
                      style={{ background: "none", color: ARC_TERRACOTTA, fontSize: 14, padding: "0 2px", fontWeight: 700, lineHeight: 1, flexShrink: 0 }}>×</button>
                  </div>
                  <p style={{ fontSize: 10, color: "#b0a8a0", marginTop: 6, lineHeight: 1.5, letterSpacing: "0.02em" }}>Temporary — will not be saved. Included in all questions.</p>
                </div>
              ) : (
                <div
                  onDragOver={e => { e.preventDefault(); setTempDocDragOver(true); }}
                  onDragLeave={() => setTempDocDragOver(false)}
                  onDrop={e => { e.preventDefault(); setTempDocDragOver(false); const f = e.dataTransfer.files[0]; if (f) loadTempDoc(f); }}
                  onClick={() => tempDocInputRef.current.click()}
                  style={{ padding: "10px 0", cursor: "pointer" }}>
                  <div style={{ fontSize: 9, color: "#9a9088", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Temporary Document</div>
                  <div style={{ border: `1px dashed ${tempDocDragOver ? AD_GREEN : "#ccc"}`, padding: "10px 12px", background: tempDocDragOver ? "#f0f5f6" : "transparent", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, opacity: 0.4 }}>📎</span>
                    <span style={{ fontSize: 11, color: ARC_NAVY, letterSpacing: "0.01em" }}>Upload a PDF</span>
                  </div>
                  <p style={{ fontSize: 10, color: "#b0a8a0", marginTop: 6, lineHeight: 1.5, letterSpacing: "0.02em" }}>Upload a temporary PDF here to include it in your questions. It will not be saved to the vault.</p>
                  <input ref={tempDocInputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) loadTempDoc(e.target.files[0]); }} />
                </div>
              )}
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

          {/* Main panel */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#faf8f5" }}>
            {!vault ? (
              tempDoc ? (
                // Temp doc loaded with no vault — show question bar directly
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  <div style={{ flex: 1, overflowY: "auto", padding: "32px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    {isRunning ? (
                      <div style={{ width: "100%", maxWidth: 680 }}>
                        <p style={{ fontSize: 12, color: "#9a9088", marginBottom: 16 }}>{statusMsg}</p>
                      </div>
                    ) : statusMsg && statusMsg.startsWith("Error") ? (
                      <div style={{ width: "100%", maxWidth: 680 }}>
                        <p style={{ fontSize: 12, color: ARC_TERRACOTTA, marginBottom: 16 }}>{statusMsg}</p>
                      </div>
                    ) : answer ? (
                      <div style={{ width: "100%", maxWidth: 680 }}>
                        <AnswerRenderer answer={answer} />
                      </div>
                    ) : (
                      <>
                        <p style={{ fontSize: 20, color: ARC_NAVY, fontWeight: 300, letterSpacing: "0.02em" }}>📄 {tempDoc.name}</p>
                        <p style={{ fontSize: 12, color: "#9a9088", letterSpacing: "0.04em" }}>Ask a question about this document</p>
                      </>
                    )}
                  </div>
                  <div style={{ padding: "16px 32px 20px", borderTop: "1px solid #e8e0d5", background: "#ffffff", flexShrink: 0 }}>
                    <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
                      <textarea value={question} onChange={e => setQuestion(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askQuestion(); } }}
                        placeholder="Ask a question about this document…"
                        disabled={isRunning} rows={2} className="arc-input"
                        style={{ flex: 1, border: "1px solid #ddd8d0", borderRight: "none", padding: "12px 16px", color: ARC_NAVY, fontSize: 13, outline: "none", resize: "none", lineHeight: 1.6, fontFamily: "Inter, Arial, sans-serif", opacity: isRunning ? 0.5 : 1, background: isRunning ? "#faf8f5" : "#ffffff", letterSpacing: "0.01em" }} />
                      <button className="btn" onClick={askQuestion} disabled={isRunning || !question.trim()}
                        style={{ background: isRunning || !question.trim() ? "#f0ede8" : ARC_NAVY, color: isRunning || !question.trim() ? "#9a9088" : "#ffffff", padding: "0 24px", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${isRunning || !question.trim() ? "#ddd8d0" : ARC_NAVY}`, minWidth: 90, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        {isRunning ? <Spinner size={14} /> : "Search"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <p style={{ fontSize: 20, color: ARC_NAVY, fontWeight: 300, letterSpacing: "0.02em" }}>Select a vault</p>
                  <p style={{ fontSize: 12, color: "#9a9088", letterSpacing: "0.04em" }}>Upload documents and query building regulations</p>
                </div>
              )
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

                      {!answer && !isRunning && vaultIndex && vaultHistory.length === 0 && (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 10 }}>
                          <div style={{ width: 32, height: 2, background: ARC_TERRACOTTA }} />
                          <p style={{ fontSize: 16, color: ARC_NAVY, fontWeight: 300, letterSpacing: "0.02em" }}>Ask a question</p>
                          <p style={{ fontSize: 11, color: "#9a9088", letterSpacing: "0.03em" }}>AI selects the most relevant pages before answering</p>
                        </div>
                      )}

                      {!vaultIndex && !isRunning && pdfs.length > 0 && (
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

                    {(vaultIndex || (queryScope === "all" && parentMaster) || tempDoc) && (
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

        </> /* end vault section */}

      </div>
    </div>
  );
}