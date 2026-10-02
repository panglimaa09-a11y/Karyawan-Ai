import {NextResponse} from "next/server";
import {getPool,requireAdmin} from "@/lib/server/db";
export const runtime="nodejs";
export async function GET(request:Request){try{requireAdmin(request);const url=new URL(request.url);const limit=Math.min(100,Math.max(1,Number(url.searchParams.get("limit"))||40));const {rows}=await getPool().query("SELECT id,employee_id,event_type,status,message,metadata,created_at FROM office_events ORDER BY created_at DESC LIMIT $1",[limit]);return NextResponse.json({events:rows});}catch(e){const m=e instanceof Error?e.message:"Internal error";return NextResponse.json({error:m},{status:m==="UNAUTHORIZED"?401:503});}}
