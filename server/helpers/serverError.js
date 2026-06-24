// Safe error helper — logs detail server-side, returns a generic message to the
// client so internal error text never leaks to the browser.
function serverError(res, err, context) {
  console.error(`[${context}]`, err.message || err);
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}

module.exports = { serverError };
