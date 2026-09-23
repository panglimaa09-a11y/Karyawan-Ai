"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Text } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import EmployeeAvatar from "./EmployeeAvatar";

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

type ProjectHistory = { project: string; time: string; status: string };
type ResourceRequest = { id: string; from: string; request: string; reason: string; status: "pending" | "provided"; value?: string };
type DeliveryConfig = { repoUrl: string; branch: string; };
type SavedProject = { project: string; history: ProjectHistory[]; plan: ManagerPlan | null; artifacts: Artifact[]; artifact: string; aiModel: string; tokenUsage: TokenUsage; requests: ResourceRequest[]; delivery: DeliveryConfig };
type TokenUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
type Artifact = { agent: "designer" | "developer" | "writer" | "qa"; title: string; content: string; model?: string; usage?: TokenUsage; status: "working" | "done" | "error" };

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
  const avatarColor: Record<string, string> = {
    manager: "#6c8cff",
    designer: "#d16cff",
    developer: "#4dd4a8",
    writer: "#f0b45c",
    qa: "#63b7ff"
  };

  useFrame(({ clock }) => {
    if (agent.status === "working" || agent.status === "review") {
      ref.position.y = agent.position[1] + Math.sin(clock.elapsedTime * 3) * .025;
    } else {
      ref.position.y = agent.position[1];
    }
  });

  return (
    <group ref={ref} position={agent.position} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <mesh>
        <boxGeometry args={[1.35, .14, .75]} />
        <meshStandardMaterial color={selected ? "#7ba7ff" : "#273243"} />
      </mesh>
      <mesh position={[0, .75, -.08]}>
        <boxGeometry args={[.62, .75, .12]} />
        <meshStandardMaterial color="#121a25" />
      </mesh>
      <mesh position={[0, .75, .18]}>
        <boxGeometry args={[.52, .52, .06]} />
        <meshStandardMaterial
          color={agent.status === "working" ? "#64d6a1" : "#435066"}
          emissive={agent.status === "working" ? "#143f2e" : "#000000"}
        />
      </mesh>
      <EmployeeAvatar
        color={avatarColor[agent.id] || "#6c8cff"}
        name={agent.name}
        role={agent.role}
        active={agent.status === "working" || agent.status === "review"}
      />
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
  const [sidebar, setSidebar] = useState<"history" | "tokens" | "ai" | "requests" | "delivery" | "workspace" | null>(null);
  const [requests, setRequests] = useState<ResourceRequest[]>([]);
  const [delivery, setDelivery] = useState<DeliveryConfig>({ repoUrl: "", branch: "main" });
  const [history, setHistory] = useState<ProjectHistory[]>([]);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>(null);
  const [aiModel, setAiModel] = useState("Atria-Dawn-Preview");
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<"overview" | "artifacts" | "preview" | "activity">("overview");
  const [retryingAgent, setRetryingAgent] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("ai-office-project");
      if (!saved) return;
      const data: SavedProject = JSON.parse(saved);
      setPrompt(data.project || "");
      setHistory(data.history || []);
      setPlan(data.plan || null);
      setArtifacts(data.artifacts || []);
      setArtifact(data.artifact || "");
      setAiModel(data.aiModel || "Atria-Dawn-Preview");
      setTokenUsage(data.tokenUsage || null);
      setRequests(data.requests || []);
      setDelivery(data.delivery || { repoUrl: "", branch: "main" });
      if (data.artifacts?.length) { setWorkspaceOpen(true); setSidebar("workspace"); }
    } catch {
      localStorage.removeItem("ai-office-project");
    }
  }, []);

  useEffect(() => {
    if (!prompt.trim() && !history.length && !artifacts.length) return;
    const saved: SavedProject = { project: prompt.trim(), history, plan, artifacts, artifact, aiModel, tokenUsage, requests, delivery };
    localStorage.setItem("ai-office-project", JSON.stringify(saved));
  }, [prompt, history, plan, artifacts, artifact, aiModel, tokenUsage, requests, delivery]);

  const updateAgent = (id: string, patch: Partial<Agent>) => setAgents((cur) => cur.map((x) => x.id === id ? { ...x, ...patch } : x));

  const runProject = async () => {
    if (!prompt.trim() || running) return;
    setRunning(true); setError(""); setPlan(null); setArtifact(""); setArtifacts([]); setWorkspaceOpen(true); setSidebar("workspace"); setWorkspaceTab("overview");
    setAgents((cur) => cur.map((x) => ({ ...x, status: x.id === "manager" ? "working" : "idle", progress: x.id === "manager" ? 10 : 0, task: x.id === "manager" ? "Raka sedang menganalisis proyek..." : "Menunggu Manager" })));
    try {
      const res = await fetch("/api/manager", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: prompt.trim() }) });
      const data = await readApiResponse(res);
      setPlan(data.plan);
      setTokenUsage(data.usage || null);
      setAiModel(data.model || "Atria-Dawn-Preview");
      setHistory((items) => [
        { project: prompt.trim(), time: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }), status: "Selesai" },
        ...items
      ].slice(0, 12));
      updateAgent("manager", { status: "idle", progress: 100, task: "Rencana proyek selesai" });
      const byAgent = new Map<ManagerPlan["tasks"][number]["agent"], ManagerPlan["tasks"][number]>(data.plan.tasks.map((t: ManagerPlan["tasks"][number]) => [t.agent, t]));
      const sequence: Array<"designer" | "writer" | "developer" | "qa"> = ["designer", "writer", "developer", "qa"];
      for (const id of sequence) {
        const task = byAgent.get(id);
        if (!task) continue;
        setSelected(id);
        updateAgent(id, { status: id === "qa" ? "review" : "working", progress: 15, task: task.task });
        setArtifacts((items) => [...items, { agent: id, title: task.deliverable, content: "", status: "working" }]);
        try {
          const agentRes = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: prompt.trim(), agent: id, task: task.task, deliverable: task.deliverable }) });
          const agentData = await readApiResponse(agentRes);
          if (Array.isArray(agentData.requests) && agentData.requests.length) {
            setRequests((items) => [...items, ...agentData.requests].slice(-20));
          }
          setArtifacts((items) => items.map((a) => a.agent === id ? { ...a, content: agentData.artifact || "Agent tidak mengembalikan artifact.", model: agentData.model, usage: agentData.usage, status: "done" } : a));
          updateAgent(id, { progress: 100, status: id === "qa" ? "review" : "idle", task: "Artifact selesai" });
        } catch (agentError) {
          const message = agentError instanceof Error ? agentError.message : "Agent gagal.";
          setArtifacts((items) => items.map((a) => a.agent === id ? { ...a, content: message, status: "error" } : a));
          updateAgent(id, { progress: 100, status: "idle", task: `Gagal: ${message.slice(0, 140)}` });
        }
      }
      setWorkspaceTab("artifacts");
      setArtifact(`PROJECT: ${prompt.trim()}

MANAGER SUMMARY:
${data.plan.summary}

STATUS: AI EMPLOYEES COMPLETED THEIR WORK
`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Terjadi error.";
      setError(message);
      setAgents((cur) => cur.map((x) => ({ ...x, status: "idle", task: x.id === "manager" ? "Gagal menjalankan proyek" : "Menunggu Manager" })));
    } finally { setRunning(false); }
  };

  async function readApiResponse(response: Response) {
    const text = await response.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(text?.slice(0, 500) || `Server mengembalikan respons yang tidak valid (HTTP ${response.status}).`);
    }
    if (!response.ok) throw new Error(data?.error || `Request gagal (HTTP ${response.status}).`);
    return data;
  }

  const retryAgent = async (id: "designer" | "developer" | "writer" | "qa") => {
    const task = plan?.tasks.find((t) => t.agent === id);
    const current = artifacts.find((a) => a.agent === id);
    if (!task || retryingAgent) return;
    setRetryingAgent(id);
    setSelected(id);
    updateAgent(id, { status: id === "qa" ? "review" : "working", progress: 15, task: "Memperbaiki pekerjaan yang gagal..." });
    setArtifacts((items) => items.map((a) => a.agent === id ? { ...a, content: "", status: "working" } : a));
    try {
      const repairTask = `${task.task}

PERBAIKI ULANG PEKERJAAN SEBELUMNYA.
Error sebelumnya: ${current?.content || "Tidak ada detail error."}
Buat hasil baru yang lebih ringkas dan valid.`;
      const res = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: prompt.trim(), agent: id, task: repairTask, deliverable: task.deliverable }) });
      const data = await readApiResponse(res);
      if (Array.isArray(data.requests) && data.requests.length) setRequests((items) => [...items, ...data.requests].slice(-20));
      setArtifacts((items) => items.map((a) => a.agent === id ? { ...a, content: data.artifact || "Agent tidak mengembalikan artifact.", model: data.model, usage: data.usage, status: "done" } : a));
      updateAgent(id, { progress: 100, status: id === "qa" ? "review" : "idle", task: "Perbaikan selesai" });
      setWorkspaceTab("artifacts");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Agent gagal diperbaiki.";
      setArtifacts((items) => items.map((a) => a.agent === id ? { ...a, content: message, status: "error" } : a));
      updateAgent(id, { progress: 100, status: "idle", task: `Gagal: ${message.slice(0, 140)}` });
    } finally {
      setRetryingAgent(null);
    }
  };

  const selectedAgent = agents.find((a) => a.id === selected)!;

  const sidebarContent = sidebar === "history" ? (
    <>
      <div className="side-title">Riwayat Projek</div>
      {history.length ? history.map((item, i) => (
        <div className="side-item" key={i}>
          <b>{item.project}</b>
          <span>{item.time} · {item.status}</span>
        </div>
      )) : <div className="side-empty">Belum ada projek yang dijalankan.</div>}
    </>
  ) : sidebar === "tokens" ? (
    <>
      <div className="side-title">Penggunaan Token</div>
      <div className="token-card"><strong>{tokenUsage?.total_tokens ?? "—"}</strong><span>Total token terakhir</span></div>
      <div className="token-row"><span>Input</span><b>{tokenUsage?.prompt_tokens ?? "—"}</b></div>
      <div className="token-row"><span>Output</span><b>{tokenUsage?.completion_tokens ?? "—"}</b></div>
      <div className="side-empty">Data berasal dari respons provider AI.</div>
    </>
  ) : sidebar === "ai" ? (
    <>
      <div className="side-title">AI yang Dipakai</div>
      <div className="ai-card"><div className="ai-dot" /><div><b>{aiModel}</b><span>Project Manager · Raka</span></div></div>
      <div className="side-empty">Model produksi ditentukan oleh konfigurasi server.</div>
    </>
  ) : sidebar === "requests" ? (
    <>
      <div className="side-title">Permintaan AI ke Bos</div>
      {requests.length ? requests.map((r) => (
        <div className="side-item" key={r.id}>
          <b>🤖 {r.from}</b>
          <span>{r.request}</span>
          <small>{r.reason}</small>
          <button className="side-action" onClick={() => setRequests(items => items.map(x => x.id === r.id ? { ...x, status: "provided" } : x))}>
            {r.status === "provided" ? "✓ Sudah diberikan" : "Tandai sudah diberikan"}
          </button>
        </div>
      )) : <div className="side-empty">Belum ada permintaan resource. Jika AI membutuhkan API key, repo, file, domain, atau konfigurasi, permintaannya akan muncul di sini.</div>}
      <div className="side-warning">Jangan masukkan secret/API key langsung ke chat. Simpan credential sebagai environment variable/secret di server.</div>
    </>
  ) : sidebar === "workspace" ? (
    <>
      <div className="workspace-head"><div><div className="workspace-kicker">PROJECT WORKSPACE</div><h2>{prompt.trim() || "Project"}</h2><span>{running ? "AI employees sedang bekerja..." : "Workflow selesai — hasil siap ditinjau"}</span></div></div>
      <nav className="workspace-tabs">
        <button className={workspaceTab === "overview" ? "active" : ""} onClick={() => setWorkspaceTab("overview")}>Overview</button>
        <button className={workspaceTab === "artifacts" ? "active" : ""} onClick={() => setWorkspaceTab("artifacts")}>Artifacts ({artifacts.filter(a => a.status === "done").length})</button>
        <button className={workspaceTab === "preview" ? "active" : ""} onClick={() => setWorkspaceTab("preview")}>Preview</button>
        <button className={workspaceTab === "activity" ? "active" : ""} onClick={() => setWorkspaceTab("activity")}>Activity</button>
      </nav>
      <div className="workspace-body">
        {workspaceTab === "overview" && <div className="workspace-grid"><div className="workspace-card hero"><span>FINAL OUTPUT</span><strong>{running ? "Building..." : artifacts.length ? "Work completed" : "Planning..."}</strong><p>Raka membagi project ke empat AI employee. Setiap employee mengerjakan task dan menghasilkan artifact yang dapat kamu buka.</p><button className="primary" onClick={() => setWorkspaceTab("artifacts")}>Lihat Hasil Pekerjaan →</button></div>{agents.filter(a => a.id !== "manager").map(a => <div className="workspace-card" key={a.id}><b>{a.emoji} {a.name}</b><span>{a.role}</span><p>{a.task}</p><div className="mini-progress"><i style={{width: `${a.progress}%`}} /></div></div>)}</div>}
        {workspaceTab === "artifacts" && <div className="artifact-grid">{artifacts.map(a => <article className="result-card" key={a.agent}><div className="result-top"><b>{a.agent.toUpperCase()}</b><span className={a.status}>{a.status}</span></div><h3>{a.title}</h3><pre>{a.content || "Sedang dikerjakan oleh AI..."}</pre>{a.status === "error" && <button className="primary repair-btn" disabled={retryingAgent === a.agent || running} onClick={() => retryAgent(a.agent)}>{retryingAgent === a.agent ? "Memperbaiki..." : "↻ Perbaiki Ulang"}</button>}</article>)}{!artifacts.length && <div className="side-empty">Belum ada artifact.</div>}</div>}
        {workspaceTab === "preview" && <div className="preview-card"><div className="preview-bar"><span>AI WORK RESULT</span><span>{running ? "BUILDING" : "READY"}</span></div><pre>{artifact || "Preview akan tersedia setelah workflow berjalan."}</pre></div>}
        {workspaceTab === "activity" && <div className="activity-list"><div>🧠 Raka membuat project plan</div>{artifacts.map(a => <div key={a.agent}>{a.status === "done" ? "✅" : a.status === "error" ? "❌" : "⏳"} {a.agent.toUpperCase()} — {a.title}</div>)}</div>}
      </div>
    </>
  ) : sidebar === "delivery" ? (
    <>
      <div className="side-title">Delivery Project</div>
      <label className="field-label">GitHub Repository</label>
      <input className="side-input" value={delivery.repoUrl} onChange={e => setDelivery(d => ({ ...d, repoUrl: e.target.value }))} placeholder="https://github.com/user/repo" />
      <label className="field-label">Branch</label>
      <input className="side-input" value={delivery.branch} onChange={e => setDelivery(d => ({ ...d, branch: e.target.value }))} placeholder="main" />
      <div className="side-item">
        <b>📦 Perintah Delivery</b>
        <span>Setelah Andi menghasilkan file project, kamu bisa memberi perintah: “Push project ini ke repository yang saya berikan.”</span>
      </div>
      <div className="side-warning">Push otomatis membutuhkan koneksi GitHub yang aman di server. Jangan memasukkan GitHub token ke kolom ini.</div>
      <button className="primary" onClick={() => { setSidebar("workspace"); setWorkspaceOpen(true); setWorkspaceTab("artifacts"); }}>Lihat File / Artifact →</button>
    </>
  ) : null;

  return (
    <main className="office-shell">
      <nav className="sidebar-nav">
        <div className="sidebar-logo">AI<br/><span>OFFICE</span></div>
        <button className={sidebar === "history" ? "side-btn active" : "side-btn"} onClick={() => setSidebar(sidebar === "history" ? null : "history")}><span>◷</span>Riwayat Projek</button>
        <button className={sidebar === "tokens" ? "side-btn active" : "side-btn"} onClick={() => setSidebar(sidebar === "tokens" ? null : "tokens")}><span>⌁</span>Penggunaan Token</button>
        <button className={sidebar === "ai" ? "side-btn active" : "side-btn"} onClick={() => setSidebar(sidebar === "ai" ? null : "ai")}><span>✦</span>AI yang Dipakai</button>
        <button className={sidebar === "requests" ? "side-btn active" : "side-btn"} onClick={() => setSidebar(sidebar === "requests" ? null : "requests")}><span>⚡</span>Permintaan AI</button>
        <button className={sidebar === "delivery" ? "side-btn active" : "side-btn"} onClick={() => setSidebar(sidebar === "delivery" ? null : "delivery")}><span>📦</span>Delivery / Repo</button>
        <button className={sidebar === "workspace" ? "side-btn active" : "side-btn"} onClick={() => { setWorkspaceOpen(true); setSidebar(sidebar === "workspace" ? null : "workspace"); }}><span>🗂️</span>Project Workspace</button>
      </nav>
      {sidebar && <aside className="sidebar-drawer"><button className="drawer-close" onClick={() => setSidebar(null)}>×</button>{sidebarContent}</aside>}
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
          <button className="primary" onClick={runProject} disabled={!prompt.trim() || running}>{running ? "Raka sedang bekerja..." : "START PROJECT"}</button>
          {error && <div className="error-box">{error}</div>}
        </div>
        <div className="agent-list">{agents.map((a) => (
          <div className="agent" key={a.id} onClick={() => setSelected(a.id)}>
            <div className="agent-top"><div className="agent-name">{a.emoji} {a.name} · {a.role}</div><div className="badge">{a.status}</div></div>
            <div className="task">{a.task}</div><div className="progress"><span style={{ width: `${a.progress}%` }} /></div>
          </div>
        ))}</div>
        {plan && <div className="artifact"><div style={{ fontWeight: 700, fontSize: 13 }}>🧠 Raka — Manager Plan</div><div className="muted" style={{ marginTop: 6 }}>{plan.summary}</div>{plan.tasks.map((t) => <div key={t.agent} style={{ marginTop: 10, fontSize: 12 }}><b>{t.agent.toUpperCase()}</b><br />{t.task}<br /><span className="muted">Deliverable: {t.deliverable}</span></div>)}</div>}
        <div className="artifact"><div style={{ fontWeight: 700, fontSize: 13 }}>Selected agent</div><div className="muted" style={{ marginTop: 6 }}>{selectedAgent.name} · {selectedAgent.role} · {selectedAgent.task}</div></div>
        {artifact && <div className="artifact"><div style={{ fontWeight: 700, fontSize: 13 }}>📦 Project artifact</div><pre>{artifact}</pre></div>}
      </aside>
    </main>
  );
}
