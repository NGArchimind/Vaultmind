// Module-level toast dispatcher. ProjectsSection registers the real handler on
// mount via setToastHandler(); all project sub-components call showToast()
// without prop-drilling. Extracted verbatim from ProjectsSection.jsx.
let _showToast = (text) => console.warn("[toast]", text);

export function showToast(text) { _showToast(text); }

export function setToastHandler(fn) { _showToast = fn; }
