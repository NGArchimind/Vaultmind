import { useState, useEffect } from "react";
import AnswerRenderer from "./common/AnswerRenderer";
import { VAULT_FULL } from "../constants";

const API_BASE = process.env.REACT_APP_API_URL || "https://archimind.up.railway.app";

export default function SharePage({ id }) {
  const [state, setState] = useState("loading"); // "loading" | "loaded" | "error"
  const [answer, setAnswer] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/shared-answers/${id}`)
      .then(r => {
        if (!r.ok) return setState("error");
        return r.json().then(d => { setAnswer(d.answer); setState("loaded"); });
      })
      .catch(() => setState("error"));
  }, [id]);

  return (
    <div style={{ minHeight: "100vh", background: "#f1f2f4", fontFamily: "Inter, Arial, sans-serif" }}>
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px 80px" }}>

        {state === "loading" && (
          <div style={{ textAlign: "center", marginTop: 80, color: "#9a9aa0", fontSize: 13 }}>
            Loading…
          </div>
        )}

        {state === "error" && (
          <div style={{ textAlign: "center", marginTop: 80 }}>
            <p style={{ fontSize: 18, fontWeight: 300, color: "#262830", marginBottom: 8 }}>
              This link has expired or is not available.
            </p>
            <p style={{ fontSize: 13, color: "#9a9aa0" }}>
              Shared answers are available for 7 days.
            </p>
          </div>
        )}

        {state === "loaded" && answer && (
          <div>
            <div style={{
              background: "#ffffff",
              border: "1px solid #e4e4e8",
              borderTop: `4px solid ${VAULT_FULL}`,
              padding: "24px 28px",
              marginBottom: 24
            }}>
              <AnswerRenderer text={answer} onCitationClick={null} accentColor={VAULT_FULL} />
            </div>
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 32 }}>
          <p style={{ fontSize: 10, color: "#c0c0c8", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Powered by Archimind
          </p>
        </div>

      </div>
    </div>
  );
}
