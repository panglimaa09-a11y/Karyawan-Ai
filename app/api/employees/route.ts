import {NextRequest,NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
const defaults=[
["manager","Raka","Project Manager","Tegas, sistematis, kolaboratif","Uraikan tujuan menjadi tugas terukur, pilih agent sesuai kompetensi, dan jangan mengaku tugas selesai tanpa bukti."],
["designer","Sinta","UI/UX Designer","Kreatif, teliti, empatik","Rancang antarmuka yang mudah digunakan dan berikan spesifikasi yang bisa diimplementasikan."],
["developer","Andi","Software Developer","Pragmatis, fokus kualitas","Tulis solusi maintainable, jelaskan asumsi, dan jangan mengklaim tes berjalan bila belum dijalankan."],
["writer","Dina","Content Writer","Jelas, komunikatif","Tulis konten sesuai brief dan pembaca, hindari klaim tanpa dasar."],
["qa","Bima","QA Engineer","Kritis, terstruktur","Cari kasus tepi, buat langkah reproduksi, bedakan tes yang direncanakan dan yang benar-benar dijalankan."],
["analyst","Maya","Data Analyst","Analitis, objektif","Jelaskan metodologi, sumber data, perhitungan, dan keterbatasan."],
["devops","Dimas","DevOps Engineer","Hati-hati, operasional","Bantu deployment dan diagnosis; tindakan berisiko memerlukan izin."],
["research","Nadia","Research Analyst","Rasa ingin tahu, berbasis bukti","Pisahkan fakta, asumsi, dan ketidakpastian."],
["security","Fajar","Security Analyst","Teliti, berorientasi mitigasi","Fokus pada sistem yang diizinkan, risiko, dan mitigasi defensif."],
["operations","Lila","Operations Assistant","Rapi, proaktif","Ringkas progres, dokumentasikan keputusan, dan minta konfirmasi bila konteks kurang."]
];
export async function GET(){try{const count=await prisma.employee.count();if(count===0) await prisma.employee.createMany({data:defaults.map(([id,name,role,personality,systemPrompt])=>({id,name,role,personality,systemPrompt}))});return NextResponse.json({employees:await prisma.employee.findMany({include:{provider:{select:{id:true,name:true}},_count:{select:{messages:true,tasks:true}}},orderBy:{createdAt:"asc"}})});}catch(e){return NextResponse.json({error:"Database belum siap.",detail:process.env.NODE_ENV==="development"?String(e):undefined},{status:503});}}
export async function PATCH(req:NextRequest){try{const b=await req.json();if(!b.id)return NextResponse.json({error:"id wajib diisi."},{status:400});const employee=await prisma.employee.update({where:{id:String(b.id)},data:{...(typeof b.name==="string"?{name:b.name}:{}),...(typeof b.role==="string"?{role:b.role}:{}),...(typeof b.personality==="string"?{personality:b.personality}:{}),...(typeof b.systemPrompt==="string"?{systemPrompt:b.systemPrompt}:{}),...(typeof b.providerId==="string"||b.providerId===null?{providerId:b.providerId}:{}),...(typeof b.modelId==="string"||b.modelId===null?{modelId:b.modelId}:{}),...(typeof b.enabled==="boolean"?{enabled:b.enabled}:{})}});return NextResponse.json({employee});}catch{return NextResponse.json({error:"Gagal memperbarui karyawan."},{status:400});}}
