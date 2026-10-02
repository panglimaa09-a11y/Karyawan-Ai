import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/credentials";
export const runtime="nodejs";
export async function POST(_req:Request,{params}:{params:Promise<{id:string}>}) {
 try {
  const {id}=await params, p=await prisma.provider.findUnique({where:{id}});
  if(!p) return NextResponse.json({error:"Provider tidak ditemukan."},{status:404});
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
  try {
   const headers={Authorization:"Bearer "+decryptSecret(p), "Content-Type":"application/json"};
   const endpoint=p.apiFormat==="openai-responses"?p.baseUrl+"/responses":p.baseUrl+"/chat/completions";
   const response=await fetch(p.apiFormat==="openai-responses"?p.baseUrl+"/models":p.baseUrl+"/models",{headers,signal:controller.signal,cache:"no-store"});
   const text=await response.text();
   if(!response.ok) return NextResponse.json({ok:false,status:response.status,error:"Provider menolak koneksi ("+response.status+").",detail:text.slice(0,500)},{status:200});
   let models:string[]=[];
   try { const data=JSON.parse(text); models=(data.data||data.models||[]).map((m:{id?:string;name?:string})=>m.id||m.name).filter(Boolean); } catch {}
   if(models.length) await prisma.$transaction(models.map(modelId=>prisma.providerModel.upsert({where:{providerId_modelId:{providerId:id,modelId}},create:{providerId:id,modelId},update:{available:true}})));
   await prisma.auditLog.create({data:{action:"provider.test.success",entityType:"provider",entityId:id,detail:{modelsFound:models.length}}});
   return NextResponse.json({ok:true,status:response.status,message:"Koneksi berhasil.",models});
  } finally {clearTimeout(timer);}
 } catch(e) { return NextResponse.json({ok:false,error:e instanceof Error?(e.name==="AbortError"?"Koneksi timeout setelah 15 detik.":e.message):"Koneksi gagal."},{status:200}); }
}
