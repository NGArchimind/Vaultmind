import { DESIGN_TEXT, COMPARE_FULL, PROJECTS_FULL } from "../../constants";
import { DRAWING_TYPE_OPTIONS } from "./projectHelpers";
import { Spinner } from "../common/Spinner";
import EditableField from "./EditableField";
import { FileTypeBadge, StatusBadge } from "./badges";

// ── Drawing row ───────────────────────────────────────────────────────────────
export default function DrawingRow({ d, projectId, isAdmin, onUpdate, onDelete, onView, downloadingId, onDownload, onReindex, highlight = false, selectable = false, selected = false, onSelect, typeOptions, isIndexing = false }) {
  const COLS = selectable
    ? "32px minmax(180px,220px) 1fr 60px minmax(70px,120px) 80px 120px 90px 80px 36px 36px 36px 36px"
    : "minmax(180px,220px) 1fr 60px minmax(70px,120px) 80px 120px 90px 80px 36px 36px 36px 36px";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: COLS,
      gap: "0 10px", padding: "9px 16px", alignItems: "center",
      background: selected ? "#eef6ff" : highlight ? "#f0f8f0" : "inherit",
      borderBottom: "1px solid #f0ede8", minWidth: 900,
    }}>
      {selectable && (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <input type="checkbox" checked={selected} onChange={() => onSelect(d.id)}
            style={{ cursor: "pointer", width: 14, height: 14, accentColor: DESIGN_TEXT }} />
        </div>
      )}
      <div style={{ fontSize: 11, fontWeight: 600, color: DESIGN_TEXT, display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
        {isAdmin && onUpdate
          ? <EditableField value={d.drawing_number} onSave={v => onUpdate(d.id, "drawing_number", v)} placeholder="—" style={{ fontSize: 11 }} />
          : <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.drawing_number || "—"}</span>}
        <FileTypeBadge fileName={d.file_name} />
      </div>
      <div style={{ fontSize: 13, color: DESIGN_TEXT, minWidth: 0, overflow: "hidden" }}>
        {isAdmin && onUpdate
          ? <EditableField value={d.title} onSave={v => onUpdate(d.id, "title", v)} placeholder="Untitled" />
          : <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: DESIGN_TEXT, textAlign: "center" }}>
        {isAdmin && onUpdate
          ? <EditableField value={d.revision} onSave={v => onUpdate(d.id, "revision", v)} placeholder="—" style={{ fontSize: 12, textAlign: "center" }} />
          : <span>{d.revision || "—"}</span>}
      </div>
      <div><StatusBadge status={d.status} /></div>
      <div style={{ fontSize: 11, color: "#9a9088", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.scale || "—"}</div>
      <div style={{ minWidth: 0 }}>
        {isAdmin && onUpdate ? (
          <select value={d.drawing_type || ""} onChange={e => onUpdate(d.id, "drawing_type", e.target.value)}
            style={{ width: "100%", border: "1px solid #e4e4e8", padding: "3px 5px", fontSize: 11, fontFamily: "Inter, Arial, sans-serif", color: d.drawing_type ? DESIGN_TEXT : "#b0a8a0", outline: "none", background: "#fff" }}>
            <option value="">— type —</option>
            {(typeOptions || DRAWING_TYPE_OPTIONS).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : (
          <span style={{ fontSize: 11, color: d.drawing_type ? DESIGN_TEXT : "#b0a8a0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
            {d.drawing_type || "—"}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: "#9a9088", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {isAdmin && onUpdate
          ? <EditableField value={d.volume} onSave={v => onUpdate(d.id, "volume", v)} placeholder="—" style={{ fontSize: 11 }} />
          : <span>{d.volume || "—"}</span>}
      </div>
      <div style={{ fontSize: 11, color: "#9a9088", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {isAdmin && onUpdate
          ? <EditableField value={d.level} onSave={v => onUpdate(d.id, "level", v)} placeholder="—" style={{ fontSize: 11 }} />
          : <span>{d.level || "—"}</span>}
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <button className="btn" onClick={() => onDownload(d)} disabled={downloadingId === d.id} title="Download"
          style={{ background: "none", border: "1px solid #e4e4e8", color: "#9a9088", padding: "4px 8px", fontSize: 13, lineHeight: 1 }}
          onMouseEnter={e => e.currentTarget.style.color = DESIGN_TEXT} onMouseLeave={e => e.currentTarget.style.color = "#9a9088"}>
          {downloadingId === d.id ? <Spinner size={11} /> : "↓"}
        </button>
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        {!(d.file_name || "").endsWith(".dwg") && (
          <button className="btn" onClick={() => onView(d)} title="Full screen view"
            style={{ background: "none", border: "1px solid #e4e4e8", color: "#9a9088", padding: "4px 8px", fontSize: 12, lineHeight: 1 }}
            onMouseEnter={e => e.currentTarget.style.color = DESIGN_TEXT} onMouseLeave={e => e.currentTarget.style.color = "#9a9088"}>👁</button>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        {isAdmin && onDelete && (
          <button className="btn" onClick={() => onDelete(d.id)} title="Delete"
            style={{ background: "none", border: "none", color: "#c8c0b8", fontSize: 16, padding: "0 4px", lineHeight: 1 }}
            onMouseEnter={e => e.currentTarget.style.color = COMPARE_FULL} onMouseLeave={e => e.currentTarget.style.color = "#c8c0b8"}>×</button>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
        {isIndexing
          ? <span title="Indexing…" style={{ display: "flex", alignItems: "center" }}><Spinner size={9} /></span>
          : <button className="btn" onClick={() => onReindex && onReindex(d.id)}
              title={d.is_indexed ? "Indexed — click to re-index" : "Not indexed — click to index now"}
              style={{ background: "none", border: "none", color: d.is_indexed ? "#2e7d4f" : "#c8c0b8", fontSize: d.is_indexed ? 12 : 10, padding: "0 4px", lineHeight: 1, cursor: "pointer", fontWeight: d.is_indexed ? 700 : 400 }}
              onMouseEnter={e => e.currentTarget.style.color = PROJECTS_FULL} onMouseLeave={e => e.currentTarget.style.color = d.is_indexed ? "#2e7d4f" : "#c8c0b8"}>
              {d.is_indexed ? "✓" : "●"}
            </button>
        }
      </div>
    </div>
  );
}

