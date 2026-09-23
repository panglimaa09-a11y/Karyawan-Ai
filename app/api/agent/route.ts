import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type AgentId = string;

const prompts: Record<string, string> = {
  analyst: "Kamu Ardi, Business Analyst. Pecah kebutuhan user menjadi requirements, scope, user stories, acceptance criteria, risiko, dan prioritas.",
  strategist: "Kamu Naya, Strategy Specialist. Susun strategi produk, positioning, roadmap, prioritas fitur, trade-off, dan KPI yang relevan.",
  designer: "Kamu Sinta, UI/UX Designer. Buat spesifikasi UI/UX konkret: information architecture, layout, components, responsive behavior, states, accessibility, dan acceptance criteria.",
  visual: "Kamu Vina, Visual Designer. Buat arahan visual konkret: design system, warna, typography, spacing, imagery, motion, iconography, dan visual QA.",
  writer: "Kamu Dina, Copywriter. Buat copy siap pakai: headline, subheadline, CTA, section copy, feature copy, FAQ, error/empty states bila relevan.",
  frontend: "Kamu Andi, Frontend Developer. Hasilkan project nyata sebagai JSON VALID SAJA dengan shape {files:[{path:string,content:string}],summary:string,resource_requests:[{request:string,reason:string}]}. File harus lengkap dan runnable. Untuk website sederhana utamakan index.html, style.css, script.js. Jangan markdown fence.",
  backend: "Kamu Beni, Backend Developer. Rancang API, service layer, validation, error handling, auth flow, dan integrasi backend yang konkret.",
  database: "Kamu Dimas, Database Engineer. Rancang schema, relations, indexes, migrations, constraints, seed data, dan RLS bila diperlukan.",
  security: "Kamu Rian, Security Engineer. Audit threat model, auth, secrets, input validation, XSS/CSRF, authorization, RLS, rate limiting, dan security checklist.",
  ai: "Kamu Fajar, AI Engineer. Rancang AI workflow, prompts, model routing, structured outputs, fallback, context handling, dan evaluasi.",
  api: "Kamu Reza, API Engineer. Rancang kontrak API, endpoint, payload, status codes, retries, timeouts, webhooks, dan integration tests.",
  qa: "Kamu Bima, QA Engineer. Review artifact dan file project. Buat QA report konkret: PASS/FAIL, test cases, bug/risiko, acceptance checklist, dan perbaikan.",
  reviewer: "Kamu Kevin, Code Reviewer. Review hasil engineering untuk correctness, maintainability, security, performance, dan regression risk.",
  devops: "Kamu Yoga, DevOps Engineer. Buat deployment plan, CI/CD, environment configuration, build checks, rollback, dan operational checklist.",
  cloud: "Kamu Aldi, Cloud Engineer. Rancang hosting, networking, storage, observability, scaling, cost controls, dan environment separation.",
  mobile: "Kamu Riko, Mobile Developer. Rancang mobile experience, responsive behavior, navigation, API integration, offline/error states, dan mobile acceptance criteria.",
  seo: "Kamu Sari, SEO Specialist. Buat technical SEO, metadata, sitemap/robots, structured data, internal linking, content targets, dan measurement plan.",
  marketing: "Kamu Tio, Marketing Specialist. Buat target audience, positioning, acquisition channels, campaign ideas, funnel, CTA, dan measurement.",
  finance: "Kamu Rio, Finance Specialist. Buat estimasi biaya, resource assumptions, pricing considerations, unit economics, dan budget risks.",
  docs: "Kamu Lala, Documentation Specialist. Buat README, setup guide, architecture notes, usage guide, troubleshooting, dan release notes.",
  support: "Kamu Bayu, Support Engineer. Buat support playbook, troubleshooting flows, common issues, escalation rules, dan user-facing help content."
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
    const project = String(body?.project || "").trim().slice(0, 8000);
    const agent = String(body?.agent || "") as AgentId;
    const task = String(body?.task || "").trim();
    const deliverable = String(body?.deliverable || "").trim();
    const context = String(body?.context || "").trim().slice(0, 14000);
    const requestedModel = String(body?.model || "").trim();

    if (!project || !prompts[agent] || !task) {
      return NextResponse.json({ error: "Project, agent, dan task wajib diisi." }, { status: 400 });
    }

    const apiKey = process.env.AI_API_KEY || "";
    const baseUrl = (process.env.AI_BASE_URL || "").replace(/\/$/, "");
    const modelByAgent: Record<string, string> = {
      analyst: process.env.AI_MODEL_ANALYST || "",
      strategist: process.env.AI_MODEL_STRATEGIST || "",
      designer: process.env.AI_MODEL_DESIGNER || "",
      visual: process.env.AI_MODEL_VISUAL || "",
      writer: process.env.AI_MODEL_WRITER || "",
      frontend: process.env.AI_MODEL_FRONTEND || process.env.AI_MODEL_DEVELOPER || "",
      backend: process.env.AI_MODEL_BACKEND || "",
      database: process.env.AI_MODEL_DATABASE || "",
      security: process.env.AI_MODEL_SECURITY || "",
      ai: process.env.AI_MODEL_AI || "",
      api: process.env.AI_MODEL_API || "",
      qa: process.env.AI_MODEL_QA || "",
      reviewer: process.env.AI_MODEL_REVIEWER || "",
      devops: process.env.AI_MODEL_DEVOPS || "",
      cloud: process.env.AI_MODEL_CLOUD || "",
      mobile: process.env.AI_MODEL_MOBILE || "",
      seo: process.env.AI_MODEL_SEO || "",
      marketing: process.env.AI_MODEL_MARKETING || "",
      finance: process.env.AI_MODEL_FINANCE || "",
      docs: process.env.AI_MODEL_DOCS || "",
      support: process.env.AI_MODEL_SUPPORT || ""
    };
    const model = requestedModel || modelByAgent[agent] || process.env.AI_MODEL || "oc/deepseek-v4-flash-free";

    if (!baseUrl) {
      return NextResponse.json({ error: "AI_BASE_URL belum dipasang. Arahkan ke 9Router HTTPS yang dapat diakses Vercel; jangan gunakan 127.0.0.1/localhost." }, { status: 503 });
    }
    const configuredTimeoutMs = Number(process.env.AI_TIMEOUT_MS || 30000);
    const timeoutMs = Math.min(120000, Math.max(15000, configuredTimeoutMs));
    const maxRetries = Math.min(2, Math.max(0, Number(process.env.AI_MAX_RETRIES || 1)));

    let response: Response | null = null;
    let data: any = null;
    let lastError = "Agent AI gagal mengerjakan task.";
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
        response = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_completion_tokens: agent === "frontend" ? 12000 : agent === "qa" ? 2200 : 1500,
        messages: [
          { role: "system", content: prompts[agent] + (agent === "frontend" ? " Jangan tambahkan teks di luar JSON. Utamakan ringkas tetapi lengkap." : " Jawab dalam bahasa Indonesia. Utamakan hasil konkret dan ringkas; jangan mengulang instruksi atau memberi pembukaan panjang.") },
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
        } finally {
          clearTimeout(timeout);
        }

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
        lastError = err instanceof Error && err.name === "AbortError" ? "Provider 9Router timeout." : err instanceof Error ? err.message : "Koneksi ke provider AI gagal.";
        if (attempt === maxRetries) {
          return NextResponse.json({ error: lastError, agent }, { status: 502 });
        }
      }
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    if (!response?.ok || !data) {
      return NextResponse.json({ error: lastError, agent }, { status: 502 });
    }

    const artifact = extractText(data).trim();
    if (!artifact.trim()) {
      const finishReason = data?.choices?.[0]?.finish_reason || data?.status || "unknown";
      const refusal = data?.choices?.[0]?.message?.refusal;
      return NextResponse.json({ error: refusal ? "Provider menolak task: " + String(refusal).slice(0, 300) : "Provider AI mengembalikan respons tanpa teks (finish_reason: " + finishReason + ").", agent }, { status: 502 });
    }

    let normalizedArtifact = artifact;
    let parsedProject: any = null;
    if (agent === "frontend") {
      try {
        const cleaned = artifact.replace(/^\\s*\`\`\`(?:json)?\\s*/i, "").replace(/\\s*\`\`\`\\s*$/i, "").trim();
        try {
          parsedProject = JSON.parse(cleaned);
        } catch {
          const start = cleaned.indexOf("{");
          const end = cleaned.lastIndexOf("}");
          if (start >= 0 && end > start) parsedProject = JSON.parse(cleaned.slice(start, end + 1));
          else throw new Error("Developer JSON tidak ditemukan");
        }
        if (!Array.isArray(parsedProject.files)) throw new Error("Developer files missing");
        parsedProject.files = parsedProject.files.filter((f: any) => f && typeof f.path === "string" && typeof f.content === "string").slice(0, 40);
        if (!parsedProject.files.length) throw new Error("Developer files kosong");
        normalizedArtifact = JSON.stringify(parsedProject);
      } catch {
        parsedProject = null;
      }
    }
    const requests = parsedProject?.resource_requests?.map((r: any, index: number) => ({ id: agent + "-" + Date.now() + "-" + index, from: agent, request: String(r.request || "").trim(), reason: String(r.reason || "Dibutuhkan agar task dapat dilanjutkan.").trim(), status: "pending" }))
      .filter((x: any) => x.request) || artifact.split(/\r?\n/).filter((line: string) => line.trim().startsWith("RESOURCE_REQUEST:")).map((line: string, index: number) => {
      const raw = line.replace(/^RESOURCE_REQUEST:\s*/i, "").trim();
      const [request, reason = "Dibutuhkan agar task dapat dilanjutkan."] = raw.split("|").map((x: string) => x.trim());
      return { id: agent + "-" + Date.now() + "-" + index, from: agent, request, reason, status: "pending" };
    }).filter((x: any) => x.request);
    return NextResponse.json({
      agent,
      model: data?.model || model,
      artifact: normalizedArtifact,
      files: parsedProject?.files || null,
      summary: parsedProject?.summary || null,
      usage: data?.usage || null,
      requests
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Terjadi error pada agent." }, { status: 500 });
  }
}
