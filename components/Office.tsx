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
type ApprovalRequestItem = { id: string; taskId: string; from: string; actionType: string; description: string; status: "pending" | "approved" | "rejected" };
type DeliveryConfig = { repoUrl: string; branch: string; };
type SavedProject = { project: string; history: ProjectHistory[]; plan: ManagerPlan | null; artifacts: Artifact[]; artifact: string; aiModel: string; tokenUsage: TokenUsage; requests: ApprovalRequestItem[]; delivery: DeliveryConfig };
type TokenUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
type ProjectFile = { path: string; content: string };
type Artifact = { taskId: string; agentId: string; title: string; content: string; status: "working" | "done" | "error"; model?: string; usage?: TokenUsage };
type EmployeeInfo = { id: string; name: string; role: string; provider_name: string | null; model_id: string | null };

type PlanTask = {
  id: string;
  title: string;
  agentId: string;
  deliverable: string;
  priority: string;
  dependsOn: number[];
  status: string;
};

type ManagerPlan = {
  summary: string;
  tasks: PlanTask[];
};

const STORAGE_KEY = "kai-office-project-v2";

const initialAgents: Agent[] = [
  { id: "raka", name: "Raka", role: "Project Manager", emoji: "👨‍💼", status: "idle", progress: 0, task: "Menunggu proyek", position: [-4.2, .45, -2.5] },
  { id: "sinta", name: "Sinta", role: "UI-UX Designer", emoji: "🎨", status: "idle", progress: 0, task: "Menunggu proyek", position: [-2.1, .45, -2.5] },
  { id: "andi", name: "Andi", role: "Software Developer", emoji: "💻", status: "idle", progress: 0, task: "Menunggu proyek", position: [0, .45, -2.5] },
  { id: "dina", name: "Dina", role: "Content Writer", emoji: "✍️", status: "idle", progress: 0, task: "Menunggu proyek", position: [2.1, .45, -2.5] },
  { id: "bima", name: "Bima", role: "QA Engineer", emoji: "🧪", status: "idle", progress: 0, task: "Menunggu proyek", position: [4.2, .45, -2.5] },
  { id: "maya", name: "Maya", role: "Data Analyst", emoji: "📊", status: "idle", progress: 0, task: "Menunggu proyek", position: [-4.2, .45, -.5] },
  { id: "dimas", name: "Dimas", role: "DevOps Engineer", emoji: "🚀", status: "idle", progress: 0, task: "Menunggu proyek", position: [-2.1, .45, -.5] },
  { id: "nadia", name: "Nadia", role: "Researcher", emoji: "🔍", status: "idle", progress: 0, task: "Menunggu proyek", position: [0, .45, -.5] },
  { id: "fajar", name: "Fajar", role: "Security Engineer", emoji: "🔐", status: "idle", progress: 0, task: "Menunggu proyek", position: [2.1, .45, -.5] },
  { id: "lila", name: "Lila", role: "Operations Coordinator", emoji: "🗂️", status: "idle", progress: 0, task: "Menunggu proyek", position: [4.2, .45, -.5] }
];

const EMP_META: Record<string, { emoji: string; name: string }> = Object.fromEntries(
  initialAgents.map((a) => [a.id, { emoji: a.emoji, name: a.name }])
);
const empName = (id: string) => EMP_META[id]?.name || id;
const empEmoji = (id: string) => EMP_META[id]?.emoji || "🤖";
const agentKnown = (id: string) => initialAgents.some((a) => a.id === id);

const loungePositions: Record<string, [number, number, number]> = Object.fromEntries(
  initialAgents.filter((a) => a.id !== "raka").map((a) => [a.id, a.position])
);

function mergeUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  if (!a) return b;
  if (!b) return a;
  const sum = (x?: number, y?: number) => (x || 0) + (y || 0);
  return {
    prompt_tokens: sum(a.prompt_tokens, b.prompt_tokens),
    completion_tokens: sum(a.completion_tokens, b.completion_tokens),
    total_tokens: sum(a.total_tokens, b.total_tokens)
  };
}

function buildProjectFiles(items: Artifact[]): ProjectFile[] {
  return items
    .filter((a) => a.status === "done" && a.content.trim())
    .map((a, i) => {
      const trimmed = a.content.trim();
      const isHtml = trimmed.includes("<html") || trimmed.startsWith("<");
      const short = a.taskId.replace(/-/g, "").slice(0, 8) || `t${i + 1}`;
      if (isHtml) return { path: `index-${short}.html`, content: a.content };
      const slug = a.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || `artifact-${i + 1}`;
      return { path: `${slug}-${short}.md`, content: a.content };
    });
}

function Employee({ agent, selected, onClick }: { agent: Agent; selected: boolean; onClick: () => void }) {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const avatarColor: Record<string, string> = {
    raka: "#6c8cff",
    sinta: "#d16cff",
    andi: "#4dd4a8",
    dina: "#f0b45c",
    bima: "#63b7ff",
    maya: "#e86c9a",
    dimas: "#7dd87d",
    nadia: "#ffd166",
    fajar: "#9b8cff",
    lila: "#6cd4e8"
  };

  const lounge = loungePositions[agent.id] || agent.position;
  const target = agent.id === "raka" || agent.status === "working" || agent.status === "review"
    ? agent.position
    : lounge;

  useFrame(({ clock }) => {
    if (!group) return;
    const dx = target[0] - group.position.x;
    const dz = target[2] - group.position.z;
    const distance = Math.hypot(dx, dz);
    const speed = agent.status === "working" || agent.status === "review" ? 0.075 : 0.055;

    if (distance > 0.02) {
      group.position.x += dx * speed;
      group.position.z += dz * speed;
    }

    const walking = distance > 0.16;
    group.position.y = agent.position[1] + (walking ? Math.sin(clock.elapsedTime * 10) * .035 : Math.sin(clock.elapsedTime * 2) * .008);
    group.rotation.y = Math.atan2(dx, dz);

    (group.userData as { initialized?: boolean }).initialized = true;
  });

  const currentPosition = group?.position;
  const atDesk = currentPosition ? Math.hypot(currentPosition.x - agent.position[0], currentPosition.z - agent.position[2]) < .22 : false;
  const walking = !atDesk && agent.id !== "raka";

  return (
    <group ref={setGroup} position={agent.position} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[1.35, .14, .75]} />
        <meshStandardMaterial color={selected ? "#7ba7ff" : "#273243"} />
      </mesh>
      <mesh position={[0, .35, -.58]}>
        <boxGeometry args={[.72, .08, .62]} />
        <meshStandardMaterial color="#3b2f2a" />
      </mesh>
      <mesh position={[0, .18, -.78]}>
        <boxGeometry args={[.72, .12, .55]} />
        <meshStandardMaterial color="#2a3038" />
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
        seated={atDesk && !walking && agent.id !== "raka"}
        talking={selected && (agent.status === "working" || agent.status === "review")}
      />
    </group>
  );
}

function OfficeScene({ agents, selected, setSelected }: { agents: Agent[]; selected: string; setSelected: (id: string) => void }) {
  return (
    <>
      <PerspectiveCamera makeDefault position={[11, 12, 14]} fov={50} />
      <OrbitControls enablePan={false} minDistance={7} maxDistance={20} target={[0, 0, 0]} />
      <ambientLight intensity={2.2} /><directionalLight position={[4, 9, 4]} intensity={3} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.05, 0]}><planeGeometry args={[14, 10]} /><meshStandardMaterial color="#b99572" /></mesh>
      <mesh position={[0, 1.45, -4]}><boxGeometry args={[14, 2.8, .12]} /><meshStandardMaterial color="#6f6258" /></mesh>
      <mesh position={[-5.45, 1.45, 0]}><boxGeometry args={[.12, 2.8, 10]} /><meshStandardMaterial color="#65584f" /></mesh>
      <mesh position={[5.45, 1.45, 0]}><boxGeometry args={[.12, 2.8, 8]} /><meshStandardMaterial color="#65584f" /></mesh>
      <mesh position={[0, .8, 3]}><boxGeometry args={[3.2, .16, 1.1]} /><meshStandardMaterial color="#563f32" /></mesh>
      <Text position={[0, .95, 3]} rotation={[-Math.PI / 2, 0, 0]} fontSize={.24} color="#ded0c2" anchorX="center">MEETING</Text>
      {agents.map((a) => <Employee key={a.id} agent={a} selected={selected === a.id} onClick={() => setSelected(a.id)} />)}
    </>
  );
}

export default function Office() {
  const [agents, setAgents] = useState(initialAgents);
  const [selected, setSelected] = useState("raka");
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [artifact, setArtifact] = useState("");
  const [plan, setPlan] = useState<ManagerPlan | null>(null);
  const [error, setError] = useState("");
  const [sidebar, setSidebar] = useState<"history" | "tokens" | "ai" | "requests" | "delivery" | "workspace" | null>(null);
  const [requests, setRequests] = useState<ApprovalRequestItem[]>([]);
  const [delivery, setDelivery] = useState<DeliveryConfig>({ repoUrl: "", branch: "main" });
  const [history, setHistory] = useState<ProjectHistory[]>([]);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>(null);
  const [aiModel, setAiModel] = useState("—");
  const [adminToken, setAdminToken] = useState<string>(() => {
    try { return sessionStorage.getItem("kai-admin-token") || ""; } catch { return ""; }
  });
  const [agentSearch, setAgentSearch] = useState("");
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<"overview" | "artifacts" | "preview" | "activity">("overview");
  const [retryingAgent, setRetryingAgent] = useState<string | null>(null);
  const [pushState, setPushState] = useState<"idle" | "confirm" | "requesting" | "waiting" | "pushing" | "done" | "error">("idle");
  const [pushApprovalId, setPushApprovalId] = useState<string | null>(null);
  const [pushMessage, setPushMessage] = useState("");
  const [employees, setEmployees] = useState<EmployeeInfo[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);

  const authHeaders = (): Record<string, string> => adminToken
    ? { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }
    : { "Content-Type": "application/json" };

  useEffect(() => {
    try { sessionStorage.setItem("kai-admin-token", adminToken); } catch { /* sessionStorage unavailable */ }
  }, [adminToken]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const data = JSON.parse(saved);
      if (!data || typeof data !== "object") return;
      setPrompt(typeof data.project === "string" ? data.project : "");
      setHistory(Array.isArray(data.history) ? data.history : []);
      setPlan(data.plan && typeof data.plan === "object" ? data.plan : null);
      setArtifacts(Array.isArray(data.artifacts) ? data.artifacts : []);
      setArtifact(typeof data.artifact === "string" ? data.artifact : "");
      setAiModel(typeof data.aiModel === "string" ? data.aiModel : "—");
      setTokenUsage(data.tokenUsage || null);
      setRequests(Array.isArray(data.requests) ? data.requests : []);
      setDelivery(data.delivery && typeof data.delivery === "object" ? data.delivery : { repoUrl: "", branch: "main" });
      if (Array.isArray(data.artifacts) && data.artifacts.length) { setWorkspaceOpen(true); setSidebar("workspace"); }
    } catch {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    if (!prompt.trim() && !history.length && !artifacts.length) return;
    const saved: SavedProject = { project: prompt.trim(), history, plan, artifacts, artifact, aiModel, tokenUsage, requests, delivery };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* storage full or unavailable */ }
  }, [prompt, history, plan, artifacts, artifact, aiModel, tokenUsage, requests, delivery]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/office/status", { cache: "no-store" });
        const data = await response.json();
        if (cancelled || !response.ok || !Array.isArray(data.events)) return;
        const latest = new Map<string, { status: string; eventType: string }>();
        for (const event of data.events) {
          if (event && typeof event.employeeId === "string") latest.set(event.employeeId, event);
        }
        setAgents((current) => current.map((agent) => {
          const event = latest.get(agent.id);
          if (!event) return agent;
          if (event.status === "working") return { ...agent, status: "working", progress: Math.max(agent.progress, 25), task: "Sedang bekerja dari event backend" };
          if (event.status === "failed") return { ...agent, status: "review", task: "Perlu ditinjau: proses backend gagal" };
          if (event.status === "completed" && agent.status === "working") return { ...agent, status: "idle", progress: 100, task: "Respons AI selesai" };
          return agent;
        }));
      } catch { /* The office remains usable if the database is offline. */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (sidebar !== "ai" || !adminToken) return;
    let cancelled = false;
    setEmployeesLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/employees", { headers: authHeaders(), cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(data.employees)) {
          setEmployees(data.employees.map((e: { id: unknown; name: unknown; role: unknown; provider_name: unknown; model_id: unknown }) => ({
            id: String(e.id), name: String(e.name), role: String(e.role || ""),
            provider_name: e.provider_name != null ? String(e.provider_name) : null,
            model_id: e.model_id != null ? String(e.model_id) : null
          })));
        }
      } catch { /* keep previous list */ }
      finally { if (!cancelled) setEmployeesLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [sidebar, adminToken]);

  const updateAgent = (id: string, patch: Partial<Agent>) => setAgents((cur) => cur.map((x) => x.id === id ? { ...x, ...patch } : x));

  async function readApiResponse(response: Response) {
    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(text?.slice(0, 500) || `Server mengembalikan respons yang tidak valid (HTTP ${response.status}).`);
    }
    if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : `Request gagal (HTTP ${response.status}).`);
    return data;
  }

  const pushApprovalRequest = (from: string, taskId: string, ar: { actionType?: unknown; description?: unknown }) => {
    const item: ApprovalRequestItem = {
      id: `${taskId}-${Date.now()}`, taskId, from,
      actionType: String(ar.actionType || "tindakan sensitif"),
      description: String(ar.description || ""), status: "pending"
    };
    setRequests((items) => [...items, item].slice(-20));
  };

  const runProject = async () => {
    if (!prompt.trim() || running) return;
    if (!adminToken) { setError("Masukkan KAI_ADMIN_TOKEN dulu."); return; }
    setRunning(true); setError(""); setPlan(null); setArtifact(""); setArtifacts([]); setRequests([]); setTokenUsage(null);
    setWorkspaceOpen(true); setSidebar("workspace"); setWorkspaceTab("overview");
    setAgents((cur) => cur.map((x) => ({ ...x, status: x.id === "raka" ? "working" : "idle", progress: x.id === "raka" ? 10 : 0, task: x.id === "raka" ? "Raka sedang menganalisis proyek..." : "Menunggu Manager" })));
    const doneIdx = new Set<number>();
    let completedCount = 0;
    try {
      const res = await fetch("/api/manager", { method: "POST", headers: authHeaders(), body: JSON.stringify({ project: prompt.trim() }) });
      const data = await readApiResponse(res);
      const rawTasks: unknown[] = Array.isArray(data.tasks) ? data.tasks : [];
      const tasks: PlanTask[] = rawTasks.map((t) => {
        const rt = t as Record<string, unknown>;
        return {
          id: String(rt.id),
          title: String(rt.title || "Tugas"),
          agentId: String(rt.agentId || ""),
          deliverable: String(rt.deliverable || ""),
          priority: String(rt.priority || "normal"),
          dependsOn: Array.isArray(rt.dependsOn)
            ? (rt.dependsOn as unknown[]).filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) < rawTasks.length)
            : [],
          status: String(rt.status || "queued")
        };
      });
      const projectSummary = String((data.project as Record<string, unknown> | undefined)?.summary || data.summary || "");
      setPlan({ summary: projectSummary, tasks });
      setAiModel(typeof data.model === "string" ? data.model : "—");
      setHistory((items) => [
        { project: prompt.trim(), time: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }), status: "Selesai" },
        ...items
      ].slice(0, 12));
      updateAgent("raka", { status: "idle", progress: 100, task: "Rencana proyek selesai" });
      const total = tasks.length;

      const runTask = async (task: PlanTask, index: number, wave: number) => {
        if (agentKnown(task.agentId)) setSelected(task.agentId);
        updateAgent(task.agentId, { status: "working", progress: 30, task: `Gelombang ${wave} — ${task.title}` });
        setArtifacts((items) => [...items.filter((a) => a.taskId !== task.id), { taskId: task.id, agentId: task.agentId, title: task.title, content: "", status: "working" }]);
        try {
          const taskRes = await fetch(`/api/tasks/${task.id}/run`, { method: "POST", headers: authHeaders(), body: "{}" });
          const taskData = await readApiResponse(taskRes);
          if (taskData.approvalRequested && typeof taskData.approvalRequested === "object") {
            pushApprovalRequest(task.agentId, task.id, taskData.approvalRequested as { actionType?: unknown; description?: unknown });
          }
          setTokenUsage((cur) => mergeUsage(cur, (taskData.usage || null) as TokenUsage));
          const content = typeof taskData.artifact === "string" && taskData.artifact.trim()
            ? taskData.artifact
            : "Agent tidak mengembalikan artifact.";
          setArtifacts((items) => items.map((a) => a.taskId === task.id
            ? { ...a, content, model: typeof taskData.model === "string" ? taskData.model : undefined, usage: (taskData.usage || null) as TokenUsage, status: "done" }
            : a));
          setPlan((cur) => cur ? { ...cur, tasks: cur.tasks.map((t) => t.id === task.id ? { ...t, status: String(taskData.status || "testing") } : t) } : cur);
          completedCount++;
          updateAgent(task.agentId, {
            progress: Math.round((completedCount / Math.max(total, 1)) * 100),
            status: "idle",
            task: `Selesai: ${task.title.slice(0, 80)}${taskData.approvalRequested ? " (menunggu persetujuan)" : ""}`
          });
        } catch (taskError) {
          const message = taskError instanceof Error ? taskError.message : "Agent gagal.";
          setArtifacts((items) => items.map((a) => a.taskId === task.id ? { ...a, content: message, status: "error" } : a));
          setPlan((cur) => cur ? { ...cur, tasks: cur.tasks.map((t) => t.id === task.id ? { ...t, status: "failed" } : t) } : cur);
          updateAgent(task.agentId, { progress: 100, status: "idle", task: `Gagal: ${message.slice(0, 140)}` });
        } finally {
          doneIdx.add(index);
        }
      };

      let wave = 0;
      while (doneIdx.size < total) {
        const runnable: Array<{ task: PlanTask; index: number }> = [];
        tasks.forEach((t, i) => {
          if (!doneIdx.has(i) && t.dependsOn.every((d) => doneIdx.has(d))) runnable.push({ task: t, index: i });
        });
        if (!runnable.length) {
          setError(`Deadlock dependensi: ${total - doneIdx.size} tugas tidak dapat dijalankan karena dependensinya tidak selesai.`);
          break;
        }
        wave++;
        await Promise.all(runnable.slice(0, 4).map(({ task, index }) => runTask(task, index, wave)));
      }

      setWorkspaceTab("artifacts");
      setArtifact(`PROJECT: ${prompt.trim()}

MANAGER SUMMARY:
${projectSummary}

STATUS: ${doneIdx.size}/${total} tugas dieksekusi dalam ${wave} gelombang.
`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Terjadi error.";
      setError(message);
      setAgents((cur) => cur.map((x) => ({ ...x, status: "idle", task: x.id === "raka" ? "Gagal menjalankan proyek" : "Menunggu Manager" })));
    } finally { setRunning(false); }
  };

  const retryAgent = async (taskId: string) => {
    const task = plan?.tasks.find((t) => t.id === taskId);
    if (!task || retryingAgent || running) return;
    if (!adminToken) { setError("Masukkan KAI_ADMIN_TOKEN dulu."); return; }
    setRetryingAgent(taskId);
    if (agentKnown(task.agentId)) setSelected(task.agentId);
    updateAgent(task.agentId, { status: "working", progress: 30, task: `Mengulang: ${task.title}` });
    setArtifacts((items) => items.map((a) => a.taskId === taskId ? { ...a, content: "", status: "working" } : a));
    try {
      const res = await fetch(`/api/tasks/${taskId}/run`, { method: "POST", headers: authHeaders(), body: "{}" });
      const data = await readApiResponse(res);
      if (data.approvalRequested && typeof data.approvalRequested === "object") {
        pushApprovalRequest(task.agentId, taskId, data.approvalRequested as { actionType?: unknown; description?: unknown });
      }
      setTokenUsage((cur) => mergeUsage(cur, (data.usage || null) as TokenUsage));
      const content = typeof data.artifact === "string" && data.artifact.trim()
        ? data.artifact
        : "Agent tidak mengembalikan artifact.";
      setArtifacts((items) => items.map((a) => a.taskId === taskId
        ? { ...a, content, model: typeof data.model === "string" ? data.model : undefined, usage: (data.usage || null) as TokenUsage, status: "done" }
        : a));
      setPlan((cur) => cur ? { ...cur, tasks: cur.tasks.map((t) => t.id === taskId ? { ...t, status: String(data.status || "testing") } : t) } : cur);
      updateAgent(task.agentId, { progress: 100, status: "idle", task: "Perbaikan selesai" });
      setWorkspaceTab("artifacts");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Agent gagal diperbaiki.";
      setArtifacts((items) => items.map((a) => a.taskId === taskId ? { ...a, content: message, status: "error" } : a));
      updateAgent(task.agentId, { progress: 100, status: "idle", task: `Gagal: ${message.slice(0, 140)}` });
    } finally {
      setRetryingAgent(null);
    }
  };

  const selectedAgent = agents.find((a) => a.id === selected) || agents[0];
  const projectFiles = useMemo(() => buildProjectFiles(artifacts), [artifacts]);
  const previewArtifact = artifacts.find((a) => a.status === "done" && (a.content.includes("<html") || a.content.trimStart().startsWith("<")));

  const requestPushApproval = async () => {
    if (!adminToken) { setPushMessage("Masukkan KAI_ADMIN_TOKEN dulu."); setPushState("error"); return; }
    if (!projectFiles.length || !delivery.repoUrl.trim()) { setPushState("error"); setPushMessage("Isi URL repository dulu."); return; }
    setPushState("requesting");
    setPushMessage("");
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          actionType: "github_push",
          description: `Push ${projectFiles.length} file ke ${delivery.repoUrl.trim()} branch ${delivery.branch.trim() || "main"}`,
          payload: { repoUrl: delivery.repoUrl.trim(), branch: delivery.branch.trim() || "main" }
        })
      });
      const data = await readApiResponse(res);
      const approval = data.approval as Record<string, unknown> | undefined;
      setPushApprovalId(approval && typeof approval.id === "string" ? approval.id : null);
      setPushState("waiting");
    } catch (e) {
      setPushState("error");
      setPushMessage(e instanceof Error ? e.message : "Gagal membuat permintaan persetujuan.");
    }
  };

  const publishProject = async () => {
    if (!projectFiles.length || !delivery.repoUrl.trim() || pushState === "pushing") return;
    if (!adminToken) { setPushMessage("Masukkan KAI_ADMIN_TOKEN dulu."); setPushState("error"); return; }
    if (!pushApprovalId) { setPushState("error"); setPushMessage("Belum ada persetujuan. Minta persetujuan dulu, lalu setujui di /control."); return; }
    setPushState("pushing");
    setPushMessage("");
    try {
      const response = await fetch("/api/github/push", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          repoUrl: delivery.repoUrl.trim(),
          branch: delivery.branch.trim() || "main",
          message: `feat: publish KAI project — ${prompt.trim().slice(0, 60)}`,
          files: projectFiles,
          approvalId: pushApprovalId
        })
      });
      const data = await readApiResponse(response);
      setPushState("done");
      setPushApprovalId(null);
      setPushMessage(`Berhasil push ${typeof data.files === "number" ? data.files : projectFiles.length} file ke ${String(data.repo || "?")}/${String(data.branch || "?")}.`);
      setHistory((items) => [{
        project: prompt.trim(),
        time: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
        status: "Pushed ke GitHub"
      }, ...items].slice(0, 12));
    } catch (e) {
      setPushState("error");
      setPushMessage(e instanceof Error ? e.message : "Push ke GitHub gagal.");
    }
  };

  const downloadProjectZip = () => {
    if (!projectFiles.length) return;
    const crcTable = (() => {
      const table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); table[n] = c >>> 0; }
      return table;
    })();
    const crc32 = (bytes: Uint8Array) => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunks: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    const enc = new TextEncoder();
    const u16 = (v: number) => { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, v, true); return a; };
    const u32 = (v: number) => { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, v >>> 0, true); return a; };
    const join = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let p = 0; for (const part of parts) { out.set(part, p); p += part.length; } return out; };
    for (const file of projectFiles) {
      const name = enc.encode(file.path.replace(/^\/+/, ""));
      const data = enc.encode(file.content);
      const crc = crc32(data);
      const local = join(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data);
      chunks.push(local);
      const entry = join(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name);
      central.push(entry); offset += local.length;
    }
    const centralSize = central.reduce((n, p) => n + p.length, 0);
    const centralOffset = offset;
    const end = join(u32(0x06054b50), u16(0), u16(0), u16(projectFiles.length), u16(projectFiles.length), u32(centralSize), u32(centralOffset), u16(0));
    const zip = join(...chunks, ...central, end);
    const blob = new Blob([zip], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "kai-artifacts.zip"; a.click();
    URL.revokeObjectURL(url);
  };

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
      <div className="side-empty">Data berasal dari respons provider AI, diagregasi per tugas.</div>
    </>
  ) : sidebar === "ai" ? (
    <>
      <div className="side-title">AI Model / 9Router</div>
      {!adminToken ? (
        <div className="side-warning">Masukkan KAI_ADMIN_TOKEN di panel kanan untuk melihat konfigurasi provider & model tiap karyawan.</div>
      ) : employeesLoading ? (
        <div className="side-empty">Mengambil konfigurasi karyawan dari server...</div>
      ) : employees.length ? (
        <>
          {employees.map((e) => (
            <div className="side-item" key={e.id}>
              <b>{empEmoji(e.id)} {e.name} · {e.role}</b>
              <span>{e.provider_name || "—"}</span>
              <small>{e.model_id || "belum dikonfigurasi"}</small>
            </div>
          ))}
          <a className="side-action" href="/control" style={{ textDecoration: "none", display: "block", textAlign: "center" }}>Ubah di Provider & Agent Control →</a>
        </>
      ) : <div className="side-empty">Belum ada data karyawan dari server.</div>}
      <div className="side-warning">Konfigurasi provider & model disimpan di database server, bukan di browser.</div>
    </>
  ) : sidebar === "requests" ? (
    <>
      <div className="side-title">Permintaan Persetujuan AI</div>
      {requests.length ? requests.map((r) => (
        <div className="side-item" key={r.id}>
          <b>🤖 {empName(r.from)} meminta persetujuan</b>
          <span>{r.actionType}</span>
          <small>{r.description}</small>
          <a className="side-action" href="/control" style={{ textDecoration: "none", display: "block", textAlign: "center" }}>Setujui di /control →</a>
        </div>
      )) : <div className="side-empty">Belum ada permintaan persetujuan. Jika karyawan AI meminta tindakan sensitif, permintaannya akan muncul di sini.</div>}
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
        {workspaceTab === "overview" && <div className="workspace-grid"><div className="workspace-card hero"><span>AI COMPANY CONTROL CENTER</span><strong>{running ? "Team is working..." : artifacts.length ? "Work completed" : "Ready to start"}</strong><p>Raka mengorkestrasi {agents.length - 1} spesialis. Pekerjaan dijalankan dalam gelombang dependensi (maks 4 paralel), hasil masuk ke Workspace, lalu bisa Preview, ZIP, atau Push ke GitHub.</p><button className="primary" onClick={() => setWorkspaceTab("artifacts")}>Lihat Hasil Pekerjaan →</button></div>{agents.filter(a => a.id !== "raka").map(a => <div className="workspace-card" key={a.id}><b>{a.emoji} {a.name}</b><span>{a.role}</span><p>{a.task}</p><div className="mini-progress"><i style={{width: `${a.progress}%`}} /></div></div>)}</div>}
        {workspaceTab === "artifacts" && <div className="artifact-grid">
          {projectFiles.length > 0 && <div className="workspace-actions" style={{ gridColumn: "1 / -1" }}>
            <button className="primary" onClick={() => setWorkspaceTab("preview")}>▶ Preview Project</button>
            <button className="side-action" onClick={downloadProjectZip}>📦 Unduh artefak (.zip)</button>
            <button className="primary" disabled={!delivery.repoUrl.trim() || pushState === "pushing"} onClick={() => { setSidebar("delivery"); setPushState("confirm"); }}>🚀 Push ke GitHub</button>
          </div>}
          {artifacts.map(a => <article className="result-card" key={a.taskId}><div className="result-top"><b>{a.agentId.toUpperCase()}</b><span className={a.status}>{a.status}</span></div><h3>{a.title}</h3>{a.model && <div className="muted" style={{ fontSize: 11 }}>Model: {a.model}</div>}<pre>{a.content || "Sedang dikerjakan oleh AI..."}</pre>{a.status === "error" && <button className="primary repair-btn" disabled={retryingAgent === a.taskId || running} onClick={() => retryAgent(a.taskId)}>{retryingAgent === a.taskId ? "Memperbaiki..." : "↻ Perbaiki Ulang"}</button>}</article>)}
          {!artifacts.length && <div className="side-empty">Belum ada artifact.</div>}
        </div>}
        {workspaceTab === "preview" && <div className="preview-card"><div className="preview-bar"><span>AI PROJECT PREVIEW</span><span>{previewArtifact ? "READY" : "NO BUILD"}</span></div>{previewArtifact ? <iframe title="AI project preview" sandbox="allow-scripts" srcDoc={previewArtifact.content} style={{width:"100%",minHeight:520,border:0,borderRadius:14,background:"#fff"}} /> : <div className="side-empty">Belum ada artifact HTML. Jalankan project sampai ada karyawan yang menghasilkan halaman web.</div>}</div>}
        {workspaceTab === "activity" && <div className="activity-list"><div>🧠 Raka membuat project plan</div>{artifacts.map(a => <div key={a.taskId}>{a.status === "done" ? "✅" : a.status === "error" ? "❌" : "⏳"} {a.agentId.toUpperCase()} — {a.title}</div>)}</div>}
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
        <b>🚀 Publish dengan persetujuan</b>
        <span>Artefak dikemas → kamu klik Push → permintaan persetujuan dibuat → kamu setujui di /control → baru commit dibuat di GitHub.</span>
      </div>
      {projectFiles.length > 0 && <div className="side-item"><b>📄 {projectFiles.length} file siap dikirim</b><span>{projectFiles.slice(0, 5).map(f => f.path).join(" · ")}{projectFiles.length > 5 ? " · ..." : ""}</span></div>}
      <div className="side-warning">GitHub token hanya boleh disimpan sebagai GITHUB_TOKEN di environment server. Jangan tempel token di kolom Repository.</div>
      {pushState === "confirm" && <div className="confirm-card"><b>Push project ke GitHub?</b><span>{projectFiles.length} file akan ditulis ke <strong>{delivery.repoUrl || "repository"}</strong> branch <strong>{delivery.branch || "main"}</strong>. Langkah pertama: buat permintaan persetujuan.</span><div className="workspace-actions"><button className="primary" onClick={requestPushApproval}>Ya, Minta Persetujuan</button><button className="side-action" onClick={() => setPushState("idle")}>Batal</button></div></div>}
      {pushState === "requesting" && <div className="side-item"><b>⏳ Membuat permintaan persetujuan...</b></div>}
      {pushState === "waiting" && <div className="side-item"><b>⏳ Menunggu persetujuan di /control</b><span>Permintaan push sudah dibuat. Setujui di <a href="/control">/control</a>, lalu klik Push di bawah.</span><div className="workspace-actions"><button className="primary" onClick={publishProject}>Sudah disetujui — Push Sekarang</button><button className="side-action" onClick={() => { setPushState("idle"); setPushApprovalId(null); }}>Batal</button></div></div>}
      {pushState === "pushing" && <div className="side-item"><b>⏳ Publishing...</b><span>Commit sedang dibuat.</span></div>}
      {pushState === "done" && <div className="side-item"><b>✅ GitHub berhasil</b><span>{pushMessage}</span></div>}
      {pushState === "error" && <div className="error-box">{pushMessage}</div>}
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
        <a className="side-btn" href="/control" style={{ textDecoration: "none" }}><span>⚙</span>Provider & Agent Control</a>
      </nav>
      {sidebar && <aside className="sidebar-drawer"><button className="drawer-close" onClick={() => setSidebar(null)}>×</button>{sidebarContent}</aside>}
      <section className="scene">
        <div className="hud"><div className="brand">AI OFFICE / LIVE AGENTS</div><div className="live"><i /> REAL AI MANAGER</div></div>
        <div className="canvas-wrap"><Canvas><color attach="background" args={["#0b1017"]} /><OfficeScene agents={agents} selected={selected} setSelected={setSelected} /></Canvas></div>
      </section>
      <aside className="panel">
        <h1>AI Office</h1>
        <div className="muted">Masukkan proyek dan KAI_ADMIN_TOKEN. Raka membagi pekerjaan ke 10 karyawan AI dan menjalankannya dalam gelombang dependensi.</div>
        <label className="field-label">KAI_ADMIN_TOKEN
          <input type="password" className="side-input" value={adminToken} onChange={(e) => setAdminToken(e.target.value)} placeholder="Tempel token admin backend" autoComplete="off" />
        </label>
        {!adminToken && <div className="side-warning">Token admin wajib untuk menjalankan project & push GitHub. Token hanya disimpan di sessionStorage, bukan localStorage.</div>}
        <div className="project">
          <div style={{ fontWeight: 700, fontSize: 13 }}>New project · AI Team Orchestrator</div><div className="quick-prompts"><button onClick={() => setPrompt("Buat landing page bisnis modern lengkap dengan responsive UI, SEO, form kontak, dan dokumentasi.")}>🌐 Website</button><button onClick={() => setPrompt("Buat aplikasi dashboard SaaS dengan auth, database, billing, admin panel, dan API.")}>📊 SaaS</button><button onClick={() => setPrompt("Buat aplikasi mobile dengan API, autentikasi, offline state, dan dokumentasi.")}>📱 Mobile</button></div>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Contoh: Buat landing page Nexora Design untuk UMKM Indonesia..." />
          <button className="primary" onClick={runProject} disabled={!prompt.trim() || running}>{running ? "Raka sedang bekerja..." : "START PROJECT"}</button>
          {!running && projectFiles.length > 0 && <div className="project-ready"><b>✅ Project file siap</b><span>{projectFiles.length} file dari artefak AI. Buka Workspace untuk Preview, ZIP, atau Push ke GitHub.</span><button className="side-action" onClick={() => { setSidebar("workspace"); setWorkspaceOpen(true); setWorkspaceTab("preview"); }}>Buka Preview →</button></div>}
          {error && <div className="error-box">{error}</div>}
        </div>
        <div className="team-stats"><div><b>{agents.length}</b><span>AI Employees</span></div><div><b>{agents.filter(a => a.status === "working" || a.status === "review").length}</b><span>Working</span></div><div><b>{artifacts.filter(a => a.status === "done").length}</b><span>Artifacts</span></div></div>
        <input className="agent-search" value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)} placeholder="Cari karyawan atau divisi..." />
        <div className="agent-list">{agents.filter((a) => `${a.name} ${a.role}`.toLowerCase().includes(agentSearch.toLowerCase())).map((a) => (
          <div className="agent" key={a.id} onClick={() => setSelected(a.id)}>
            <div className="agent-top"><div className="agent-name">{a.emoji} {a.name} · {a.role}</div><div className="badge">{a.status}</div></div>
            <div className="task">{a.task}</div><div className="progress"><span style={{ width: `${a.progress}%` }} /></div>
          </div>
        ))}</div>
        {plan && <div className="artifact"><div style={{ fontWeight: 700, fontSize: 13 }}>🧠 Raka — Manager Plan</div><div className="muted" style={{ marginTop: 6 }}>{plan.summary}</div>{plan.tasks.map((t) => <div key={t.id} style={{ marginTop: 10, fontSize: 12 }}><b>{t.agentId.toUpperCase()}</b> <span className="badge">{t.status}</span><br />{t.title}<br /><span className="muted">Deliverable: {t.deliverable}</span></div>)}</div>}
        <div className="artifact"><div style={{ fontWeight: 700, fontSize: 13 }}>Selected agent</div><div className="muted" style={{ marginTop: 6 }}>{selectedAgent.name} · {selectedAgent.role} · {selectedAgent.task}</div></div>
        {artifact && <div className="artifact"><div style={{ fontWeight: 700, fontSize: 13 }}>📦 Project artifact</div><pre>{artifact}</pre></div>}
      </aside>
    </main>
  );
}
