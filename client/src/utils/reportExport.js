// Shared helpers for the timesheet/fee reports: date presets, CSV, filter summary.
// No external dependencies.

// Build YYYY-MM-DD from LOCAL date parts — never toISOString() (UTC shifts the
// day back under British Summer Time). Mirrors isoDate() used elsewhere.
export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Sunday of the week containing `d` (weeks run Mon–Sun for filtering purposes,
// so the current week — including days logged ahead — is always included).
export function endOfCurrentWeek(d = new Date()) {
  const x = new Date(d);
  const day = x.getDay();              // 0 = Sun, 1 = Mon …
  const add = day === 0 ? 0 : 7 - day; // days forward to Sunday
  x.setDate(x.getDate() + add);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Returns { from, to } as YYYY-MM-DD for a named preset.
// "to" is always the end of the current week so the live week shows.
export function datePreset(name) {
  const now = new Date();
  const to = endOfCurrentWeek(now);
  let from = new Date(now);
  switch (name) {
    case "week":    from = new Date(now); from.setDate(now.getDate() - now.getDay() + 1); break; // Mon this week
    case "month":   from = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case "quarter": from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1); break;
    case "year":    from = new Date(now.getFullYear(), 0, 1); break;
    default:        from = new Date(now.getFullYear(), now.getMonth() - 3, 1); break; // fallback ~3 months
  }
  from.setHours(0, 0, 0, 0);
  return { from: isoDate(from), to: isoDate(to) };
}

// Convert an array of plain objects to a CSV string. Columns = keys of the
// first row, in order. Values are quoted and internal quotes doubled.
export function toCsv(rows) {
  if (!rows || rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = cols.map(esc).join(",");
  const body = rows.map(r => cols.map(c => esc(r[c])).join(",")).join("\r\n");
  return `${header}\r\n${body}`;
}

// Trigger a browser download of a CSV string.
export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Human-readable one-line summary of the active filters (for screen + exports).
// parts = array of strings already formatted by the caller.
export function filterSummary(parts) {
  const clean = parts.filter(Boolean);
  return clean.length ? clean.join(" · ") : "All data";
}
