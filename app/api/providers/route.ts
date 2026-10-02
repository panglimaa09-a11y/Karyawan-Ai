import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/credentials";
export const runtime = "nodejs";
function safe(p: {id:string;name:string;baseUrl:string;apiFormat:string;defaultModel:string|null;enabled:boolean;createdAt:Date;models:{modelId:string;available:boolean}[]}) {
  return { id:p.id,name:p.name,baseUrl:p.baseUrl,apiFormat:p.apiFormat,defaultModel:p.defaultModel,enabled:p.enabled,createdAt:p.createdAt,models:p.models,hasCredential:true };
}
export async function GET() {
  try { const providers=await prisma.provider.findMany({include:{models:true},orderBy:{createdAt:"asc"}}); return NextResponse.json({providers:providers.map(safe)}); }
  catch(e) { return NextResponse.json({error:"Database belum siap. Jalankan migrasi Prisma dan isi DATABASE_URL.",detail:process.env.NODE_ENV==="development"?String(e):undefined},{status:503}); }
}
export async function POST(req:NextRequest) {
  try {
    const body=await req.json();
    const name=String(body.name||"").trim(), baseUrl=String(body.baseUrl||"").trim(), apiKey=String(body.apiKey||"").trim();
    if(!name||!baseUrl||!apiKey) return NextResponse.json({error:"Nama provider, Base URL, dan API key wajib diisi."},{status:400});
    const url=new URL(baseUrl);
    if(!["http:","https:"].includes(url.protocol)) return NextResponse.json({error:"Base URL harus HTTP atau HTTPS."},{status:400});
    if(url.protocol==="http:" && !["localhost","127.0.0.1","::1"].includes(url.hostname)) return NextResponse.json({error:"HTTP hanya diizinkan untuk localhost. Gunakan HTTPS untuk host lain."},{status:400});
    const secret=encryptSecret(apiKey);
    const p=await prisma.provider.create({data:{name,baseUrl:baseUrl.replace(/\/+$/,""),apiFormat:body.apiFormat==="openai-responses"?"openai-responses":"openai-chat",defaultModel:body.defaultModel||null,...secret}});
    await prisma.auditLog.create({data:{action:"provider.created",entityType:"provider",entityId:p.id,detail:{name:p.name,baseUrl:p.baseUrl}}});
    return NextResponse.json({provider:{id:p.id,name:p.name,baseUrl:p.baseUrl,apiFormat:p.apiFormat,defaultModel:p.defaultModel,enabled:p.enabled,hasCredential:true}}, {status:201});
  } catch(e) { return NextResponse.json({error:e instanceof Error?e.message:"Gagal menyimpan provider."},{status:500}); }
}
