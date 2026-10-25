import { useState, useEffect, useRef } from "react";
import { api } from "../../../api/client";
import { DESIGN_TEXT, DESIGN_MUTED, DESIGN_GOLD, PROJECTS_FULL } from "../../../constants";
import { Spinner } from "../../common/Spinner";
import { formatMapDate, splitAroundQuote } from "./mapHelpers";

// Pop-up showing where a piece of map information came from. For an email it
// loads the stored email and highlights the quoted passage.
// source: { source_type, source_id, source_label, quote, entry_date, stated_by }
export default function MapSourceModal({ projectId, source, onClose }) {
  const isEmail = source.source_type === "email" && !!source.source_id;
  const [email, setEmail] = useState(null);
  const [loading, setLoading] = useState(isEmail);
  const [missing, setMissing] = useState(false);
  const markRef = useRef(null);

  useEffect(() => {
    if (!isEmail) return;
    let cancelled = false;
    setLoading(true); setMissing(false); setEmail(null);
    api(`/api/projects/${projectId}/emails/${source.source_id}`)
      .then(({ email: full }) => { if (!cancelled) setEmail(full); })
      .catch(() => { if (!cancelled) setMissing(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, source.source_id, isEmail]);

  useEffect(() => {
    if (email && markRef.current) markRef.current.scrollIntoView({ block: "center" });
  }, [email]);

  const metaStyle = { fontSize: 11, color: DESIGN_MUTED, lineHeight: 1.8 };
  const metaLabel = { fontWeight: 600, color: DESIGN_TEXT, display: "inline-block", width: 86 };
  const quoteBox = (
    <div style={{ borderLeft: `3px solid ${DESIGN_GOLD}`, background: "#faf6ea", padding: "8px 12px", fontSize: 12, color: DESIGN_TEXT, lineHeight: 1.6, marginBottom: 12 }}>
      “{source.quote}”
    </div>
  );
  const parts = email ? splitAroundQuote(email.body_text, source.quote) : null;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(38,40,48,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", width: "min(760px, 100%)", maxHeight: "86vh", display: "flex", flexDirection: "column", fontFamily: "Inter, Arial, sans-serif", boxShadow: "0 12px 40px rgba(0,0,0,0.25)" }}>

        <div style={{ padding: "14px 20px", borderBottom: "1px solid #e4e4e8", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: PROJECTS_FULL, marginBottom: 4 }}>
              Source — {isEmail ? "email" : source.source_type}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: DESIGN_TEXT, overflowWrap: "anywhere" }}>
              {email?.subject || source.source_label || "(no subject)"}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid #e4e4e8", padding: "5px 12px", fontSize: 11, color: "#666", cursor: "pointer", flexShrink: 0 }}>Close</button>
        </div>

        <div style={{ padding: "14px 20px", overflowY: "auto" }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: DESIGN_MUTED, fontSize: 12 }}><Spinner size={12} /> Loading email…</div>
          ) : isEmail && email ? (
            <>
              <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #eee" }}>
                <div style={metaStyle}><span style={metaLabel}>From</span>{email.from_name ? `${email.from_name} <${email.from_address}>` : email.from_address}</div>
                {(email.to_addresses || []).length > 0 && <div style={metaStyle}><span style={metaLabel}>To</span>{email.to_addresses.join(", ")}</div>}
                {(email.cc_addresses || []).length > 0 && <div style={metaStyle}><span style={metaLabel}>CC</span>{email.cc_addresses.join(", ")}</div>}
                <div style={metaStyle}><span style={metaLabel}>Date</span>{email.sent_at ? new Date(email.sent_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</div>
                <div style={metaStyle}>
                  <span style={metaLabel}>Attachments</span>
                  {(email.attachment_names || []).length > 0
                    ? <>{email.attachment_names.join(", ")} <span style={{ fontStyle: "italic" }}>— open the email in Mail Manager to read these</span></>
                    : "None"}
                </div>
              </div>
              {source.quote && !parts && quoteBox}
              {email.body_text ? (
                <pre style={{ fontSize: 12, color: "#444", whiteSpace: "pre-wrap", fontFamily: "Inter, Arial, sans-serif", lineHeight: 1.7, margin: 0 }}>
                  {parts
                    ? <>{parts.before}<mark ref={markRef} style={{ background: "#f6e7b0", padding: "1px 0" }}>{parts.match}</mark>{parts.after}</>
                    : email.body_text}
                </pre>
              ) : (
                <div style={{ color: DESIGN_MUTED, fontSize: 12 }}>No body content.</div>
              )}
            </>
          ) : (
            <>
              {isEmail && missing && (
                <div style={{ fontSize: 12, color: DESIGN_MUTED, marginBottom: 12 }}>The original email is no longer stored in this project, so only the recorded passage is shown.</div>
              )}
              <div style={metaStyle}><span style={metaLabel}>Recorded</span>{formatMapDate(source.entry_date)}</div>
              {source.stated_by && <div style={{ ...metaStyle, marginBottom: 12 }}><span style={metaLabel}>Stated by</span>{source.stated_by}</div>}
              {source.quote
                ? quoteBox
                : <div style={{ fontSize: 12, color: DESIGN_MUTED, marginTop: 12 }}>No passage was recorded for this entry.</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
