// Distinct project ids preserving first-seen order (rows passed newest-first), capped.
function recentProjectIds(rows, limit = 8) {
  const seen = [];
  for (const r of rows) {
    const id = r && r.project_id;
    if (!id) continue;
    if (!seen.includes(id)) seen.push(id);
    if (seen.length >= limit) break;
  }
  return seen;
}
module.exports = { recentProjectIds };
