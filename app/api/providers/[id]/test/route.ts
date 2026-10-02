import { NextResponse } from "next/server";
import { getPool, requireAdmin } from "@/lib/server/db";
import { decryptSecret } from "@/lib/server/crypto";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
 try {
  requireAdmin(request); const { id } = await context.params; const pool = getPool();
  const result = await pool.query("SELECT p.base_url,p.api_format,p.default_model,c.encrypted_token FROM providers p JOIN provider_credentials c ON c.provider_id=p.id WHERE p.id=$1 AND p.enabled=true",[id]);
  if (!result.rowCount) return NextResponse.json({ error: "Provider tidak ditemukan, tidak aktif, atau token belum tersimpan." },{status:404});
  const p=result.rows[0], token=decryptSecret(p.encrypted_token);
  const endpoint=p.api_format==="openai-responses" ? "/responses" : "/chat/completions";
  const response=await fetch(p.base_url.replace(/\/$/,"")+endpoint,{method:"POST",headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(p.api_format==="openai-responses"?{model:p.default_model||"gpt-4.1-mini",input:"Balas hanya: KARYAWAN_AI_CONNECTION_OK"}:{model:p.default_model||"gpt-4o-mini",messages:[{role:"user",content:"Balas hanya: KARYAWAN_AI_CONNECTION_OK"}],max_tokens:20}),signal:AbortSignal.timeout(15000)});
  const raw=await response.text();
  await pool.query("INSERT INTO usage_records(provider_id,model_id,status,error_code,duration_ms) VALUES($1,$2,$3,$4,$5)",[id,p.default_model,response.ok?"success":"error",response.ok?null:`HTTP_${response.status}`,null]);
  return NextResponse.json({ok:response.ok,status:response.status,message:response.ok?"Koneksi dan autentikasi berhasil.":"Provider menolak permintaan.",details:response.ok?undefined:raw.slice(0,500)},{status:response.ok?200:502});
 } catch(e) { const message=e instanceof Error?e.message:"Internal error"; return NextResponse.json({error:message},{status:message==="UNAUTHORIZED"?401:503}); }
}
