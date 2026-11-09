// Staff leavers — closing an account once its leaving date has passed.
// Closing = (1) auto-submit the leaving week if it isn't already submitted/approved,
// notifying admin/HR, then (2) ban the login and stamp leaver_closed_at. The stamp
// is written LAST so a crash part-way means the next tick simply retries; step 1
// re-checks the submission status first, so it never double-submits or re-emails.
const { supabase } = require("./clients");
const { sendEmail, escapeHtml, notificationEmailHtml, notificationRecipients } = require("./email");
const { formatWeekRange } = require("./schedulers");
const reminderLib = require("../lib/timesheetReminder");
const { leavingWeek, needsClosing } = require("../lib/leavers");

const BAN_FOREVER = "876000h"; // ~100 years

function formatDate(iso) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

async function closeLeaverAccount(user) {
  const leftAt = user.app_metadata?.left_at;
  if (!leftAt) return { autoSubmittedWeek: null };
  const week = leavingWeek(leftAt);
  let autoSubmittedWeek = null;

  const { data: existing } = await supabase
    .from("timesheet_submissions").select("status")
    .eq("user_id", user.id).eq("week_start", week).maybeSingle();
  if (existing?.status !== "submitted" && existing?.status !== "approved") {
    const { error } = await supabase.from("timesheet_submissions").upsert(
      { user_id: user.id, week_start: week, status: "submitted", submitted_at: new Date().toISOString(), rejection_reason: null },
      { onConflict: "user_id,week_start" }
    );
    if (error) throw error;
    autoSubmittedWeek = week;

    const recipients = await notificationRecipients("timesheet_submitted");
    if (recipients.length) {
      const who = user.email || "A staff member";
      const msg = `${who}'s account closed after their leaving date (${formatDate(leftAt)}). Their final timesheet for ${formatWeekRange(week)} was not submitted, so it has been submitted automatically with whatever was entered. Please review it.`;
      await sendEmail({
        to: recipients,
        subject: `Final timesheet auto-submitted — ${who}`,
        html: notificationEmailHtml("Timesheets", `<p style="margin:0;font-size:15px;color:#262830;">${escapeHtml(msg)}</p>`),
        text: msg,
      });
    }
  }

  const { error: banErr } = await supabase.auth.admin.updateUserById(user.id, {
    ban_duration: BAN_FOREVER,
    app_metadata: { leaver_closed_at: new Date().toISOString() },
  });
  if (banErr) throw banErr;
  return { autoSubmittedWeek };
}

// 15-minute ticker: close every account whose leaving date has passed.
async function leaverTick() {
  try {
    const today = reminderLib.ukParts(new Date()).dateStr;
    const { data } = await supabase.auth.admin.listUsers();
    for (const u of data?.users || []) {
      if (!needsClosing(u.app_metadata, today)) continue;
      try {
        const { autoSubmittedWeek } = await closeLeaverAccount(u);
        console.log(`[Leavers] closed ${u.email}${autoSubmittedWeek ? ` (auto-submitted week ${autoSubmittedWeek})` : ""}`);
      } catch (e) {
        console.error(`[Leavers] failed to close ${u.email}:`, e.message);
      }
    }
  } catch (e) {
    console.error("[Leavers] tick failed:", e.message);
  }
}

module.exports = { closeLeaverAccount, leaverTick, BAN_FOREVER };
