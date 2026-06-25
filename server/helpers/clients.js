// Shared external-service clients — created once here and imported everywhere
// else, so the whole server uses a single Supabase / R2 connection.
const { S3Client } = require("@aws-sdk/client-s3");
const { createClient } = require("@supabase/supabase-js");

// ── R2 client ─────────────────────────────────────────────────────────────────
const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET || "archimind-docs";

// ── Supabase client ───────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = { r2, BUCKET, supabase };
