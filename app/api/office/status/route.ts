import {NextResponse} from "next/server";
import {getPool} from "@/lib/server/db";
export const runtime="nodejs";
export async function GET(){
 try{
  // Read-only, deliberately excludes prompts, message bodies, credentials and project content.
  const {rows}=await getPool().query(`SELECT DISTINCT ON (employee_id) employee_id,event_type,status,created_at FROM office_events WHERE employee_id IS NOT NULL ORDER BY employee_id,created_at DESC LIMIT 30`);
  return NextResponse.json({events:rows.map((r:any)=>({employeeId:r.employee_id,eventType:r.event_type,status:r.status,createdAt:r.created_at}))},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({events:[],available:false},{headers:{"Cache-Control":"no-store"}});}
}
