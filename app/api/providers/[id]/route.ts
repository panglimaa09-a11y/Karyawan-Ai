import { NextRequest,NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/credentials";
export const runtime="nodejs";
export async function PATCH(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
 try {
  const {id}=await params, body=await req.json();
  const data:Record<string,unknown>={};
  if(typeof body.name==="string") data.name=body.name.trim();
  if(typeof body.baseUrl==="string") data.baseUrl=body.baseUrl.replace(/\/+$/,"");
  if(typeof body.defaultModel==="string"||body.defaultModel===null) data.defaultModel=body.defaultModel;
  if(typeof body.enabled==="boolean") data.enabled=body.enabled;
  if(typeof body.apiKey==="string"&&body.apiKey.trim()) Object.assign(data,encryptSecret(body.apiKey.trim()));
  const p=await prisma.provider.update({where:{id},data,select:{id:true,name:true,baseUrl:true,apiFormat:true,defaultModel:true,enabled:true}});
  await prisma.auditLog.create({data:{action:"provider.updated",entityType:"provider",entityId:id}});
  return NextResponse.json({provider:{...p,hasCredential:true}});
 } catch { return NextResponse.json({error:"Provider tidak ditemukan atau perubahan gagal."},{status:400}); }
}
export async function DELETE(_req:NextRequest,{params}:{params:Promise<{id:string}>}) {
 try { const {id}=await params; await prisma.provider.delete({where:{id}}); await prisma.auditLog.create({data:{action:"provider.deleted",entityType:"provider",entityId:id}}); return NextResponse.json({ok:true}); }
 catch { return NextResponse.json({error:"Provider tidak ditemukan atau gagal dihapus."},{status:404}); }
}
