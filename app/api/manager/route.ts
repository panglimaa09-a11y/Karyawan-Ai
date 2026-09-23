import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;


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


export const runtime = "nodejs";
export const maxDuration = 120;


type Plan = {
  summary: string;
  tasks: Array<{
    agent: "designer" | "developer" | "writer" | "qa";
    task: string;
    deliverable: string;
  }>;
};

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
    const { project } = await request.json();

    if (!project || typeof project !== "string" || project.trim().length < 3) {
      return NextResponse.json({ error: "Project description is required." }, { status: 400 });
    }

    // Provider-agnostic configuration. For 9router, use a reachable
    // OpenAI-compatible URL such as https://YOUR-GATEWAY/v1.
    const baseUrl = (process.env.AI_BASE_URL || "https://api.atria-asi.ai/v1").replace(/\/$/, "");
    const apiKey = process.env.AI_API_KEY || "";
    const model = process.env.AI_MODEL || "Atria-Dawn-Preview";

    if (!baseUrl) {
      return NextResponse.json(
        {
          error:
            "AI_BASE_URL belum dipasang di Vercel. 9router yang berjalan di localhost tidak bisa diakses langsung oleh Vercel.",
          setupRequired: true
        },
        { status: 503 }
      );
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are Raka, the Project Manager of an AI software team. Analyze the user's project and create an actionable execution plan. Return ONLY valid JSON with this shape: {summary:string,tasks:[{agent:'designer'|'developer'|'writer'|'qa',task:string,deliverable:string}]} . Create exactly 4 tasks, one for each agent. Be concrete and practical. Do not invent access to external systems."
          },
          { role: "user", content: project.trim() }
        ]
      })
    });

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
