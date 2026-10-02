import { NextResponse } from "next/server";
import { getPool, requireAdmin } from "@/lib/server/db";
import { decryptSecret } from "@/lib/server/crypto";
export const runtime="nodejs";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{
  requireAdmin(request);const {id}=await context.params;const pool=getPool();
  const q=await pool.query("SELECT p.base_url,c.encrypted_token FROM providers p JOIN provider_credentials c ON c.provider_id=p.id WHERE p.id=$1 AND p.enabled=true",[id]);
  if(!q.rowCount)return NextResponse.json({error:"Provider tidak ditemukan atau tidak aktif."},{status:404});
  const p=q.rows[0];const resp=await fetch(p.base_url.replace(/\/$/,"")+"/models",{headers:{Authorization:`Bearer ${decryptSecret(p.encrypted_token)}`},signal:AbortSignal.timeout(15000)});
  const raw=await resp.text();let data:any;try{data=JSON.parse(raw)}catch{data={}};
  if(!resp.ok)return NextResponse.json({error:`Provider menolak permintaan daftar model (HTTP ${resp.status}).`,details:raw.slice(0,300)},{status:502});
  const models=Array.isArray(data.data)?data.data.filter((m:any)=>typeof m.id==="string").map((m:any)=>({id:m.id,name:typeof m.name==="string"?m.name:m.id})):Array.isArray(data.models)?data.models.map((m:any)=>({id:typeof m==="string"?m:m.id,name:typeof m==="string"?m:m.id})).filter((m:any)=>typeof m.id==="string"):[];
  if(!models.length)return NextResponse.json({error:"Endpoint berhasil tetapi format daftar model tidak dikenali.",models:[]},{status:502});
  const client=await pool.connect();try{await client.query("BEGIN");for(const m of models)await client.query("INSERT INTO provider_models(provider_id,model_id,display_name) VALUES($1,$2,$3) ON CONFLICT(provider_id,model_id) DO UPDATE SET display_name=EXCLUDED.display_name,discovered_at=now()",[id,m.id,m.name]);await client.query("COMMIT");}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  return NextResponse.json({count:models.length,models});
 }catch(e){const message=e instanceof Error?e.message:"Internal error";return NextResponse.json({error:message},{status:message==="UNAUTHORIZED"?401:503});}
}
