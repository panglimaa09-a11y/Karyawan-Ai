import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const baseUrl = (process.env.AI_BASE_URL || "").replace(/\/$/, "");
  const apiKey = process.env.AI_API_KEY || "";
  if (!baseUrl) {
    return NextResponse.json({ error: "AI_BASE_URL belum dikonfigurasi.", models: [] }, { status: 503 });
  }

  try {
    const response = await fetch(baseUrl + "/models", {
      headers: apiKey ? { Authorization: "Bearer " + apiKey } : {},
      cache: "no-store"
    });
    const text = await response.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch {
      return NextResponse.json({ error: "9Router mengembalikan respons model yang tidak valid.", models: [] }, { status: 502 });
    }
    if (!response.ok) {
      return NextResponse.json({ error: data?.error?.message || `9Router /models HTTP ${response.status}`, models: [] }, { status: response.status });
    }
    const models = Array.isArray(data?.data)
      ? data.data.map((m: any) => typeof m === "string" ? m : m?.id).filter((id: any): id is string => typeof id === "string")
      : [];
    return NextResponse.json({ models });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal mengambil model dari 9Router.", models: [] }, { status: 502 });
  }
}
