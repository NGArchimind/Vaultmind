// Global product library — upload/list/get/update/delete product PDFs. Verbatim.
const express = require("express");
const { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { requireAuth } = require("../middleware/auth");
const { supabase, r2, BUCKET } = require("../helpers/clients");
const { streamToBuffer } = require("../helpers/r2");
const { serverError } = require("../helpers/serverError");

const router = express.Router();

// ── Product Library routes ────────────────────────────────────────────────────

router.post("/api/products/upload-pdf", requireAuth, async (req, res) => {
  const { base64, filename } = req.body;
  if (!base64 || !filename) return res.status(400).json({ error: "base64 and filename required" });

  const buffer = Buffer.from(base64, "base64");
  const key = `products/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  try {
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: "application/pdf",
    }));
    res.json({ key });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.get("/api/products", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("id, created_at, name, manufacturer, file_key, product_type")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ products: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.get("/api/products/:id", requireAuth, async (req, res) => {
  try {
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (productError) throw productError;

    const { data: attributes, error: attrError } = await supabase
      .from("product_attributes")
      .select("*")
      .eq("product_id", req.params.id)
      .order("attribute");
    if (attrError) throw attrError;

    res.json({ product, attributes });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.patch("/api/products/:id", requireAuth, async (req, res) => {
  const { product_type } = req.body;
  try {
    const { data, error } = await supabase
      .from("products")
      .update({ product_type })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ product: data });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.post("/api/products", requireAuth, async (req, res) => {
  const { name, manufacturer, file_key, raw_text, product_type, attributes = [] } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });

  try {
    const { data: product, error: productError } = await supabase
      .from("products")
      .insert({ name, manufacturer, file_key, raw_text, product_type })
      .select()
      .single();
    if (productError) throw productError;

    if (attributes.length > 0) {
      const rows = attributes.map(a => ({ product_id: product.id, attribute: a.attribute, value: a.value, unit: a.unit || null }));
      const { error: attrError } = await supabase.from("product_attributes").insert(rows);
      if (attrError) throw attrError;
    }

    res.json({ product });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.get("/api/products/:id/pdf", requireAuth, async (req, res) => {
  try {
    const { data: product, error } = await supabase
      .from("products")
      .select("file_key, name")
      .eq("id", req.params.id)
      .single();
    if (error) throw error;
    if (!product.file_key) return res.status(404).json({ error: "No PDF stored for this product" });

    const result = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: product.file_key }));
    const buffer = await streamToBuffer(result.Body);
    res.json({ base64: buffer.toString("base64"), name: product.name });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

router.delete("/api/products/:id", requireAuth, async (req, res) => {
  try {
    const { data: product, error: fetchError } = await supabase
      .from("products")
      .select("file_key")
      .eq("id", req.params.id)
      .single();
    if (fetchError) throw fetchError;

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;

    if (product.file_key && product.file_key.startsWith("products/")) {
      try {
        await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: product.file_key }));
      } catch (_) {}
    }

    res.json({ deleted: true });
  } catch (err) {
    return serverError(res, err, req.path);
  }
});

module.exports = router;
