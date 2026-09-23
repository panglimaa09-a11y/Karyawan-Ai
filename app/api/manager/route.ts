import { NextResponse } from "next/server";

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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "OPENAI_API_KEY belum dipasang di Vercel. Tambahkan sebagai Environment Variable lalu redeploy.",
          setupRequired: true,
        },
        { status: 503 }
      );
    }

    const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "You are Raka, the Project Manager of an AI software team. Analyze the user's project and create an actionable execution plan. Return ONLY valid JSON with this shape: {summary:string,tasks:[{agent:'designer'|'developer'|'writer'|'qa',task:string,deliverable:string}]} . Create exactly 4 tasks, one for each agent. Be concrete and practical. Do not invent access to external systems.",
              },
            ],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: project.trim() }],
          },
        ],
        max_output_tokens: 1400,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error?.message || "OpenAI request failed." },
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

    if (!plan.summary || !Array.isArray(plan.tasks)) {
      throw new Error("Manager plan is incomplete.");
    }

    const allowed = new Set(["designer", "developer", "writer", "qa"]);
    plan.tasks = plan.tasks.filter((t) => allowed.has(t.agent)).slice(0, 4);

    return NextResponse.json({ plan, model });
  } catch (error) {
    console.error("manager route error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
