// A single day's "time worked" (overtime EXCLUDED) must not exceed this.
const DAY_CAP_MINS = 7 * 60 + 30; // 450 = 7h 30m

function entryWorkedMins(e) { return (e.hours || 0) * 60 + (e.minutes || 0); }

// Returns [{ date, mins }] for days whose time-worked total exceeds capMins.
// Overtime is never counted — that's where over-cap time is meant to go.
function daysOverCap(entries, capMins = DAY_CAP_MINS) {
  const byDay = {};
  for (const e of entries || []) {
    if (!e || !e.entry_date) continue;
    byDay[e.entry_date] = (byDay[e.entry_date] || 0) + entryWorkedMins(e);
  }
  return Object.keys(byDay)
    .filter(date => byDay[date] > capMins)
    .sort()
    .map(date => ({ date, mins: byDay[date] }));
}

module.exports = { daysOverCap, entryWorkedMins, DAY_CAP_MINS };
