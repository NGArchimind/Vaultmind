"use strict";
// Staff leavers — pure rules. Leaver state lives on the Supabase auth user's
// app_metadata: left_at ('YYYY-MM-DD', their last working day) and
// leaver_closed_at (ISO timestamp, set once the account has been closed).
// All dates are ISO strings, so string comparison == chronological comparison.
const { mondayOf } = require("./timesheetReminder");
const { DAY_CAP_MINS, MIN_WEEK_MINS } = require("./timesheetValidation");

function isISODate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T12:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

// "active" (no leaving date) | "leaving" (works up to and including left_at) | "left".
function leaverStatus(appMetadata, todayISO) {
  const leftAt = appMetadata?.left_at;
  if (typeof leftAt !== "string" || !leftAt) return "active";
  return leftAt < todayISO ? "left" : "leaving";
}

// Returns an error message, or null when valid. Future dates are allowed (notice period).
function validateLeftAt(leftAt, { createdISO }) {
  if (!isISODate(leftAt)) return "Leaving date must be YYYY-MM-DD";
  if (createdISO && leftAt < createdISO.slice(0, 10)) return "Leaving date cannot be before the account was created";
  return null;
}

// Minutes a week must account for before it can be submitted: a full week
// normally, 7.5h per weekday up to and including the leaving date in the leaving week.
function requiredWeekMins(weekStart, leftAt) {
  if (!leftAt) return MIN_WEEK_MINS;
  const d = new Date(weekStart + "T12:00:00Z");
  let weekdays = 0;
  for (let i = 0; i < 5; i++) {
    if (d.toISOString().slice(0, 10) > leftAt) break;
    weekdays++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return weekdays === 5 ? MIN_WEEK_MINS : weekdays * DAY_CAP_MINS;
}

// True once the leaving date has passed and the account hasn't been closed yet.
function needsClosing(appMetadata, todayISO) {
  return leaverStatus(appMetadata, todayISO) === "left" && !appMetadata?.leaver_closed_at;
}

function leavingWeek(leftAt) {
  return mondayOf(leftAt);
}

// Still on staff (active or working their notice) — used to keep leavers off
// admin/HR notification and HR-report mailing lists.
function isCurrentStaff(appMetadata, todayISO) {
  return leaverStatus(appMetadata, todayISO) !== "left";
}

// Weeks after the leaving week are entirely n/a and must not be submitted.
function isAfterLeavingWeek(week, leftAt) {
  return !!leftAt && week > mondayOf(leftAt);
}

module.exports = { isISODate, leaverStatus, validateLeftAt, requiredWeekMins, needsClosing, leavingWeek, isCurrentStaff, isAfterLeavingWeek };
