import {NextResponse} from "next/server";
import {getPool,requireAdmin} from "@/lib/server/db";
import {audit} from "@/lib/server/audit";
export const runtime="nodejs";
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
 try{
  requireAdmin(request);
  const {id}=await context.params;
  const b=await request.json();
  const decision=b.decision;
  if(!["approved","rejected"].includes(decision))return NextResponse.json({error:"decision harus approved atau rejected."},{status:400});
  const pool=getPool();
  const {rows}=await pool.query("UPDATE approval_requests SET status=$2,decided_at=now(),decided_by='owner' WHERE id=$1 AND status='pending' RETURNING id,action_type,description,status,decided_at",[id,decision]);
  if(!rows.length)return NextResponse.json({error:"Permintaan tidak ditemukan atau sudah diputuskan."},{status:409});
  await audit("owner",decision==="approved"?"approval_granted":"approval_rejected","approval",id,{action_type:rows[0].action_type});
  return NextResponse.json({approval:rows[0],executed:false,message:"Keputusan dicatat dan diaudit. Eksekusi tindakan sensitif dilakukan endpoint terkait dengan approvalId ini."});
 }catch(e){const m=e instanceof Error?e.message:"Internal error";return NextResponse.json({error:m},{status:m==="UNAUTHORIZED"?401:503});}
}
