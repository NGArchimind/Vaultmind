"use strict";

// Parse 'YYYY-MM-DD' at UTC noon to avoid DST/offset edges in date arithmetic.
function parseISODateUTCNoon(dateStr) {
  return new Date(dateStr + "T12:00:00Z");
}
function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

// Monday (week_start) of the week containing dateStr, as 'YYYY-MM-DD'.
function mondayOf(dateStr) {
  const d = parseISODateUTCNoon(dateStr);
  const dow = d.getUTCDay();                 // 0=Sun .. 6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;     // shift back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return toISODate(d);
}

// Inclusive list of Monday week_starts from fromMonday to toMonday.
function enumerateWeekStarts(fromMonday, toMonday) {
  const out = [];
  const cur = parseISODateUTCNoon(fromMonday);
  const end = parseISODateUTCNoon(toMonday);
  while (cur <= end) {
    out.push(toISODate(cur));
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return out;
}

// Later of two 'YYYY-MM-DD' strings (lexicographic == chronological for ISO dates).
function laterMonday(a, b) {
  return a >= b ? a : b;
}

function isRemindableRole(role) {
  return role !== "admin" && role !== "hr";
}

// submissions: { [week_start]: status }. Returns outstanding weeks with a label.
function computeOutstandingWeeks(weekStarts, submissions) {
  const done = new Set(["submitted", "approved"]);
  return weekStarts
    .filter((w) => !done.has(submissions[w]))
    .map((w) => ({ week: w, label: submissions[w] === "draft" ? "Draft" : "Not started" }));
}

// UK (Europe/London) day/time/date parts for a given instant — handles BST automatically.
function ukParts(date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "short", hour12: false,
    hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const dayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const hour = p.hour === "24" ? "00" : p.hour; // some ICU builds emit "24" at midnight
  return { day: dayMap[p.weekday], time: `${hour}:${p.minute}`, dateStr: `${p.year}-${p.month}-${p.day}` };
}

// Times are zero-padded "HH:MM", so string comparison is chronological.
function isReminderDue({ nowDay, nowTime, cfgDay, cfgTime, currentWeekMonday, lastSentWeek }) {
  if (nowDay !== cfgDay) return false;
  if (nowTime < cfgTime) return false;
  if (lastSentWeek === currentWeekMonday) return false;
  return true;
}

module.exports = {
  parseISODateUTCNoon, toISODate, mondayOf, enumerateWeekStarts,
  laterMonday, isRemindableRole, computeOutstandingWeeks, ukParts, isReminderDue,
};
