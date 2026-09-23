"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Text } from "@react-three/drei";
import { useMemo, useState } from "react";
import * as THREE from "three";

type Agent = {
  id: string;
  name: string;
  role: string;
  emoji: string;
  status: "idle" | "working" | "review";
  progress: number;
  task: string;
  position: [number, number, number];
};

type ManagerPlan = {
  summary: string;
  tasks: Array<{
    agent: "designer" | "developer" | "writer" | "qa";
    task: string;
    deliverable: string;
  }>;
};

const initialAgents: Agent[] = [
  { id: "manager", name: "Raka", role: "Project Manager", emoji: "👨‍💼", status: "idle", progress: 0, task: "Menunggu proyek", position: [-3.7, .45, -1.9] },
  { id: "designer", name: "Sinta", role: "Designer", emoji: "🎨", status: "idle", progress: 0, task: "Menunggu Manager", position: [-1.2, .45, -1.9] },
  { id: "developer", name: "Andi", role: "Developer", emoji: "👨‍💻", status: "idle", progress: 0, task: "Menunggu Manager", position: [1.2, .45, -1.9] },
  { id: "writer", name: "Dina", role: "Writer", emoji: "✍️", status: "idle", progress: 0, task: "Menunggu Manager", position: [-1.2, .45, 1.1] },
  { id: "qa", name: "Bima", role: "QA", emoji: "🔍", status: "idle", progress: 0, task: "Menunggu Manager", position: [1.2, .45, 1.1] }
];

function Employee({ agent, selected, onClick }: { agent: Agent; selected: boolean; onClick: () => void }) {
  const ref = useMemo(() => new THREE.Group(), []);
  useFrame(({ clock }) => {
    if (agent.status === "working") ref.position.y = agent.position[1] + Math.sin(clock.elapsedTime * 3) * .025;
  });

  return (
    <group ref={ref} position={agent.position} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <mesh><boxGeometry args={[1.35, .14, .75]} /><meshStandardMaterial color={selected ? "#7ba7ff" : "#273243"} /></mesh>
      <mesh position={[0, .75, -.08]}><boxGeometry args={[.62, .75, .12]} /><meshStandardMaterial color="#121a25" /></mesh>
      <mesh position={[0, .75, .18]}><boxGeometry args={[.52, .52, .06]} /><meshStandardMaterial color={agent.status === "working" ? "#64d6a1" : "#435066"} emissive={agent.status === "working" ? "#143f2e" : "#000000"} /></mesh>
      <Text position={[0, 1.45, 0]} fontSize={.18} color="white" anchorX="center">{agent.emoji} {agent.name}</Text>
      <Text position={[0, 1.22, 0]} fontSize={.105} color="#9aa7b8" anchorX="center">{agent.role}</Text>
    </group>
  );
}

function OfficeScene({ agents, selected, setSelected }: { agents: Agent[]; selected: string; setSelected: (id: string) => void }) {
  return (
    <>
      <PerspectiveCamera makeDefault position={[9, 10, 11]} fov={48} />
      <OrbitControls enablePan={false} minDistance={7} maxDistance={20} target={[0, 0, 0]} />
      <ambientLight intensity={2.2} /><directionalLight position={[4, 9, 4]} intensity={3} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.05, 0]}><planeGeometry args={[11, 8]} /><meshStandardMaterial color="#b99572" /></mesh>
      <mesh position={[0, 2.2, -4]}><boxGeometry args={[11, 4.5, .12]} /><meshStandardMaterial color="#e7e3dc" /></mesh>
      <mesh position={[-5.45, 2.2, 0]}><boxGeometry args={[.12, 4.5, 8]} /><meshStandardMaterial color="#e7e3dc" /></mesh>
      <mesh position={[5.45, 2.2, 0]}><boxGeometry args={[.12, 4.5, 8]} /><meshStandardMaterial color="#e7e3dc" /></mesh>
      <mesh position={[0, .8, 3]}><boxGeometry args={[3.2, .16, 1.1]} /><meshStandardMaterial color="#563f32" /></mesh>
      <Text position={[0, .95, 3]} rotation={[-Math.PI / 2, 0, 0]} fontSize={.24} color="#ded0c2" anchorX="center">MEETING</Text>
      {agents.map((a) => <Employee key={a.id} agent={a} selected={selected === a.id} onClick={() => setSelected(a.id)} />)}
    </>
  );
}

export default function Office() {
  const [agents, setAgents] = useState(initialAgents);
  const [selected, setSelected] = useState("manager");
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [artifact, setArtifact] = useState("");
  const [plan, setPlan] = useState<ManagerPlan | null>(null);
  const [error, setError] = useState("");

  const updateAgent = (id: string, patch: Partial<Agent>) =>
    setAgents((cur) => cur.map((x) => x.id === id ? { ...x, ...patch } : x));

  const runProject = async () => {
    if (!prompt.trim() || running) return;

    setRunning(true);
    setError("");
    setPlan(null);
    setArtifact("");

    setAgents((cur) => cur.map((x) => ({
      ...x,
      status: x.id === "manager" ? "working" : "idle",
      progress: x.id === "manager" ? 10 : 0,
      task: x.id === "manager" ? "Raka sedang menganalisis proyek..." : "Menunggu Manager"
    })));

    try {
      const res = await fetch("/api/manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: prompt.trim() })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Manager gagal membuat rencana.");

      setPlan(data.plan);
      updateAgent("manager", { status: "idle", progress: 100, task: "Rencana proyek selesai" });

      const byAgent = new Map(data.plan.tasks.map((t: ManagerPlan["tasks"][number]) => [t.agent, t]));
      const sequence: Array<"designer" | "writer" | "developer" | "qa"> = ["designer", "writer", "developer", "qa"];

      for (const id of sequence) {
        const task = byAgent.get(id);
        if (!task) continue;
        setSelected(id);
        updateAgent(id, { status: id === "qa" ? "review" : "working", progress: 20, task: task.task });
        await new Promise((r) => setTimeout(r, 700));
        updateAgent(id, { progress: 65 });
        await new Promise((r) => setTimeout(r, 700));
        updateAgent(id, { progress: 100, status: id === "qa" ? "review" : "idle" });
      }

      setArtifact(
        `PROJECT: ${prompt.trim()}

MANAGER SUMMARY:
${data.plan.summary}

TASKS:
${data.plan.tasks.map((t: ManagerPlan["tasks"][number]) => `- ${t.agent.toUpperCase()}: ${t.task}\n  Deliverable: ${t.deliverable}`).join("\n")}

STATUS: PLAN READY FOR EXECUTION
`
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Terjadi error.";
      setError(message);
      setAgents((cur) => cur.map((x) => ({ ...x, status: "idle", task: x.id === "manager" ? "Gagal menjalankan proyek" : "Menunggu Manager" })));
    } finally {
      setRunning(false);
    }
  };

  const selectedAgent = agents.find((a) => a.id === selected)!;

  return (
    <main className="office-shell">
      <section className="scene">
        <div className="hud"><div className="brand">AI OFFICE / LIVE AGENTS</div><div className="live"><i /> REAL AI MANAGER</div></div>
        <div className="canvas-wrap"><Canvas><color attach="background" args={["#0b1017"]} /><OfficeScene agents={agents} selected={selected} setSelected={setSelected} /></Canvas></div>
      </section>

      <aside className="panel">
        <h1>AI Office</h1>
        <div className="muted">Masukkan proyek. Raka akan membuat rencana kerja nyata untuk tim AI.</div>

        <div className="project">
          <div style={{ fontWeight: 700, fontSize: 13 }}>New project</div>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Contoh: Buat landing page Nexora Design untuk UMKM Indonesia..." />
          <button className="primary" onClick={runProject} disabled={!prompt.trim() || running}>
            {running ? "Raka sedang bekerja..." : "START PROJECT"}
          </button>
          {error && <div className="error-box">{error}</div>}
        </div>

        <div className="agent-list">
          {agents.map((a) => (
            <div className="agent" key={a.id} onClick={() => setSelected(a.id)}>
              <div className="agent-top"><div className="agent-name">{a.emoji} {a.name} · {a.role}</div><div className="badge">{a.status}</div></div>
              <div className="task">{a.task}</div>
              <div className="progress"><span style={{ width: `${a.progress}%` }} /></div>
            </div>
          ))}
        </div>

        {plan && (
          <div className="artifact">
            <div style={{ fontWeight: 700, fontSize: 13 }}>🧠 Raka — Manager Plan</div>
            <div className="muted" style={{ marginTop: 6 }}>{plan.summary}</div>
            {plan.tasks.map((t) => (
              <div key={t.agent} style={{ marginTop: 10, fontSize: 12 }}>
                <b>{t.agent.toUpperCase()}</b><br />
                {t.task}<br />
                <span className="muted">Deliverable: {t.deliverable}</span>
              </div>
            ))}
          </div>
        )}

        <div className="artifact">
          <div style={{ fontWeight: 700, fontSize: 13 }}>Selected agent</div>
          <div className="muted" style={{ marginTop: 6 }}>{selectedAgent.name} · {selectedAgent.role} · {selectedAgent.task}</div>
        </div>

        {artifact && <div className="artifact"><div style={{ fontWeight: 700, fontSize: 13 }}>📦 Project artifact</div><pre>{artifact}</pre></div>}
      </aside>
    </main>
  );
}
