// Cloudflare R2 (S3-compatible) storage helpers — shared by vaults, projects,
// drawings and transmittals.
const {
  ListObjectsV2Command,
  DeleteObjectCommand,
  CopyObjectCommand,
} = require("@aws-sdk/client-s3");
const { r2, BUCKET } = require("./clients");

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// List all keys under a prefix (handles pagination)
async function listAllKeys(prefix) {
  const keys = [];
  let continuationToken;
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    const result = await r2.send(cmd);
    (result.Contents || []).forEach(o => keys.push(o.Key));
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

// Copy all objects from one prefix to another, then delete originals
async function movePrefix(fromPrefix, toPrefix) {
  const keys = await listAllKeys(fromPrefix);
  for (const key of keys) {
    const newKey = toPrefix + key.slice(fromPrefix.length);
    await r2.send(new CopyObjectCommand({
      Bucket: BUCKET,
      CopySource: `${BUCKET}/${key}`,
      Key: newKey,
    }));
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  }
}

// Delete all objects under a prefix
async function deletePrefix(prefix) {
  const keys = await listAllKeys(prefix);
  for (const key of keys) {
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  }
}

module.exports = { streamToBuffer, listAllKeys, movePrefix, deletePrefix };
