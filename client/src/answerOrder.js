// The Pass-3 answer model writes the Summary LAST (evidence first, verdict last),
// so the Summary is reasoned from the cited clauses rather than committed to up
// front. This moves the "## Summary" section back to the top for display, history,
// sharing and follow-up context. If no Summary heading is found the text is
// returned unchanged — the answer is never lost or garbled.
const SUMMARY_HEADING = /^##[ \t]*\**[ \t]*Summary[ \t]*\**[ \t]*$/im;
const NEXT_H2 = /^##[ \t]+\S/m;

export function moveSummaryToTop(text) {
  if (typeof text !== "string") return text;
  const match = SUMMARY_HEADING.exec(text);
  if (!match || match.index === 0) return text;

  const start = match.index;
  const afterHeading = start + match[0].length;
  const nextRel = text.slice(afterHeading).search(NEXT_H2);
  const end = nextRel === -1 ? text.length : afterHeading + nextRel;

  const summary = text.slice(start, end).trim();
  const rest = (text.slice(0, start) + text.slice(end)).trim();
  return `${summary}\n\n${rest}`;
}
