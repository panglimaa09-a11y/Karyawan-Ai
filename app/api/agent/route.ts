import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

type AgentId = "designer" | "developer" | "writer" | "qa";

const prompts: Record<AgentId, string> = {
  designer: "Kamu adalah Sinta, AI UI/UX Designer. Buat design specification yang konkret: visual direction, layout sections, components, responsive behavior, colors, typography, and acceptance criteria. Jangan hanya memberi saran umum.",
  developer: "Kamu adalah Andi, AI Developer. Hasilkan project nyata sebagai JSON VALID SAJA dengan shape {files:[{path:string,content:string}],summary:string,resource_requests:[{request:string,reason:string}]}. Setiap file harus berisi kode lengkap yang bisa dipakai. Jangan gunakan markdown fence. Fokus pada file inti agar output tetap ringkas. Jika membutuhkan API key, repo, env, file, atau domain, masukkan ke resource_requests; jangan meminta secret lewat chat.",
  writer: "Kamu adalah Dina, AI Writer. Hasilkan copywriting nyata yang siap dipakai: headline, subheadline, CTA, section copy, feature descriptions, FAQ bila relevan. Gunakan bahasa yang sesuai permintaan project.",
  qa: "Kamu adalah Bima, AI QA Engineer. Review artifact dan file project yang diberikan. Buat QA report ringkas dan konkret: status PASS/FAIL, test cases, bug/risiko, acceptance checklist, dan perbaikan yang diperlukan. Jangan mengklaim menjalankan aplikasi jika hanya membaca kode."
};

function extractText(data: any): string {
  const message = data?.choices?.[0]?.message;
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    const text = message.content.map((part: any) => typeof part === "string" ? part : part?.text || part?.content || "").filter(Boolean).join("\n");
    if (text.trim()) return text;
  }
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text;
  if (Array.isArray(data?.content)) {
    const text = data.content.map((part: any) => typeof part === "string" ? part : part?.text || part?.content || "").filter(Boolean).join("\n");
    if (text.trim()) return text;
  }
  if (Array.isArray(data?.output)) {
    const text = data.output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : [item]).map((part: any) => typeof part === "string" ? part : part?.text || part?.content || "").filter(Boolean).join("\n");
    if (text.trim()) return text;
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const project = String(body?.project || "").trim();
    const agent = String(body?.agent || "") as AgentId;
    const task = String(body?.task || "").trim();
    const deliverable = String(body?.deliverable || "").trim();
    const context = String(body?.context || "").trim();

    if (!project || !prompts[agent] || !task) {
      return NextResponse.json({ error: "Project, agent, dan task wajib diisi." }, { status: 400 });
    }

    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "AI_API_KEY belum dipasang di server." }, { status: 500 });
    }

    const baseUrl = (process.env.AI_BASE_URL || "https://api.atria-asi.ai/v1").replace(/\/$/, "");
    const model = process.env.AI_MODEL || "Atria-Dawn-Preview";

    let response: Response | null = null;
    let data: any = null;
    let lastError = "Agent AI gagal mengerjakan task.";
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000);
        try {
        response = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_completion_tokens: agent === "developer" ? 3500 : agent === "qa" ? 1800 : 2200,
        messages: [
          { role: "system", content: prompts[agent] + (agent === "developer" ? " Jangan tambahkan teks di luar JSON. Utamakan ringkas tetapi lengkap." : " Jawab dalam bahasa Indonesia. Utamakan hasil konkret dan ringkas; jangan mengulang instruksi atau memberi pembukaan panjang.") },
          { role: "user", content: `PROJECT:
${project}

TASK:
${task}

EXPECTED DELIVERABLE:
${deliverable}

${context ? `CONTEXT DARI PEKERJA LAIN:
${context}

` : ""}Kerjakan tugas ini sekarang. Output harus menjadi hasil kerja yang dapat ditinjau user, bukan sekadar penjelasan tentang cara mengerjakannya.` }
        ]
      })
    });

        const responseText = await response.text();
        try {
          data = responseText ? JSON.parse(responseText) : {};
        } catch {
          data = {};
          lastError = responseText?.slice(0, 500) || `Provider mengembalikan respons non-JSON (HTTP ${response.status}).`;
        }
        if (response.ok && !responseText) {
          lastError = "Provider AI mengembalikan respons kosong.";
        }
        if (response.ok && responseText && Object.keys(data).length) break;
        lastError = data?.error?.message || lastError || `Agent AI mengembalikan HTTP ${response.status}.`;
        if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
          return NextResponse.json({ error: lastError, status: response.status, agent }, { status: response.status });
        }
      } catch (err) {
        lastError = err instanceof Error && err.name === "AbortError" ? "Provider AI timeout setelah 90 detik." : err instanceof Error ? err.message : "Koneksi ke provider AI gagal.";
        if (attempt === 2) {
          return NextResponse.json({ error: lastError, agent }, { status: 502 });
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }

    if (!response?.ok || !data) {
      return NextResponse.json({ error: lastError, agent }, { status: 502 });
    }

    const artifact = extractText(data);
    if (!artifact.trim()) {
      const finishReason = data?.choices?.[0]?.finish_reason || data?.status || "unknown";
      const refusal = data?.choices?.[0]?.message?.refusal;
      return NextResponse.json({ error: refusal ? "Provider menolak task: " + String(refusal).slice(0, 300) : "Provider AI mengembalikan respons tanpa teks (finish_reason: " + finishReason + ").", agent }, { status: 502 });
    }

    let normalizedArtifact = artifact;
    let parsedProject: any = null;
    if (agent === "developer") {
      try {
        parsedProject = JSON.parse(artifact);
        if (!Array.isArray(parsedProject.files)) throw new Error("Developer files missing");
        parsedProject.files = parsedProject.files.filter((f: any) => f && typeof f.path === "string" && typeof f.content === "string").slice(0, 40);
        normalizedArtifact = JSON.stringify(parsedProject);
      } catch {
        parsedProject = null;
      }
    }
    const requests = parsedProject?.resource_requests?.map((r: any, index: number) => ({ id: agent + "-" + Date.now() + "-" + index, from: agent, request: String(r.request || "").trim(), reason: String(r.reason || "Dibutuhkan agar task dapat dilanjutkan.").trim(), status: "pending" }))
      .filter((x: any) => x.request) || artifact.split("\\n").filter((line: string) => line.trim().startsWith("RESOURCE_REQUEST:")).map((line: string, index: number) => {
      const raw = line.replace(/^RESOURCE_REQUEST:\\s*/i, "").trim();
      const [request, reason = "Dibutuhkan agar task dapat dilanjutkan."] = raw.split("|").map((x: string) => x.trim());
      return { id: agent + "-" + Date.now() + "-" + index, from: agent, request, reason, status: "pending" };
    }).filter((x: any) => x.request);
    return NextResponse.json({
      agent,
      model: data?.model || model,
      artifact: normalizedArtifact,
      usage: data?.usage || null,
      requests
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Terjadi error pada agent." }, { status: 500 });
  }
}
