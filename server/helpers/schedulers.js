// Scheduled jobs + helpers: weekly timesheet reminder and weekly HR report
// (15-min tickers, idempotent via app_settings), plus claim-decision emails.
// Extracted verbatim from index.js.
const { supabase } = require("./clients");
const { sendEmail, escapeHtml, notificationEmailHtml, notificationRecipients, getUserEmail, getHrEmails } = require("./email");
const reminderLib = require("../lib/timesheetReminder");
const hrReport = require("../lib/hrReport");
const { renderReportPdf, renderReportExcel } = require("../lib/hrReportRender");
const { claimTotalPence } = require("../lib/expenseClaims");

const HR_REPORT_DEFAULTS = { enabled: true, day: 1, time: "08:00", coverage: "previous" };
const APP_URL = process.env.PUBLIC_APP_URL || "https://archimind.co.uk";
const REMINDER_DEFAULTS = { enabled: true, day: 5, time: "16:00", track_from: "2026-07-01" };

async function getReminderSettings() {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "timesheet_reminder").maybeSingle();
  let parsed = {};
  try { parsed = data?.value ? JSON.parse(data.value) : {}; } catch { parsed = {}; }
  return { ...REMINDER_DEFAULTS, ...parsed };
}
async function getReminderState() {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "timesheet_reminder_state").maybeSingle();
  try { return data?.value ? JSON.parse(data.value) : {}; } catch { return {}; }
}
async function setReminderState(state) {
  await supabase.from("app_settings").upsert(
    { key: "timesheet_reminder_state", value: JSON.stringify(state), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
}

// Branded reminder email body (uses the shared notificationEmailHtml wrapper).
function reminderEmailHtml(firstName, weeks) {
  const rows = weeks.map((w, i) => {
    const colour = w.label === "Draft" ? "#8a6a3a" : "#c0392b";
    const bg = i % 2 === 0 ? "#f6f8f9" : "#ffffff";
    return `<tr style="background:${bg};"><td style="padding:9px 12px;color:#262830;border:1px solid #e3e9ec;">${escapeHtml(formatWeekRange(w.week))}</td>`
      + `<td style="padding:9px 12px;color:${colour};border:1px solid #e3e9ec;width:110px;">${w.label}</td></tr>`;
  }).join("");
  const body = `<p style="margin:0 0 14px;font-size:15px;color:#262830;">Hi ${escapeHtml(firstName)},</p>`
    + `<p style="margin:0 0 16px;font-size:14px;color:#262830;">The following timesheets are <strong>not yet submitted</strong>:</p>`
    + `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">${rows}</table>`
    + `<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#5a6b76;">Please ensure timesheets are completed at the end of each week. These are critical to ensuring fees are tracked effectively and jobs are priced correctly.</p>`
    // The "Open Archimind" button now comes from the notificationEmailHtml wrapper.
    + `<p style="margin:0;font-size:12px;color:#8a9aa8;">You're receiving this because your timesheet is outstanding. Once submitted, you'll drop off next week's reminder.</p>`;
  return notificationEmailHtml("Timesheets", body);
}

// Build recipients. onlyUserId (optional) = test mode: target just that user and
// bypass the admin/HR role filter so an admin can preview against their own account.
async function computeReminderRecipients(settings, onlyUserId) {
  const trackFromMonday = reminderLib.mondayOf(settings.track_from);
  const ukNow = reminderLib.ukParts(new Date());
  const currentWeekMonday = reminderLib.mondayOf(ukNow.dateStr);

  const { data: subs } = await supabase
    .from("timesheet_submissions").select("user_id, week_start, status")
    .gte("week_start", trackFromMonday);
  const byUser = {};
  for (const s of subs || []) (byUser[s.user_id] ||= {})[s.week_start] = s.status;

  const { data: usersData } = await supabase.auth.admin.listUsers();
  const recipients = [];
  for (const u of usersData?.users || []) {
    if (onlyUserId && u.id !== onlyUserId) continue;
    if (!onlyUserId && !reminderLib.isRemindableRole(u.app_metadata?.role)) continue;
    const createdMonday = reminderLib.mondayOf((u.created_at || settings.track_from).slice(0, 10));
    const start = reminderLib.laterMonday(trackFromMonday, createdMonday);
    if (start > currentWeekMonday) continue;
    const weeks = reminderLib.computeOutstandingWeeks(
      reminderLib.enumerateWeekStarts(start, currentWeekMonday), byUser[u.id] || {});
    if (!weeks.length || !u.email) continue;
    const firstName = (u.user_metadata?.full_name || u.email || "there").split(/[ @]/)[0];
    recipients.push({ email: u.email, firstName, weeks });
  }
  return recipients;
}

// Send the branded outstanding-timesheets email to each recipient (from
// computeReminderRecipients). Shared by the Friday scheduler and the admin
// review screen's manual "Send reminder" button.
async function sendReminderEmails(recipients) {
  for (const r of recipients) {
    const n = r.weeks.length;
    await sendEmail({
      to: r.email,
      subject: `Timesheet reminder — you have ${n} outstanding timesheet${n === 1 ? "" : "s"}`,
      html: reminderEmailHtml(r.firstName, r.weeks),
      text: `Hi ${r.firstName},\n\nThe following timesheets are not yet submitted:\n`
        + r.weeks.map((w) => `- ${formatWeekRange(w.week)} (${w.label})`).join("\n")
        + `\n\nPlease ensure timesheets are completed at the end of each week. These are critical to ensuring fees are tracked effectively and jobs are priced correctly.\n\nOpen Archimind: ${APP_URL}`,
    });
  }
  return recipients.length;
}

async function runTimesheetReminders(onlyUserId) {
  const settings = await getReminderSettings();
  const recipients = await computeReminderRecipients(settings, onlyUserId);
  return sendReminderEmails(recipients);
}

// 15-minute scheduler — fires once on the configured UK day at/after the configured time.
async function reminderTick() {
  try {
    const settings = await getReminderSettings();
    if (!settings.enabled) return;
    const ukNow = reminderLib.ukParts(new Date());
    const currentWeekMonday = reminderLib.mondayOf(ukNow.dateStr);
    const state = await getReminderState();
    if (!reminderLib.isReminderDue({
      nowDay: ukNow.day, nowTime: ukNow.time, cfgDay: settings.day, cfgTime: settings.time,
      currentWeekMonday, lastSentWeek: state.last_sent_week,
    })) return;
    const count = await runTimesheetReminders();
    await setReminderState({ last_sent_week: currentWeekMonday });
    console.log(`[Reminder] Sent timesheet reminders to ${count} staff for week ${currentWeekMonday}`);
  } catch (e) {
    console.error("[Reminder] tick failed:", e.message);
  }
}

async function getHrReportSettings() {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "hr_report").maybeSingle();
  let parsed = {};
  try { parsed = data?.value ? JSON.parse(data.value) : {}; } catch { parsed = {}; }
  return { ...HR_REPORT_DEFAULTS, ...parsed };
}
async function getHrReportState() {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "hr_report_state").maybeSingle();
  try { return data?.value ? JSON.parse(data.value) : {}; } catch { return {}; }
}
async function setHrReportState(state) {
  await supabase.from("app_settings").upsert(
    { key: "hr_report_state", value: JSON.stringify(state), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
}

function hrProjectLabel(e) {
  if (e.projects) return `${e.projects.job_number ? e.projects.job_number + " — " : ""}${e.projects.name}`;
  if (e.category === "internal") return "Practice / Internal";
  return e.category ? e.category.charAt(0).toUpperCase() + e.category.slice(1) : "Unassigned";
}
function hrToHours(h, m) { return (Number(h || 0) * 60 + Number(m || 0)) / 60; }

async function gatherHrReportData(reportWeekMonday) {
  const end = new Date(reportWeekMonday + "T12:00:00Z");
  end.setUTCDate(end.getUTCDate() + 6);
  const reportWeekEnd = end.toISOString().slice(0, 10);

  const [{ data: rawEntries }, { data: subs }, { data: usersData }] = await Promise.all([
    supabase.from("timesheets")
      .select("user_id, entry_date, hours, minutes, overtime_hours, overtime_minutes, category, notes, projects(name, job_number)")
      .gte("entry_date", reportWeekMonday).lte("entry_date", reportWeekEnd),
    supabase.from("timesheet_submissions").select("user_id, status").eq("week_start", reportWeekMonday),
    supabase.auth.admin.listUsers(),
  ]);

  const users = usersData?.users || [];
  const nameById = {};
  for (const u of users) nameById[u.id] = u.user_metadata?.full_name || u.email || "Unknown";

  const entries = (rawEntries || []).map((e) => ({
    userId: e.user_id, name: nameById[e.user_id] || "Unknown",
    projectLabel: hrProjectLabel(e), hours: hrToHours(e.hours, e.minutes), overtime: hrToHours(e.overtime_hours, e.overtime_minutes),
  }));

  const detailRows = (rawEntries || []).map((e) => ({
    date: new Date(e.entry_date + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    name: nameById[e.user_id] || "Unknown", projectLabel: hrProjectLabel(e),
    hours: hrReport.round1(hrToHours(e.hours, e.minutes)), overtime: hrReport.round1(hrToHours(e.overtime_hours, e.overtime_minutes)),
    notes: e.notes || "",
  })).sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date));

  const expected = users
    .filter((u) => reminderLib.isRemindableRole(u.app_metadata?.role))
    .map((u) => ({ userId: u.id, name: nameById[u.id] }));

  const statusByUser = {};
  for (const s of subs || []) statusByUser[s.user_id] = s.status;

  return { entries, detailRows, expected, statusByUser };
}

async function runHrReport(onlyEmail) {
  const settings = await getHrReportSettings();
  const ukNow = reminderLib.ukParts(new Date());
  const sendWeekMonday = reminderLib.mondayOf(ukNow.dateStr);
  const reportWeekMonday = settings.coverage === "current" ? sendWeekMonday : reminderLib.addWeeks(sendWeekMonday, -1);

  const { entries, detailRows, expected, statusByUser } = await gatherHrReportData(reportWeekMonday);
  const model = hrReport.buildHrReportModel({ entries, expected, statusByUser });
  const weekLabel = formatWeekRange(reportWeekMonday);

  const [pdf, xlsx] = await Promise.all([
    renderReportPdf(model, weekLabel),
    renderReportExcel(model, detailRows, weekLabel),
  ]);

  const recipients = onlyEmail ? [onlyEmail] : await getHrEmails();
  if (!recipients.length) return 0;

  const fileBase = `weekly-timesheet-report-${reportWeekMonday}`;
  const body = `<p style="margin:0 0 14px;font-size:15px;color:#262830;">The weekly timesheet report for <strong>${escapeHtml(weekLabel)}</strong> is attached (PDF + Excel).</p>`
    + `<p style="margin:0;font-size:13px;color:#5a6b76;">Total: <strong>${model.totals.hours}</strong> hours`
    + (model.totals.overtime ? `, including <strong>${model.totals.overtime}</strong> overtime` : "")
    + ` across ${model.people.length} staff.</p>`;

  await sendEmail({
    to: recipients,
    subject: `Weekly timesheet report — ${weekLabel}`,
    html: notificationEmailHtml("Timesheets", body),
    text: `The weekly timesheet report for ${weekLabel} is attached (PDF + Excel). Total ${model.totals.hours} hours across ${model.people.length} staff.`,
    attachments: [
      { filename: `${fileBase}.pdf`, content: pdf.toString("base64") },
      { filename: `${fileBase}.xlsx`, content: xlsx.toString("base64") },
    ],
  });
  return recipients.length;
}

async function hrReportTick() {
  try {
    const settings = await getHrReportSettings();
    if (!settings.enabled) return;
    const ukNow = reminderLib.ukParts(new Date());
    const sendWeekMonday = reminderLib.mondayOf(ukNow.dateStr);
    const state = await getHrReportState();
    if (!reminderLib.isReminderDue({
      nowDay: ukNow.day, nowTime: ukNow.time, cfgDay: settings.day, cfgTime: settings.time,
      currentWeekMonday: sendWeekMonday, lastSentWeek: state.last_sent_week,
    })) return;
    const count = await runHrReport();
    await setHrReportState({ last_sent_week: sendWeekMonday });
    console.log(`[HR report] Sent weekly report to ${count} HR recipient(s) for send-week ${sendWeekMonday}`);
  } catch (e) {
    console.error("[HR report] tick failed:", e.message);
  }
}

// "8 Jun – 12 Jun 2026" from a Monday week_start string.
function formatWeekRange(week) {
  const weekDate = new Date(week + "T12:00:00Z");
  const fri = new Date(weekDate); fri.setUTCDate(fri.getUTCDate() + 4);
  const o = { day: "numeric", month: "short" };
  return `${weekDate.toLocaleDateString("en-GB", o)} – ${fri.toLocaleDateString("en-GB", { ...o, year: "numeric" })}`;
}

// Notify on an admin expense-claim decision. The claim owner is ALWAYS emailed
// on rejection (they must act on it); the configured Admin/HR role(s) are
// emailed per the expense_decided toggles for both outcomes.
async function notifyClaimDecision(claim, outcome, reason) {
  if (!claim) return;
  const ownerEmail = await getUserEmail(claim.user_id);
  const amtStr = `£${(claimTotalPence(claim.project_expenses || []) / 100).toFixed(2)}`;
  const reasonHtml = outcome === "rejected" && reason
    ? `<p style="margin:14px 0 0;font-size:13px;color:#6a8a9a;">Reason:</p><p style="margin:4px 0 0;font-size:13px;color:#262830;padding:10px 14px;background:#f1f2f4;border-left:3px solid #4c6278;">${escapeHtml(reason)}</p>`
    : "";

  if (outcome === "rejected" && ownerEmail) {
    await sendEmail({
      to: ownerEmail,
      subject: `Your expense claim has been returned — ${amtStr}`,
      html: notificationEmailHtml("Expenses", `<p style="margin:0;font-size:15px;color:#262830;">Your expense claim of <strong>${amtStr}</strong> has been returned. Please review and resubmit it.</p>${reasonHtml}`),
      text: `Your expense claim of ${amtStr} has been returned. Please review and resubmit it.${reason ? `\nReason: ${reason}` : ""}`,
    });
  }

  const recipients = await notificationRecipients("expense_decided");
  if (!recipients.length) return;
  const who = ownerEmail || "A staff member";
  await sendEmail({
    to: recipients,
    subject: `Expense claim ${outcome} — ${amtStr}`,
    html: notificationEmailHtml("Expenses", `<p style="margin:0;font-size:15px;color:#262830;">The expense claim of <strong>${amtStr}</strong> from <strong>${escapeHtml(who)}</strong> has been <strong>${outcome}</strong>.</p>${reasonHtml}`),
    text: `The expense claim of ${amtStr} from ${who} has been ${outcome}.${outcome === "rejected" && reason ? `\nReason: ${reason}` : ""}`,
  });
}

module.exports = {
  getReminderSettings, getReminderState, setReminderState, reminderEmailHtml,
  computeReminderRecipients, sendReminderEmails, runTimesheetReminders, reminderTick,
  getHrReportSettings, getHrReportState, setHrReportState, hrProjectLabel, hrToHours,
  gatherHrReportData, runHrReport, hrReportTick, formatWeekRange, notifyClaimDecision,
};
