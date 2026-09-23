import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;


type Plan = {
  summary: string;
  tasks: Array<{
    agent: "designer" | "developer" | "writer" | "qa";
    task: string;
    deliverable: string;
  }>;
};

function extractJsonObject(raw: string): string {
  const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("Manager returned no JSON object.");
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  throw new Error("Manager returned incomplete JSON.");
}

function parseManagerPlan(raw: string): Plan {
  const candidate = extractJsonObject(raw);
  try {
    return JSON.parse(candidate);
  } catch {
    // Some compatible models return JavaScript-style object literals
    // (single-quoted strings or unquoted property names) despite the prompt.
    const normalized = candidate
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, value) => JSON.stringify(String(value).replace(/\\'/g, "'")))
      .replace(/([{,]\\s*)([A-Za-z_$][\\w$-]*)\\s*:/g, '$1"$2":');
    return JSON.parse(normalized);
  }
}




;

function extractText(data: any): string {
  if (typeof data?.output_text === "string") return data.output_text;

  const choice = data?.choices?.[0];
  if (typeof choice?.message?.content === "string") return choice.message.content;

  const parts: string[] = [];
  for (const item of data?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();\n    const project = body?.project;\n    const requestedModel = String(body?.model || "").trim();
    const projectText = typeof project === "string" ? project.trim().slice(0, 8000) : "";

    if (projectText.length < 3) {
      return NextResponse.json({ error: "Project description is required." }, { status: 400 });
    }

    // 9Router configuration. AI_BASE_URL must point to a reachable HTTPS 9Router OpenAI-compatible gateway.
    const baseUrl = (process.env.AI_BASE_URL || "").replace(/\/$/, "");
    const apiKey = process.env.AI_API_KEY || "";
    const model = requestedModel || process.env.AI_MODEL_RAKA || process.env.AI_MODEL || "oc/deepseek-v4-flash-free";
    const timeoutMs = Math.max(15000, Number(process.env.AI_TIMEOUT_MS || 45000));

    if (!baseUrl) {
      return NextResponse.json(
        {
          error:
            "AI_BASE_URL belum dipasang di Vercel. Arahkan ke 9Router HTTPS yang dapat diakses Vercel; 127.0.0.1/localhost tidak bisa diakses dari Vercel.",
          setupRequired: true
        },
        { status: 503 }
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are Raka, the Project Manager of an AI software team. Analyze the user's project and create an actionable execution plan. Return ONLY valid JSON with this shape: {summary:string,tasks:[{agent:'designer'|'developer'|'writer'|'qa',task:string,deliverable:string}]} . Create exactly 4 tasks, one for each agent. Be concrete and practical. Do not invent access to external systems."
          },
          { role: "user", content: projectText }
        ]
      })
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseText = await response.text();
    let data: any = {};
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      return NextResponse.json(
        { error: responseText?.slice(0, 500) || `AI provider returned non-JSON response (HTTP ${response.status}).` },
        { status: 502 }
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error?.message || `AI gateway returned HTTP ${response.status}.` },
        { status: response.status }
      );
    }

    const raw = extractText(data).trim();
    if (!raw) throw new Error("Manager returned an empty response.");
    const plan = parseManagerPlan(raw);

    const allowed = new Set(["designer", "developer", "writer", "qa"]);
    plan.tasks = Array.isArray(plan.tasks)
      ? plan.tasks.filter((t) => allowed.has(t.agent)).slice(0, 4)
      : [];

    if (!plan.summary || plan.tasks.length !== 4) {
      throw new Error("Manager plan is incomplete.");
    }

    return NextResponse.json({ plan, model, usage: data?.usage || null });
  } catch (error) {
    console.error("manager route error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
