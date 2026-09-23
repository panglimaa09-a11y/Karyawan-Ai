import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type AgentId = "designer" | "developer" | "writer" | "qa";

const prompts: Record<AgentId, string> = {
  designer: "Kamu adalah Sinta, AI UI/UX Designer. Buat design specification yang konkret: visual direction, layout sections, components, responsive behavior, colors, typography, and acceptance criteria. Jangan hanya memberi saran umum.",
  developer: "Kamu adalah Andi, AI Developer. Berdasarkan project dan task, hasilkan implementasi nyata berupa file tree dan kode inti yang bisa langsung dipakai di Next.js/React. Utamakan kode lengkap untuk file utama, bukan pseudocode. Jaga output ringkas dan fokus; maksimal sekitar 4500 token. Jika benar-benar membutuhkan resource dari bos (API key, repo, env, file, domain), tulis bagian terakhir dengan format: RESOURCE_REQUEST: nama resource | alasan.",
  writer: "Kamu adalah Dina, AI Writer. Hasilkan copywriting nyata yang siap dipakai: headline, subheadline, CTA, section copy, feature descriptions, FAQ bila relevan. Gunakan bahasa yang sesuai permintaan project.",
  qa: "Kamu adalah Bima, AI QA Engineer. Buat QA report ringkas dan konkret: test cases, expected result, risiko/bug, dan acceptance checklist. Maksimal 2500 token."
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
    for (let attempt = 1; attempt <= 2; attempt++) {
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
        max_tokens: agent === "developer" ? 3000 : agent === "qa" ? 1800 : 1600,
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
        lastError = err instanceof Error ? err.message : "Koneksi ke provider AI gagal.";
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
      return NextResponse.json({ error: "Provider AI merespons tanpa isi artifact.", agent }, { status: 502 });
    }

    const requests = artifact.split("\\n").filter((line: string) => line.trim().startsWith("RESOURCE_REQUEST:")).map((line: string, index: number) => {
      const raw = line.replace(/^RESOURCE_REQUEST:\\s*/i, "").trim();
      const [request, reason = "Dibutuhkan agar task dapat dilanjutkan."] = raw.split("|").map((x: string) => x.trim());
      return { id: agent + "-" + Date.now() + "-" + index, from: agent, request, reason, status: "pending" };
    }).filter((x: any) => x.request);
    return NextResponse.json({
      agent,
      model: data?.model || model,
      artifact,
      usage: data?.usage || null,
      requests
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Terjadi error pada agent." }, { status: 500 });
  }
}
