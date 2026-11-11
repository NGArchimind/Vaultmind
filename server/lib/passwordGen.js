// Admin-set password generator: one construction word with a single capital letter
// in a random position, followed by a 2-digit number (e.g. "scAffold47", "Mortar82").
// Kept simple so staff can remember it; the large word list + random capital + number
// keeps the number of possible passwords high (~200 words × ~7 positions × 90 numbers).
const WORDS = [
  // materials
  "brick", "mortar", "cement", "concrete", "timber", "gravel", "granite", "slate",
  "copper", "plaster", "render", "screed", "marble", "stone", "steel", "glass",
  "sand", "chalk", "clay", "flint", "lime", "zinc", "lead", "bronze", "iron",
  "basalt", "pebble", "cobble", "shingle", "rubble", "aggregate", "asphalt",
  "bitumen", "plywood", "oak", "cedar", "larch", "birch", "walnut", "maple",
  "pine", "spruce", "bamboo", "cork", "felt", "thatch", "terrazzo", "ceramic",
  "porcelain", "quartz", "sandstone", "limestone", "brass", "chrome", "pewter",
  "gypsum", "resin", "putty", "grout", "mastic", "varnish", "primer", "paint",
  // structure
  "rafter", "joist", "lintel", "beam", "column", "girder", "truss", "purlin",
  "batten", "stud", "footing", "pier", "pillar", "arch", "vault", "dome",
  "keystone", "buttress", "bracket", "corbel", "plinth", "frame", "brace",
  "strut", "ridge", "eaves", "gable", "parapet", "coping", "soffit", "gutter",
  "chimney", "flue", "hearth", "lantern", "skylight", "dormer", "turret",
  "spire", "tower", "cupola", "canopy", "awning", "balcony", "terrace",
  "veranda", "porch", "portico", "cloister", "atrium", "courtyard", "gallery",
  "landing", "stair", "banister", "handrail", "baluster", "newel", "tread",
  "riser", "doorway", "window", "shutter", "sill", "mullion", "transom",
  "casement", "louvre", "hinge", "latch", "bolt", "rivet", "screw", "nail",
  "anchor", "ledger", "sleeper", "decking", "panel", "partition", "ceiling",
  "floor", "wall", "roof", "cladding", "facade", "plaza", "pavilion",
  // tools and site
  "trowel", "hammer", "chisel", "spirit", "plumb", "mallet", "spanner",
  "wrench", "ladder", "scaffold", "hoist", "crane", "digger", "barrow",
  "bucket", "shovel", "spade", "pickaxe", "drill", "sander", "saw", "plane",
  "clamp", "vice", "level", "compass", "ruler", "tape", "pencil", "sketch",
  "drawing", "section", "plan", "elevation", "detail", "model", "survey",
  "datum", "grid", "axis", "module", "sketchbook", "blueprint", "tracing",
  // places and buildings
  "cottage", "manor", "villa", "chapel", "abbey", "castle", "bridge",
  "harbour", "quay", "wharf", "mill", "granary", "barn", "stable", "lodge",
  "studio", "library", "museum", "theatre", "station", "market", "arcade",
  "garden", "orchard", "meadow", "village", "hamlet", "avenue", "crescent",
  "square", "mews", "terraced", "townhouse", "warehouse", "workshop",
];

// Words of 5–9 letters only: easy to type, and long enough that word + 2 digits
// always clears the 6-character auth minimum.
const USABLE = [...new Set(WORDS)].filter(w => /^[a-z]{5,9}$/.test(w));

// Positions we may capitalise: anything except "i" — a capital "I" looks like a
// lowercase "l" in many fonts ("pIaster" vs "plaster").
function capitalisablePositions(word) {
  const out = [];
  for (let i = 0; i < word.length; i++) if (word[i] !== "i") out.push(i);
  return out;
}

function generatePassword(rand = Math.random) {
  const word = USABLE[Math.floor(rand() * USABLE.length)];
  const positions = capitalisablePositions(word);
  const pos = positions[Math.floor(rand() * positions.length)];
  const cased = word.slice(0, pos) + word[pos].toUpperCase() + word.slice(pos + 1);
  const num = 10 + Math.floor(rand() * 90); // 10–99, never a leading zero
  return cased + num;
}

module.exports = { generatePassword, capitalisablePositions, WORDS: USABLE };
