import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
 const value = process.env.KAI_ENCRYPTION_KEY;
 if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new Error("KAI_ENCRYPTION_KEY harus berupa 64 karakter hex (32 byte).");
 return Buffer.from(value, "hex");
}
export function encryptSecret(value: string): string {
 const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv);
 const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
 return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}
export function decryptSecret(value: string): string {
 const [iv, tag, data] = value.split(".");
 if (!iv || !tag || !data) throw new Error("Format kredensial terenkripsi tidak valid.");
 const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
 decipher.setAuthTag(Buffer.from(tag, "base64"));
 return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
