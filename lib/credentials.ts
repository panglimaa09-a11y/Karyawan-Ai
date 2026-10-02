import crypto from "node:crypto";
const algorithm = "aes-256-gcm";
function key() {
  const secret = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY wajib diisi (minimal 32 karakter).");
  return crypto.createHash("sha256").update(secret).digest();
}
export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { encryptedKey: encrypted.toString("base64"), keyIv: iv.toString("base64"), keyTag: cipher.getAuthTag().toString("base64") };
}
export function decryptSecret(record: { encryptedKey: string; keyIv: string; keyTag: string }) {
  const decipher = crypto.createDecipheriv(algorithm, key(), Buffer.from(record.keyIv, "base64"));
  decipher.setAuthTag(Buffer.from(record.keyTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(record.encryptedKey, "base64")), decipher.final()]).toString("utf8");
}
