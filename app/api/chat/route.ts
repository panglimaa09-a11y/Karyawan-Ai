import { NextRequest,NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/credentials";
export const runtime="nodejs";
export async function POST(req:NextRequest) {
 try {
  const body=await req.json();
  const message=String(body.message||"").trim(), employeeId=String(body.employeeId||"");
  if(!message) return NextResponse.json({error:"Pesan tidak boleh kosong."},{status:400});
  if(message.length>30000) return NextResponse.json({error:"Pesan terlalu panjang (maksimum 30.000 karakter)."},{status:413});
  const employee=await prisma.employee.findUnique({where:{id:employeeId},include:{provider:true}});
  if(!employee||!employee.enabled) return NextResponse.json({error:"Karyawan tidak ditemukan atau dinonaktifkan."},{status:404});
  if(!employee.provider||!employee.provider.enabled) return NextResponse.json({error:"Pilih provider aktif untuk karyawan ini terlebih dahulu."},{status:400});
  const model=String(body.modelId||employee.modelId||employee.provider.defaultModel||"");
  if(!model) return NextResponse.json({error:"Pilih model untuk karyawan ini."},{status:400});
  const provider=employee.provider, credential=decryptSecret(provider);
  const conversationId=typeof body.conversationId==="string"&&body.conversationId?body.conversationId:undefined;
  const conversation=conversationId?await prisma.conversation.findUnique({where:{id:conversationId}}):await prisma.conversation.create({data:{title:message.slice(0,80),kind:"direct"}});
  if(!conversation) return NextResponse.json({error:"Percakapan tidak ditemukan."},{status:404});
  const history=await prisma.message.findMany({where:{conversationId:conversation.id},orderBy:{createdAt:"asc"},take:30});
  await prisma.message.create({data:{conversationId:conversation.id,employeeId:employee.id,providerId:provider.id,role:"user",content:message}});
  const messages=[{role:"system",content:employee.systemPrompt||("Kamu adalah "+employee.name+", "+employee.role+". Kepribadian: "+employee.personality+". Bekerjalah secara jujur; jangan mengaku menjalankan tool yang tidak tersedia.")},...history.map(m=>({role:m.role as "user"|"assistant",content:m.content})),{role:"user" as const,content:message}];
  const endpoint=provider.apiFormat==="openai-responses"?provider.baseUrl+"/responses":provider.baseUrl+"/chat/completions";
  const payload=provider.apiFormat==="openai-responses"?{model,input:messages.map(m=>({role:m.role,content:[{type:"input_text",text:m.content}]})),max_output_tokens:2048}:{model,messages,max_tokens:2048,stream:false};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
  let response:Response;
  try { response=await fetch(endpoint,{method:"POST",headers:{"Authorization":"Bearer "+credential,"Content-Type":"application/json"},body:JSON.stringify(payload),signal:controller.signal,cache:"no-store"}); }
  finally {clearTimeout(timer);}
  const raw=await response.text();
  if(!response.ok) return NextResponse.json({error:"Provider API error "+response.status,detail:raw.slice(0,800),conversationId:conversation.id},{status:502});
  const data=JSON.parse(raw), answer=provider.apiFormat==="openai-responses"?(data.output_text||data.output?.flatMap((o:{content?:{text?:string}[]})=>o.content||[]).map((c:{text?:string})=>c.text||"").join("")||""):(data.choices?.[0]?.message?.content||"");
  if(!answer) return NextResponse.json({error:"Provider mengembalikan respons kosong.",conversationId:conversation.id},{status:502});
  const usage=data.usage||{};
  const saved=await prisma.message.create({data:{conversationId:conversation.id,employeeId:employee.id,providerId:provider.id,role:"assistant",content:answer,modelId:model,promptTokens:usage.prompt_tokens??usage.input_tokens,completionTokens:usage.completion_tokens??usage.output_tokens}});
  await prisma.auditLog.create({data:{action:"agent.response",entityType:"message",entityId:saved.id,detail:{employeeId,providerId:provider.id,modelId:model}}});
  return NextResponse.json({ok:true,answer,conversationId:conversation.id,messageId:saved.id,employee:{id:employee.id,name:employee.name},provider:{id:provider.id,name:provider.name},model,usage:{promptTokens:usage.prompt_tokens??usage.input_tokens??null,completionTokens:usage.completion_tokens??usage.output_tokens??null,totalTokens:usage.total_tokens??null}});
 } catch(e) { return NextResponse.json({error:e instanceof Error?(e.name==="AbortError"?"Permintaan AI timeout.":e.message):"Permintaan gagal."},{status:500}); }
}
