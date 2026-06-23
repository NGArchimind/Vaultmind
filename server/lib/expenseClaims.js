function claimTotalPence(items) {
  return (items || []).reduce((s, e) => s + (e.amount_pence || 0), 0);
}

function claimSummary(items) {
  return { count: (items || []).length, total_pence: claimTotalPence(items) };
}

module.exports = { claimTotalPence, claimSummary };
