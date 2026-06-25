import { useState, useEffect } from "react";
import { api } from "../../api/client";
import { DESIGN_TEXT, COMPARE_FULL, PROJECTS_FULL } from "../../constants";
import { Spinner } from "../common/Spinner";
import { showToast } from "./toast";

// ── Products tab ──────────────────────────────────────────────────────────────
export default function ProductsTab({ projectId, isAdmin }) {
  const [categories, setCategories] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState({});
  const [pickerCategoryId, setPickerCategoryId] = useState(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);
  const [movingId, setMovingId] = useState(null);
  const [viewingProduct, setViewingProduct] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    try {
      const [catData, assignData, libData] = await Promise.all([
        api(`/api/projects/${projectId}/categories`),
        api(`/api/projects/${projectId}/products`),
        api("/api/products"),
      ]);
      setCategories(catData.categories || []);
      setAssignments(assignData.products || []);
      setAllProducts(libData.products || []);
    } catch (e) { console.error(e); showToast("Failed to load products"); }
    setLoading(false);
  }

  async function addCategory() {
    if (!newCategoryName.trim()) return;
    setSavingCategory(true);
    try {
      const { category } = await api(`/api/projects/${projectId}/categories`, {
        method: "POST",
        body: { name: newCategoryName.trim(), sort_order: categories.length },
      });
      setCategories(prev => [...prev, category]);
      setNewCategoryName(""); setAddingCategory(false);
    } catch (e) { console.error(e); showToast("Failed to create category"); }
    setSavingCategory(false);
  }

  async function deleteCategory(catId) {
    const cat = categories.find(c => c.id === catId);
    if (!window.confirm(`Delete category "${cat?.name}"? Products in it will be moved to Uncategorised.`)) return;
    try {
      await api(`/api/projects/${projectId}/categories/${catId}`, { method: "DELETE" });
      await load();
    } catch (e) { console.error(e); showToast("Failed to delete category"); }
  }

  async function assignProduct(productId, categoryId) {
    try {
      const { product } = await api(`/api/projects/${projectId}/products`, {
        method: "POST",
        body: { product_id: productId, category_id: categoryId },
      });
      setAssignments(prev => [...prev, product]);
    } catch (e) {
      if (e.message?.includes("409") || e.message?.includes("already")) return;
      console.error(e);
      showToast("Failed to assign product");
    }
    setPickerCategoryId(null); setPickerSearch("");
  }

  async function removeAssignment(assignmentId) {
    try {
      await api(`/api/projects/${projectId}/products/${assignmentId}`, { method: "DELETE" });
      setAssignments(prev => prev.filter(a => a.id !== assignmentId));
    } catch (e) { console.error(e); showToast("Failed to remove assignment"); }
  }

  async function moveAssignment(assignmentId, newCategoryId) {
    try {
      const { product } = await api(`/api/projects/${projectId}/products/${assignmentId}`, {
        method: "PATCH",
        body: { category_id: newCategoryId },
      });
      setAssignments(prev => prev.map(a => a.id === assignmentId ? product : a));
    } catch (e) { console.error(e); showToast("Failed to move product"); }
    setMovingId(null);
  }

  async function viewDatasheet(product) {
    setViewingProduct(product); setPdfLoading(true); setPdfUrl(null);
    try {
      const data = await api(`/api/products/${product.id}/pdf`);
      const bytes = atob(data.base64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      setPdfUrl(URL.createObjectURL(new Blob([arr], { type: "application/pdf" })));
    } catch (e) { console.error(e); showToast("Failed to load datasheet"); }
    setPdfLoading(false);
  }

  function closePdf() {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null); setViewingProduct(null);
  }

  const assignedProductIds = new Set(assignments.map(a => a.product_id));
  function assignmentsForCategory(catId) { return assignments.filter(a => a.category_id === catId); }
  const pickerProducts = allProducts
    .filter(p => !assignedProductIds.has(p.id))
    .filter(p => {
      if (!pickerSearch.trim()) return true;
      const q = pickerSearch.toLowerCase();
      return (p.name || "").toLowerCase().includes(q) || (p.manufacturer || "").toLowerCase().includes(q);
    });
  const totalAssigned = assignments.length;

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9a9088", fontSize: 13 }}>
      <Spinner size={13} /> Loading products…
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h3 style={{ fontSize: 11, fontWeight: 600, color: "#9a9088", letterSpacing: "0.1em", textTransform: "uppercase" }}>Specified Products</h3>
          {totalAssigned > 0 && <p style={{ fontSize: 11, color: "#b0a8a0", marginTop: 3 }}>{totalAssigned} product{totalAssigned !== 1 ? "s" : ""} assigned</p>}
        </div>
      </div>

      {categories.map(cat => {
        const catAssignments = assignmentsForCategory(cat.id);
        const isCollapsed = collapsed[cat.id];
        return (
          <div key={cat.id} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: DESIGN_TEXT, padding: "8px 14px", cursor: "pointer" }}
              onClick={() => setCollapsed(prev => ({ ...prev, [cat.id]: !prev[cat.id] }))}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fff", flex: 1 }}>{cat.name}</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginRight: 4 }}>{catAssignments.length > 0 ? `${catAssignments.length}` : ""}</span>
              {isAdmin && (
                <button className="btn" onClick={e => { e.stopPropagation(); setPickerCategoryId(cat.id); setPickerSearch(""); }}
                  style={{ fontSize: 10, color: "#fff", background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", padding: "2px 10px", fontWeight: 600, letterSpacing: "0.04em" }}>
                  + Add
                </button>
              )}
              {isAdmin && cat.name !== "Uncategorised" && (
                <button className="btn" onClick={e => { e.stopPropagation(); deleteCategory(cat.id); }}
                  style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", background: "none", border: "none", padding: "0 4px", lineHeight: 1 }}
                  onMouseEnter={e => e.target.style.color = COMPARE_FULL}
                  onMouseLeave={e => e.target.style.color = "rgba(255,255,255,0.4)"}>×</button>
              )}
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginLeft: 2 }}>{isCollapsed ? "▶" : "▼"}</span>
            </div>
            {!isCollapsed && (
              <div style={{ background: "#fff", border: "1px solid #e8e0d5", borderTop: "none" }}>
                {catAssignments.length === 0 ? (
                  <div style={{ padding: "14px 16px", fontSize: 12, color: "#b0a8a0", fontStyle: "italic" }}>
                    No products in this category.{isAdmin && " Click + Add to assign one."}
                  </div>
                ) : (
                  catAssignments.map((a, i) => {
                    const prod = a.products;
                    if (!prod) return null;
                    return (
                      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: i < catAssignments.length - 1 ? "1px solid #f0ede8" : "none", background: i % 2 === 0 ? "#f8f8fa" : "#fff" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: DESIGN_TEXT, marginBottom: 1 }}>{prod.name}</div>
                          <div style={{ fontSize: 11, color: "#9a9088" }}>{prod.manufacturer || "—"}</div>
                        </div>
                        {prod.product_type && (
                          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "#2a6496", background: "#e8f0f8", padding: "2px 7px", flexShrink: 0 }}>
                            {prod.product_type}
                          </span>
                        )}
                        {prod.file_key && (
                          <button className="btn" onClick={() => viewDatasheet(prod)}
                            style={{ fontSize: 11, color: "#2a6496", background: "none", border: "1px solid #b8d0e8", padding: "3px 10px", flexShrink: 0, fontWeight: 500 }}>
                            📄 Datasheet
                          </button>
                        )}
                        {isAdmin && (
                          movingId === a.id ? (
                            <select autoFocus defaultValue={a.category_id || ""}
                              onChange={e => { if (e.target.value) moveAssignment(a.id, e.target.value); else setMovingId(null); }}
                              onBlur={() => setMovingId(null)}
                              style={{ fontSize: 11, padding: "3px 6px", border: "1px solid #e4e4e8", fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT }}>
                              <option value="">— cancel —</option>
                              {categories.filter(c => c.id !== a.category_id).map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          ) : (
                            <button className="btn" onClick={() => setMovingId(a.id)}
                              title="Move to another category"
                              style={{ fontSize: 11, color: "#9a9088", background: "none", border: "1px solid #e4e4e8", padding: "3px 8px", flexShrink: 0 }}>
                              ⇄
                            </button>
                          )
                        )}
                        {isAdmin && (
                          <button className="btn" onClick={() => removeAssignment(a.id)}
                            style={{ fontSize: 14, color: "#c8c0b8", background: "none", border: "none", padding: "0 4px", flexShrink: 0 }}
                            onMouseEnter={e => e.target.style.color = COMPARE_FULL}
                            onMouseLeave={e => e.target.style.color = "#c8c0b8"}>×</button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}

      {isAdmin && (
        <div style={{ marginTop: 16 }}>
          {addingCategory ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} autoFocus
                placeholder="Category name…"
                onKeyDown={e => { if (e.key === "Enter") addCategory(); if (e.key === "Escape") { setAddingCategory(false); setNewCategoryName(""); } }}
                style={{ flex: 1, border: "1px solid #e4e4e8", padding: "7px 10px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, outline: "none" }} />
              <button className="btn" onClick={addCategory} disabled={!newCategoryName.trim() || savingCategory}
                style={{ background: PROJECTS_FULL, color: "#fff", padding: "7px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {savingCategory ? <Spinner size={11} /> : "Add"}
              </button>
              <button className="btn" onClick={() => { setAddingCategory(false); setNewCategoryName(""); }}
                style={{ background: "none", color: "#9a9088", padding: "7px 12px", fontSize: 11, border: "1px solid #e4e4e8" }}>Cancel</button>
            </div>
          ) : (
            <button className="btn" onClick={() => setAddingCategory(true)}
              style={{ fontSize: 11, color: "#9a9088", background: "none", border: "1px solid #e4e4e8", padding: "6px 16px", fontWeight: 600, letterSpacing: "0.04em" }}>
              + Add Category
            </button>
          )}
        </div>
      )}

      {pickerCategoryId !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", width: 520, maxHeight: "80vh", display: "flex", flexDirection: "column", borderTop: `3px solid ${PROJECTS_FULL}`, fontFamily: "Inter, Arial, sans-serif" }}>
            <div style={{ padding: "20px 24px 14px", borderBottom: "1px solid #e8e0d5", flexShrink: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: DESIGN_TEXT, marginBottom: 12 }}>
                Add Product — {categories.find(c => c.id === pickerCategoryId)?.name}
              </div>
              <input value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} autoFocus
                placeholder="Search by name or manufacturer…"
                style={{ width: "100%", border: "1px solid #e4e4e8", padding: "8px 12px", fontSize: 13, fontFamily: "Inter, Arial, sans-serif", color: DESIGN_TEXT, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
              {allProducts.length === 0 ? (
                <div style={{ padding: "32px", textAlign: "center", fontSize: 13, color: "#9a9088" }}>No products in the library yet.</div>
              ) : pickerProducts.length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", fontSize: 13, color: "#9a9088" }}>
                  {assignedProductIds.size === allProducts.length ? "All library products are already assigned to this project." : "No products match your search."}
                </div>
              ) : (
                pickerProducts.map(p => (
                  <div key={p.id}
                    onClick={() => assignProduct(p.id, pickerCategoryId)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 24px", cursor: "pointer", borderBottom: "1px solid #f0ede8" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f0f8f0"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: DESIGN_TEXT }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "#9a9088", marginTop: 1 }}>{p.manufacturer || "—"}</div>
                    </div>
                    {p.product_type && (
                      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "#2a6496", background: "#e8f0f8", padding: "2px 7px", flexShrink: 0 }}>
                        {p.product_type}
                      </span>
                    )}
                    <span style={{ fontSize: 18, color: PROJECTS_FULL, flexShrink: 0 }}>+</span>
                  </div>
                ))
              )}
            </div>
            <div style={{ padding: "12px 24px", borderTop: "1px solid #e8e0d5", flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => { setPickerCategoryId(null); setPickerSearch(""); }}
                style={{ background: "none", color: "#9a9088", padding: "7px 16px", fontSize: 11, border: "1px solid #e4e4e8" }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {viewingProduct && (
        <div style={{ position: "fixed", inset: 0, background: "#1a1a1a", zIndex: 2000, display: "flex", flexDirection: "column" }}>
          <div style={{ background: DESIGN_TEXT, padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{viewingProduct.name}</div>
              {viewingProduct.manufacturer && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>{viewingProduct.manufacturer}</div>}
            </div>
            <button className="btn" onClick={closePdf}
              style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", padding: "7px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em" }}>
              Close ✕
            </button>
          </div>
          <div style={{ flex: 1, background: "#525659", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {pdfLoading && <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#fff", fontSize: 13 }}><Spinner size={14} /> Loading datasheet…</div>}
            {pdfUrl && !pdfLoading && <iframe src={pdfUrl} style={{ width: "100%", height: "100%", border: "none" }} title={viewingProduct.name} />}
          </div>
        </div>
      )}
    </div>
  );
}

