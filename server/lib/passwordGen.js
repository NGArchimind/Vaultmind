// Admin-set password generator: two construction words joined, with letter→number
// swaps so there's always a digit. All lowercase (matches the "br1ckdu5t" style).
const WORDS = [
  "brick", "dust", "mortar", "trowel", "gravel", "cement", "rafter", "joist",
  "scaffold", "timber", "render", "granite", "lintel", "slate", "copper",
  "plaster", "gable", "soffit", "fascia", "screed", "batten", "purlin",
  "coping", "ledger", "mullion", "parapet", "quoin", "reveal", "stud", "beam",
];
const SWAPS = { i: "1", s: "5", o: "0", e: "3", a: "4" };

function leet(s) {
  return String(s).toLowerCase().replace(/[isoea]/g, c => SWAPS[c]);
}

function generatePassword(rand = Math.random) {
  const pick = () => WORDS[Math.floor(rand() * WORDS.length)];
  const a = pick();
  let b = pick();
  let guard = 0;
  while (b === a && guard++ < 20) b = pick();
  let pw = leet(a + b);
  if (!/[0-9]/.test(pw)) pw += String(Math.floor(rand() * 10)); // guarantee a digit
  return pw;
}

module.exports = { generatePassword, leet, WORDS };
