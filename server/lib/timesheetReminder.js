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

// Monday string shifted by n weeks (n may be negative).
function addWeeks(monday, n) {
  const d = parseISODateUTCNoon(monday);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return toISODate(d);
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

// The Monday the timesheet page should open on: the earliest tracked week not
// yet submitted/approved; if everything (incl. the current week) is done, the
// following week; if tracking hasn't started yet, the current week.
function firstOutstandingWeek(weekStarts, submissions, currentWeekMonday) {
  if (!weekStarts || !weekStarts.length) return currentWeekMonday;
  const outstanding = computeOutstandingWeeks(weekStarts, submissions || {});
  if (outstanding.length) return outstanding[0].week;
  return addWeeks(currentWeekMonday, 1);
}

// Week-by-week status for the admin review screen. users: [{id, name, role, createdAt}];
// subsByUser: { [userId]: { [week_start]: status } }. Only remindable roles count as
// expected, and never before the week their account was created (same rules as the
// reminder emails). Returns newest-first: [{ week, expected, outstanding: [{id, name, label}] }].
function buildWeekStatus({ users, subsByUser, trackFromMonday, currentWeekMonday }) {
  const weeks = enumerateWeekStarts(trackFromMonday, currentWeekMonday);
  const staff = (users || [])
    .filter((u) => isRemindableRole(u.role))
    .map((u) => ({ ...u, startMonday: laterMonday(trackFromMonday, mondayOf(u.createdAt || trackFromMonday)) }));
  return weeks
    .map((week) => {
      const expectedStaff = staff.filter((u) => u.startMonday <= week);
      const outstanding = expectedStaff
        .flatMap((u) => computeOutstandingWeeks([week], (subsByUser || {})[u.id] || {})
          .map((o) => ({ id: u.id, name: u.name, label: o.label })))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { week, expected: expectedStaff.length, outstanding };
    })
    .reverse();
}

// Recipients (from computeReminderRecipients) whose outstanding weeks include the given week.
function filterRecipientsToWeek(recipients, week) {
  return (recipients || []).filter((r) => (r.weeks || []).some((w) => w.week === week));
}

// Times are zero-padded "HH:MM", so string comparison is chronological.
function isReminderDue({ nowDay, nowTime, cfgDay, cfgTime, currentWeekMonday, lastSentWeek }) {
  if (nowDay !== cfgDay) return false;
  if (nowTime < cfgTime) return false;
  if (lastSentWeek === currentWeekMonday) return false;
  return true;
}

module.exports = {
  parseISODateUTCNoon, toISODate, mondayOf, enumerateWeekStarts, addWeeks,
  laterMonday, isRemindableRole, computeOutstandingWeeks, ukParts, isReminderDue,
  firstOutstandingWeek, buildWeekStatus, filterRecipientsToWeek,
};
