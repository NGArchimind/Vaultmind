import { useState, useEffect } from "react";
import { api } from "../api/client";
import { Spinner } from "./common/Spinner";
import { DESIGN_GROUND, DESIGN_TEXT, PROJECTS_FULL, COMPARE_FULL } from "../constants";
import { showToast, setToastHandler } from "./projects/toast";
import NewProjectForm from "./projects/NewProjectForm";
import ProjectCard from "./projects/ProjectCard";
import ProjectDetail from "./projects/ProjectDetail";

// Projects list — top-level component (project list + ProjectDetail container)
export default function ProjectsSection({ isAdmin }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState("active");
  const [toast, setToast] = useState(null);

  // Wire module-level dispatcher to this component's state setter
  setToastHandler((text) => {
    setToast(text);
    setTimeout(() => setToast(null), 4000);
  });

  useEffect(() => { loadProjects(); }, []);

  // silent = background refresh (e.g. returning from a project after an edit) —
  // skip the loading spinner so the list updates without a flicker.
  async function loadProjects(silent = false) {
    if (!silent) setLoading(true);
    try { const { projects: data } = await api("/api/projects"); setProjects(data || []); } catch (e) { console.error(e); showToast("Failed to load projects"); }
    if (!silent) setLoading(false);
  }

  async function createProject(form) {
    try {
      const { project } = await api("/api/projects", { method: "POST", body: form });
      setProjects(prev => [project, ...prev]);
      setShowNewForm(false);
      setSelectedId(project.id);
    } catch (e) { console.error(e); showToast("Failed to create project"); }
  }

  if (selectedId) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: DESIGN_GROUND }}>
        <div style={{ background: PROJECTS_FULL, padding:"12px 40px", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
          <span style={{ fontSize:11, fontWeight:500, color:"#fff", letterSpacing:".16em", textTransform:"uppercase" }}>Projects</span>
          <span style={{ fontSize:9, fontWeight:500, color:"rgba(255,255,255,0.45)", letterSpacing:".14em", textTransform:"uppercase" }}>— Practice Management</span>
        </div>
        <ProjectDetail projectId={selectedId} onBack={() => { setSelectedId(null); loadProjects(true); }} isAdmin={isAdmin} />
      </div>
    );
  }

  const filtered = projects.filter(p => {
    if (filterStatus === "archived") return p.status === "archived";
    if (p.status === "archived") return false;               // hide archived from every other view
    return filterStatus === "all" || p.status === filterStatus;
  });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: DESIGN_GROUND }}>
      <div style={{ background: PROJECTS_FULL, padding:"12px 40px", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
        <span style={{ fontSize:11, fontWeight:500, color:"#fff", letterSpacing:".16em", textTransform:"uppercase" }}>Projects</span>
        <span style={{ fontSize:9, fontWeight:500, color:"rgba(255,255,255,0.45)", letterSpacing:".14em", textTransform:"uppercase" }}>— Practice Management</span>
      </div>
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9999,
          background: COMPARE_FULL, color: "#fff",
          padding: "12px 20px", fontSize: 13,
          fontFamily: "Inter, Arial, sans-serif",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          maxWidth: 360, lineHeight: 1.5,
          animation: "fadeIn 0.2s ease"
        }}>
          {toast}
        </div>
      )}
      <div style={{ background: "#ffffff", borderBottom: "1px solid #e8e0d5", padding: "20px 32px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 300, color: DESIGN_TEXT, fontFamily: "Inter, Arial, sans-serif" }}>Projects</h1>
            <p style={{ fontSize: 11, color: "#9a9088", marginTop: 4, letterSpacing: "0.04em", textTransform: "uppercase" }}>{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", border: "1px solid #e8e0d5", overflow: "hidden" }}>
              {["active","all","on-hold","complete","archived"].map(s => (
                <button key={s} className="btn" onClick={() => setFilterStatus(s)}
                  style={{ padding: "6px 14px", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", background: filterStatus === s ? DESIGN_TEXT : "transparent", color: filterStatus === s ? "#fff" : "#9a9088", border: "none", borderRight: "1px solid #e8e0d5" }}>
                  {s === "on-hold" ? "On Hold" : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            {isAdmin && <button className="btn" onClick={() => setShowNewForm(true)} style={{ background: DESIGN_TEXT, color: "#fff", padding: "8px 20px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>+ New Project</button>}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
        {showNewForm && <NewProjectForm onSave={createProject} onCancel={() => setShowNewForm(false)} />}
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#9a9088", fontSize: 13 }}><Spinner size={13} /> Loading projects…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 40px" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🏗</div>
            <p style={{ fontSize: 15, color: DESIGN_TEXT, fontWeight: 300, fontFamily: "Inter, Arial, sans-serif", marginBottom: 8 }}>{projects.length === 0 ? "No projects yet" : "No projects match this filter"}</p>
            <p style={{ fontSize: 12, color: "#9a9088" }}>{projects.length === 0 && isAdmin ? "Click + New Project to get started" : "Try a different filter"}</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 900 }}>
            {filtered.map(p => <ProjectCard key={p.id} project={p} onClick={() => setSelectedId(p.id)} />)}
          </div>
        )}
      </div>
    </div>
  );
}
