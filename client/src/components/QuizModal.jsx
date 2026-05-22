import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import { Spinner } from "./common/Spinner";
import {
  VAULT_FULL, TIMESHEETS_FULL, DESIGN_SHELL, DESIGN_GROUND, DESIGN_MUTED,
  COMPARE_FULL
} from "../constants";

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function QuizModal({ onClose }) {
  // Screens: 'select' | 'pick-doc' | 'quiz'
  const [screen, setScreen] = useState("select");
  const [quizType, setQuizType] = useState(null); // 'approved_docs' | 'cscs'
  const [adVaultName, setAdVaultName] = useState(null);
  const [adDocs, setAdDocs] = useState([]); // [{ document_name, count }]
  const [docsLoading, setDocsLoading] = useState(false);

  // Quiz state
  const [questionQueue, setQuestionQueue] = useState([]); // shuffled pool
  const [queueIndex, setQueueIndex] = useState(0);
  const [answered, setAnswered] = useState(null); // { selectedLabel, isCorrect } | null
  const [quizLoading, setQuizLoading] = useState(false);
  const [error, setError] = useState("");

  // Load AD vault name on mount — fails silently for non-admins
  useEffect(() => {
    let alive = true;
    api("/api/admin/quiz/settings")
      .then(d => alive && setAdVaultName(d.quiz_ad_vault_name))
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Load AD document list when entering pick-doc screen
  useEffect(() => {
    if (screen !== "pick-doc" || !adVaultName) return;
    let alive = true;
    setDocsLoading(true);
    api(`/api/quiz/questions?type=approved_docs&vault_name=${encodeURIComponent(adVaultName)}`)
      .then(({ questions }) => {
        if (!alive) return;
        const counts = {};
        questions.forEach(q => {
          counts[q.document_name] = (counts[q.document_name] || 0) + 1;
        });
        setAdDocs(Object.entries(counts).map(([document_name, count]) => ({ document_name, count })));
      })
      .catch(e => alive && setError(e.message))
      .finally(() => alive && setDocsLoading(false));
    return () => { alive = false; };
  }, [screen, adVaultName]);

  const startQuiz = useCallback(async (type, document_name) => {
    setQuizLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ type });
      if (type === "approved_docs" && adVaultName) params.set("vault_name", adVaultName);
      if (document_name) params.set("document_name", document_name);
      const { questions } = await api(`/api/quiz/questions?${params}`);
      // Filter out malformed questions (no options, or no correct answer marked)
      const valid = (questions || []).filter(
        q => Array.isArray(q.options) && q.options.length > 0 && q.options.some(o => o.is_correct)
      );
      if (valid.length === 0) {
        setError("No questions available for this selection.");
        setQuizLoading(false);
        return;
      }
      setQuestionQueue(shuffle(valid));
      setQueueIndex(0);
      setAnswered(null);
      setScreen("quiz");
    } catch (e) {
      setError(e.message);
    } finally {
      setQuizLoading(false);
    }
  }, [adVaultName]);

  const currentQuestion = questionQueue[queueIndex] || null;

  const handleAnswer = (label) => {
    if (answered) return;
    const isCorrect = currentQuestion.options.find(o => o.label === label)?.is_correct || false;
    setAnswered({ selectedLabel: label, isCorrect });
    api("/api/quiz/answer", { method: "POST", body: { quiz_type: quizType, is_correct: isCorrect } })
      .catch(() => {});
  };

  const handleNext = () => {
    setAnswered(null);
    const nextIndex = queueIndex + 1;
    if (nextIndex >= questionQueue.length) {
      setQuestionQueue(shuffle(questionQueue));
      setQueueIndex(0);
    } else {
      setQueueIndex(nextIndex);
    }
  };

  // ── Shared styles ────────────────────────────────────────────────────────────
  const overlay = {
    position: "fixed", inset: 0, background: "rgba(38,40,48,0.7)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000, padding: 24,
  };
  const modal = {
    background: "#fff", borderRadius: 6, width: "100%", maxWidth: 600,
    maxHeight: "90vh", overflow: "auto", display: "flex", flexDirection: "column",
    boxShadow: "0 8px 40px rgba(0,0,0,0.25)",
  };
  const headerStyle = (bg) => ({
    background: bg, color: "#fff", padding: "14px 20px",
    display: "flex", justifyContent: "space-between", alignItems: "center",
    flexShrink: 0,
  });
  const headerTitle = { fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" };
  const closeBtn = {
    background: "none", border: "none", color: "rgba(255,255,255,0.8)",
    fontSize: 20, cursor: "pointer", lineHeight: 1, padding: "0 4px",
  };
  const body = { padding: 28, flex: 1 };

  // ── Screen: Select subject ───────────────────────────────────────────────────
  if (screen === "select") {
    return (
      <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={modal}>
          <div style={headerStyle(DESIGN_SHELL)}>
            <span style={headerTitle}>Test Yourself</span>
            <button style={closeBtn} onClick={onClose}>×</button>
          </div>
          <div style={{ ...body, textAlign: "center" }}>
            {error && <p style={{ color: COMPARE_FULL, fontSize: 12, marginBottom: 16 }}>{error}</p>}
            <p style={{ fontSize: 12, color: DESIGN_MUTED, marginBottom: 28, letterSpacing: "0.02em" }}>
              Choose a subject to begin
            </p>
            <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap" }}>

              {/* Approved Documents tile */}
              <div
                onClick={() => {
                  setQuizType("approved_docs");
                  if (!adVaultName) { setError("No Approved Documents vault configured. Ask an admin."); return; }
                  setError("");
                  setScreen("pick-doc");
                }}
                style={{
                  border: `2px solid ${VAULT_FULL}`, borderRadius: 6, padding: "28px 24px",
                  width: 200, textAlign: "center", cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(46,144,136,0.1)", transition: "transform 0.15s",
                }}
                onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
                onMouseLeave={e => e.currentTarget.style.transform = "none"}
              >
                <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: VAULT_FULL, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
                  Approved Documents
                </div>
                <div style={{ fontSize: 11, color: DESIGN_MUTED, lineHeight: 1.5 }}>
                  Building regulations questions drawn from your vault
                </div>
              </div>

              {/* CSCS tile */}
              <div
                onClick={() => {
                  if (quizLoading) return;
                  setQuizType("cscs");
                  setError("");
                  startQuiz("cscs", null);
                }}
                style={{
                  border: `2px solid ${TIMESHEETS_FULL}`, borderRadius: 6, padding: "28px 24px",
                  width: 200, textAlign: "center", cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(76,98,120,0.1)", transition: "transform 0.15s",
                }}
                onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
                onMouseLeave={e => e.currentTarget.style.transform = "none"}
              >
                {quizLoading && quizType === "cscs" ? (
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}><Spinner size={24} /></div>
                ) : (
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🪪</div>
                )}
                <div style={{ fontSize: 12, fontWeight: 700, color: TIMESHEETS_FULL, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
                  CITB CSCS
                </div>
                <div style={{ fontSize: 11, color: DESIGN_MUTED, lineHeight: 1.5 }}>
                  Health, safety &amp; environment test questions
                </div>
              </div>

            </div>
            <p style={{ marginTop: 28, fontSize: 11, color: "#c0bab8", letterSpacing: "0.04em" }}>
              Questions continue until you close this window
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Screen: Pick document (AD only) ─────────────────────────────────────────
  if (screen === "pick-doc") {
    return (
      <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={modal}>
          <div style={headerStyle(VAULT_FULL)}>
            <span style={headerTitle}>Approved Documents — Choose a document</span>
            <button style={closeBtn} onClick={onClose}>×</button>
          </div>
          <div style={body}>
            <button
              onClick={() => { setScreen("select"); setError(""); }}
              style={{ background: "none", border: "none", color: DESIGN_MUTED, fontSize: 11, cursor: "pointer", marginBottom: 20, padding: 0 }}
            >
              ← Back
            </button>
            {error && <p style={{ color: COMPARE_FULL, fontSize: 12, marginBottom: 16 }}>{error}</p>}
            {docsLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: DESIGN_MUTED, fontSize: 12 }}>
                <Spinner size={14} /> Loading documents…
              </div>
            ) : adDocs.length === 0 ? (
              <p style={{ fontSize: 12, color: DESIGN_MUTED }}>No questions generated yet. Ask an admin to generate questions from the Admin panel.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {adDocs.map(({ document_name, count }) => (
                  <div
                    key={document_name}
                    onClick={() => count > 0 && !quizLoading && startQuiz("approved_docs", document_name)}
                    style={{
                      border: "1px solid #e4e4e8", borderRadius: 4, padding: "12px 16px",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      cursor: count > 0 ? "pointer" : "default",
                      opacity: count > 0 ? 1 : 0.5,
                      background: "#fff",
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600, color: DESIGN_SHELL }}>{document_name}</span>
                    <span style={{ fontSize: 11, color: count > 0 ? VAULT_FULL : DESIGN_MUTED }}>
                      {count > 0 ? `${count} questions →` : "No questions yet"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Screen: Quiz ─────────────────────────────────────────────────────────────
  if (screen === "quiz") {
    if (!currentQuestion) return null;
    const accentColor = quizType === "cscs" ? TIMESHEETS_FULL : VAULT_FULL;
    const correctLabel = currentQuestion.options.find(o => o.is_correct)?.label;

    return (
      <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={modal}>
          <div style={headerStyle(accentColor)}>
            <span style={headerTitle}>
              {quizType === "cscs" ? "CITB CSCS" : currentQuestion.document_name}
            </span>
            <button style={closeBtn} onClick={onClose}>×</button>
          </div>
          <div style={body}>
            <p style={{ fontSize: 13, fontWeight: 600, color: DESIGN_SHELL, lineHeight: 1.65, marginBottom: 24 }}>
              {currentQuestion.question_text}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {currentQuestion.options.map(opt => {
                let borderColor = "#e4e4e8";
                let bg = "#fff";
                let color = DESIGN_SHELL;
                let labelBg = DESIGN_GROUND;
                let labelColor = "#505a5f";
                let suffix = "";

                if (answered) {
                  if (opt.label === answered.selectedLabel && !answered.isCorrect) {
                    borderColor = COMPARE_FULL; bg = "#fdf2f0"; color = COMPARE_FULL;
                    labelBg = COMPARE_FULL; labelColor = "#fff"; suffix = " ✗";
                  } else if (opt.label === correctLabel) {
                    borderColor = accentColor; bg = "#f0f8f7";
                    color = accentColor; labelBg = accentColor; labelColor = "#fff"; suffix = " ✓";
                  } else {
                    color = DESIGN_MUTED; labelColor = "#b0b0b8";
                  }
                }

                return (
                  <div
                    key={opt.label}
                    onClick={() => !answered && handleAnswer(opt.label)}
                    style={{
                      border: `${answered ? 2 : 1}px solid ${borderColor}`,
                      borderRadius: 4, padding: "11px 14px",
                      display: "flex", gap: 12, alignItems: "center",
                      cursor: answered ? "default" : "pointer",
                      background: bg, transition: "border-color 0.15s, background 0.15s",
                    }}
                  >
                    <span style={{
                      background: labelBg, color: labelColor,
                      borderRadius: 3, padding: "2px 8px",
                      fontWeight: 700, fontSize: 11, flexShrink: 0,
                    }}>
                      {opt.label}
                    </span>
                    <span style={{ fontSize: 12, color, fontWeight: answered && (opt.label === answered.selectedLabel || opt.label === correctLabel) ? 600 : 400 }}>
                      {opt.text}{suffix}
                    </span>
                  </div>
                );
              })}
            </div>

            {answered && (
              <>
                {currentQuestion.explanation && (
                  <div style={{
                    marginTop: 16, background: "#f0f8f7",
                    borderLeft: `3px solid ${accentColor}`,
                    padding: "10px 14px", borderRadius: "0 4px 4px 0",
                    fontSize: 11, color: "#505a5f", lineHeight: 1.6,
                  }}>
                    <strong style={{ color: accentColor }}>
                      {answered.isCorrect ? "Correct" : `Correct answer: ${correctLabel}`}
                    </strong>
                    {" — "}{currentQuestion.explanation}
                    {currentQuestion.source_clause && (
                      <span style={{ color: DESIGN_MUTED }}> ({currentQuestion.source_clause})</span>
                    )}
                  </div>
                )}
                <div style={{ marginTop: 16, textAlign: "center" }}>
                  <button
                    onClick={handleNext}
                    style={{
                      background: accentColor, color: "#fff",
                      border: "none", padding: "9px 28px", borderRadius: 3,
                      fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
                      textTransform: "uppercase", cursor: "pointer",
                    }}
                  >
                    Next Question →
                  </button>
                </div>
              </>
            )}

            {!answered && (
              <p style={{ marginTop: 20, textAlign: "center", fontSize: 11, color: "#c0bab8", letterSpacing: "0.03em" }}>
                Select an answer above
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
