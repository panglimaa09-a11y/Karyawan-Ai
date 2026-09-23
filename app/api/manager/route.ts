import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export const runtime = "nodejs";

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

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error?.message || `AI gateway returned HTTP ${response.status}.` },
        { status: response.status }
      );
    }

    const raw = extractText(data).trim();
    let plan: Plan;

    try {
      plan = JSON.parse(raw);
    } catch {
      const fenced = raw.match(/\{[\s\S]*\}/);
      if (!fenced) throw new Error("Manager returned invalid JSON.");
      plan = JSON.parse(fenced[0]);
    }

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
