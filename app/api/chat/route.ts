import { NextResponse } from "next/server";
import { getPool, requireAdmin } from "@/lib/server/db";
import { decryptSecret } from "@/lib/server/crypto";
export const runtime = "nodejs";
export async function POST(request: Request) {
 const started=Date.now();
 try {
  requireAdmin(request);
  const body=await request.json(); const employeeId=String(body.employeeId||"raka"), message=String(body.message||"").trim(), conversationId=body.conversationId?String(body.conversationId):null;
  if(!message) return NextResponse.json({error:"Pesan tidak boleh kosong."},{status:400});
  if(message.length>20000) return NextResponse.json({error:"Pesan melebihi batas 20.000 karakter."},{status:413});
  const pool=getPool();
  const employee=await pool.query("SELECT e.*,p.id AS pid,p.base_url,p.api_format,COALESCE(e.model_id,p.default_model) AS selected_model,c.encrypted_token FROM employees e LEFT JOIN providers p ON p.id=e.provider_id AND p.enabled=true LEFT JOIN provider_credentials c ON c.provider_id=p.id WHERE e.id=$1 AND e.enabled=true",[employeeId]);
  if(!employee.rowCount) return NextResponse.json({error:"Karyawan tidak ditemukan atau nonaktif."},{status:404});
  const e=employee.rows[0]; if(!e.pid || !e.encrypted_token || !e.selected_model) return NextResponse.json({error:"Karyawan belum memiliki provider, token tersimpan, dan model. Atur koneksi terlebih dahulu."},{status:409});
  const token=decryptSecret(e.encrypted_token);
  let conv=conversationId;
  if(conv) { const exists=await pool.query("SELECT id FROM conversations WHERE id=$1 AND employee_id=$2",[conv,employeeId]); if(!exists.rowCount)return NextResponse.json({error:"Percakapan tidak ditemukan."},{status:404}); }
  else { const created=await pool.query("INSERT INTO conversations(employee_id,title) VALUES($1,$2) RETURNING id",[employeeId,message.slice(0,80)]); conv=created.rows[0].id; }
  await pool.query("INSERT INTO messages(conversation_id,role,employee_id,content) VALUES($1,'user',$2,$3)",[conv,employeeId,message]);
  await pool.query("INSERT INTO office_events(employee_id,event_type,status,message,metadata) VALUES($1,'chat_started','working',$2,$3::jsonb)",[employeeId,e.name+" mulai memproses pesan.",JSON.stringify({conversationId:conv,model:e.selected_model})]);
  const history=await pool.query("SELECT role,content FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 20",[conv]);
  const messages=[{role:"system",content:e.system_prompt+" Kepribadian: "+e.personality+". Jangan mengklaim tool atau tindakan yang belum dijalankan. Minta persetujuan Bos Angga untuk tindakan penting."},...history.rows.reverse().map((m:{role:string;content:string})=>({role:m.role,content:m.content}))];
  const url=e.base_url.replace(/\/$/,"")+(e.api_format==="openai-responses"?"/responses":"/chat/completions");
  const payload=e.api_format==="openai-responses"?{model:e.selected_model,input:messages.map(m=>({role:m.role,content:m.content}))}:{model:e.selected_model,messages,stream:false};
  const resp=await fetch(url,{method:"POST",headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});
  const raw=await resp.text(); let data:any; try{data=JSON.parse(raw)}catch{data={error:{message:raw.slice(0,500)}}}
  if(!resp.ok){await pool.query("INSERT INTO usage_records(provider_id,employee_id,model_id,status,error_code,duration_ms) VALUES($1,$2,$3,'error',$4,$5)",[e.pid,employeeId,e.selected_model,`HTTP_${resp.status}`,Date.now()-started]);return NextResponse.json({error:data.error?.message||`Provider error HTTP ${resp.status}`},{status:502});}
  const answer=e.api_format==="openai-responses"?(data.output_text||data.output?.flatMap((x:any)=>x.content||[]).map((x:any)=>x.text||"").join("")||""):(data.choices?.[0]?.message?.content||"");
  if(!answer) return NextResponse.json({error:"Provider merespons tetapi tidak memberikan teks yang dikenali."},{status:502});
  const usage=data.usage||{}; await pool.query("INSERT INTO messages(conversation_id,role,employee_id,content,model_id,prompt_tokens,completion_tokens) VALUES($1,'assistant',$2,$3,$4,$5,$6)",[conv,employeeId,answer,e.selected_model,usage.prompt_tokens??usage.input_tokens??null,usage.completion_tokens??usage.output_tokens??null]);
  await pool.query("UPDATE conversations SET updated_at=now() WHERE id=$1",[conv]);
  await pool.query("INSERT INTO office_events(employee_id,event_type,status,message,metadata) VALUES($1,'chat_completed','completed',$2,$3::jsonb)",[employeeId,e.name+" menyelesaikan respons.",JSON.stringify({conversationId:conv,model:e.selected_model})]);
  await pool.query("INSERT INTO usage_records(provider_id,employee_id,model_id,prompt_tokens,completion_tokens,status,duration_ms) VALUES($1,$2,$3,$4,$5,'success',$6)",[e.pid,employeeId,e.selected_model,usage.prompt_tokens??usage.input_tokens??null,usage.completion_tokens??usage.output_tokens??null,Date.now()-started]);
  return NextResponse.json({conversationId:conv,employee:{id:e.id,name:e.name,role:e.role},model:e.selected_model,answer,usage:{prompt_tokens:usage.prompt_tokens??usage.input_tokens??null,completion_tokens:usage.completion_tokens??usage.output_tokens??null}});
 } catch(err){const message=err instanceof Error?err.message:"Internal error";return NextResponse.json({error:message},{status:message==="UNAUTHORIZED"?401:503});}
}
