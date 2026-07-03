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

// A submitted week must account for at least this much time (37.5h). Leave and
// other category hours count toward it; overtime never does.
const MIN_WEEK_MINS = Math.round(37.5 * 60); // 2250

// Timesheets went live on this date; weeks that start before it contain locked
// pre-launch days and physically can't reach the minimum, so they're exempt.
const TIMESHEET_LAUNCH_DATE = "2026-07-01";

// Returns { belowMin, totalMins } for a week's entries. weekStart is the week's
// Monday (YYYY-MM-DD); ISO date strings compare lexically, so < is safe.
function weekBelowMinimum(entries, weekStart, minMins = MIN_WEEK_MINS, launchDate = TIMESHEET_LAUNCH_DATE) {
  const totalMins = (entries || []).reduce((s, e) => s + entryWorkedMins(e || {}), 0);
  if (weekStart && weekStart < launchDate) return { belowMin: false, totalMins };
  return { belowMin: totalMins < minMins, totalMins };
}

module.exports = { daysOverCap, entryWorkedMins, DAY_CAP_MINS, weekBelowMinimum, MIN_WEEK_MINS, TIMESHEET_LAUNCH_DATE };
