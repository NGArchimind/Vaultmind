// Shared helpers for the Project Map tab.

export function formatMapDate(str) {
  if (!str) return "No date";
  const [y, m, d] = String(str).slice(0, 10).split("-");
  return new Date(Number(y), Number(m) - 1, Number(d))
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function pendingEntries(item) {
  return (item.project_map_entries || []).filter(e => e.state === "pending");
}

// History oldest first, so the tree reads in the order things happened.
export function sortedHistory(item) {
  const key = e => `${e.entry_date || String(e.created_at).slice(0, 10)}|${e.created_at}`;
  return [...(item.project_map_entries || [])].sort((a, b) => (key(a) < key(b) ? -1 : 1));
}

export function itemMatchesSearch(item, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (`${item.title} ${item.current_value}`.toLowerCase().includes(q)) return true;
  return (item.project_map_entries || []).some(e =>
    `${e.value} ${e.quote} ${e.stated_by} ${e.source_label}`.toLowerCase().includes(q));
}

// Items needing sign-off first, then alphabetical.
export function sortItems(items) {
  return [...items].sort((a, b) => {
    const pa = pendingEntries(a).length > 0, pb = pendingEntries(b).length > 0;
    if (pa !== pb) return pa ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

// Splits text around the first occurrence of quote (whitespace-insensitive) so
// the passage can be highlighted. Returns null when the quote isn't found.
export function splitAroundQuote(text, quote) {
  const words = String(quote || "").trim().split(/\s+/).filter(Boolean);
  if (!text || words.length === 0) return null;
  const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const match = new RegExp(pattern, "i").exec(text);
  if (!match) return null;
  return {
    before: text.slice(0, match.index),
    match: match[0],
    after: text.slice(match.index + match[0].length),
  };
}
