import { NextResponse } from "next/server";

type AgentId = "designer" | "developer" | "writer" | "qa";

const prompts: Record<AgentId, string> = {
  designer: "Kamu adalah Sinta, AI UI/UX Designer. Buat design specification yang konkret: visual direction, layout sections, components, responsive behavior, colors, typography, and acceptance criteria. Jangan hanya memberi saran umum.",
  developer: "Kamu adalah Andi, AI Developer. Berdasarkan project dan task, hasilkan implementasi nyata berupa file tree dan kode inti yang bisa langsung dipakai di Next.js/React. Utamakan kode lengkap untuk file utama, bukan pseudocode.",
  writer: "Kamu adalah Dina, AI Writer. Hasilkan copywriting nyata yang siap dipakai: headline, subheadline, CTA, section copy, feature descriptions, FAQ bila relevan. Gunakan bahasa yang sesuai permintaan project.",
  qa: "Kamu adalah Bima, AI QA Engineer. Buat test plan dan QA report konkret berdasarkan project/task, termasuk test cases, expected result, risiko/bug yang mungkin terjadi, dan acceptance checklist."
};

function extractText(data: any) {
  return data?.choices?.[0]?.message?.content
    ?? data?.output_text
    ?? data?.output?.flatMap((x: any) => x?.content ?? []).find((x: any) => x?.text)?.text
    ?? "";
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const project = String(body?.project || "").trim();
    const agent = String(body?.agent || "") as AgentId;
    const task = String(body?.task || "").trim();
    const deliverable = String(body?.deliverable || "").trim();

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
    for (let attempt = 1; attempt <= 3; attempt++) {
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
        messages: [
          { role: "system", content: prompts[agent] + " Jawab dalam bahasa Indonesia. Berikan output terstruktur dengan heading dan artefak yang jelas." },
          { role: "user", content: `PROJECT:
${project}

TASK:
${task}

EXPECTED DELIVERABLE:
${deliverable}

Kerjakan tugas ini sekarang. Output harus menjadi hasil kerja yang dapat ditinjau user, bukan sekadar penjelasan tentang cara mengerjakannya.` }
        ]
      })
    });

        data = await response.json();
        if (response.ok) break;
        lastError = data?.error?.message || `Agent AI mengembalikan HTTP ${response.status}.`;
        if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
          return NextResponse.json({ error: lastError, status: response.status, agent }, { status: response.status });
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Koneksi ke provider AI gagal.";
        if (attempt === 3) {
          return NextResponse.json({ error: lastError, agent }, { status: 502 });
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
    }

    if (!response?.ok || !data) {
      return NextResponse.json({ error: lastError, agent }, { status: 502 });
    }

    const artifact = extractText(data);
    if (!artifact.trim()) {
      return NextResponse.json({ error: "Provider AI merespons tanpa isi artifact.", agent }, { status: 502 });
    }

    return NextResponse.json({
      agent,
      model: data?.model || model,
      artifact,
      usage: data?.usage || null
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Terjadi error pada agent." }, { status: 500 });
  }
}
