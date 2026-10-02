import { NextResponse } from "next/server";
import { getPool, requireAdmin } from "@/lib/server/db";
import { encryptSecret } from "@/lib/server/crypto";

export const runtime = "nodejs";
export async function GET(request: Request) {
 try { requireAdmin(request); const { rows } = await getPool().query("SELECT p.id,p.name,p.base_url,p.api_format,p.default_model,p.enabled,p.created_at,p.updated_at,(c.provider_id IS NOT NULL) AS has_token FROM providers p LEFT JOIN provider_credentials c ON c.provider_id=p.id ORDER BY p.created_at");
 return NextResponse.json({ providers: rows }); }
 catch (e) { const message = e instanceof Error ? e.message : "Internal error"; return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 503 }); }
}
export async function POST(request: Request) {
 try {
  requireAdmin(request);
  const body = await request.json();
  const name = String(body.name ?? "").trim(), baseUrl = String(body.baseUrl ?? "").trim(), token = String(body.token ?? "").trim();
  const apiFormat = String(body.apiFormat ?? "openai-chat"), model = String(body.defaultModel ?? "").trim() || null;
  if (!name || !baseUrl || !/^https?:\/\//i.test(baseUrl)) return NextResponse.json({ error: "Nama dan Base URL HTTP(S) wajib diisi." }, { status: 400 });
  if (!["openai-chat","openai-responses"].includes(apiFormat)) return NextResponse.json({ error: "Format API belum didukung oleh adapter ini." }, { status: 400 });
  if (!token) return NextResponse.json({ error: "Token wajib diisi saat membuat provider." }, { status: 400 });
  const pool = getPool(); const client = await pool.connect();
  try {
   await client.query("BEGIN");
   const inserted = await client.query("INSERT INTO providers(name,base_url,api_format,default_model) VALUES($1,$2,$3,$4) RETURNING id,name,base_url,api_format,default_model,enabled", [name,baseUrl.replace(/\/$/, ""),apiFormat,model]);
   await client.query("INSERT INTO provider_credentials(provider_id,encrypted_token) VALUES($1,$2)", [inserted.rows[0].id,encryptSecret(token)]);
   await client.query("COMMIT");
   return NextResponse.json({ provider: { ...inserted.rows[0], has_token: true } }, { status: 201 });
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
 } catch (e) { const message = e instanceof Error ? e.message : "Internal error"; return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 503 }); }
}
