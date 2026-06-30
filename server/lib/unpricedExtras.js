// "Unpriced extra" line validation.
//
// A timesheet line that is ticked as an unpriced extra (unpriced_extra = true)
// MUST have an extra-type chosen (extra_type_id set). This mirrors the daily-cap
// gate in timesheetValidation.js: the client blocks Submit and the server rejects.
//
// Returns the offending entries — those flagged as an extra but with no type.
function extrasMissingType(entries) {
  return (entries || []).filter(e => e && e.unpriced_extra && !e.extra_type_id);
}

module.exports = { extrasMissingType };
