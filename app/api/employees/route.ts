import {NextResponse} from "next/server";
import {getPool,requireAdmin} from "@/lib/server/db";
export const runtime="nodejs";
export async function GET(request:Request){
 try{requireAdmin(request);const {rows}=await getPool().query("SELECT e.id,e.name,e.role,e.personality,e.provider_id,e.model_id,e.enabled,p.name AS provider_name FROM employees e LEFT JOIN providers p ON p.id=e.provider_id ORDER BY e.name");return NextResponse.json({employees:rows});}
 catch(e){const message=e instanceof Error?e.message:"Internal error";return NextResponse.json({error:message},{status:message==="UNAUTHORIZED"?401:503});}
}
export async function PATCH(request:Request){
 try{requireAdmin(request);const body=await request.json();const id=String(body.id||"");const providerId=body.providerId?String(body.providerId):null;const modelId=body.modelId?String(body.modelId):null;if(!id||!modelId)return NextResponse.json({error:"id dan modelId wajib diisi."},{status:400});
 const pool=getPool();const p=await pool.query("SELECT id FROM providers WHERE id=$1 AND enabled=true",[providerId]);if(!p.rowCount)return NextResponse.json({error:"Provider tidak ditemukan atau tidak aktif."},{status:404});
 const model=await pool.query("SELECT model_id FROM provider_models WHERE provider_id=$1 AND model_id=$2",[providerId,modelId]);if(!model.rowCount)return NextResponse.json({error:"Model belum tercatat. Sinkronkan daftar model provider terlebih dahulu."},{status:400});
 const updated=await pool.query("UPDATE employees SET provider_id=$2,model_id=$3 WHERE id=$1 RETURNING id,name,role,provider_id,model_id",[id,providerId,modelId]);if(!updated.rowCount)return NextResponse.json({error:"Karyawan tidak ditemukan."},{status:404});return NextResponse.json({employee:updated.rows[0]});
 }catch(e){const message=e instanceof Error?e.message:"Internal error";return NextResponse.json({error:message},{status:message==="UNAUTHORIZED"?401:503});}
}
