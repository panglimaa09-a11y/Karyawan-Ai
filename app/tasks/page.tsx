"use client";
import { useCallback, useEffect, useState } from "react";

type Project = { id: string; name: string; status: string; task_count: number; completed_count: number; active_count: number; approval_count: number; attention_count: number };
type Task = { id: string; project_id: string; project_name: string; title: string; status: string; priority: string; assigned_employee_id: string | null; employee_name: string | null; dependency_count: string; artifact_count: string; created_at: string };
type TaskDetail = { task: any; dependencies: any[]; assignments: any[]; artifacts: any[]; approvals: any[]; toolRuns: any[] };

const css = `*{box-sizing:border-box}body{margin:0;background:#080d15;color:#edf3fb;font-family:Inter,system-ui,Arial}button,input,select,textarea{font:inherit}button{cursor:pointer}.wrap{max-width:1200px;margin:auto;padding:24px}.muted{color:#91a0b3;font-size:13px}.card{background:#0e1622;border:1px solid #263449;border-radius:16px;padding:18px;margin:14px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.field{display:grid;gap:6px;margin:10px 0}.field label{font-size:12px;color:#a9b7c9}.field input,.field select,.field textarea{background:#080d15;color:#edf3fb;border:1px solid #34435a;border-radius:9px;padding:10px;width:100%}.btn{background:#dce9ff;color:#0a1423;border:0;border-radius:9px;padding:9px 12px;font-weight:700;margin:4px 4px 4px 0;font-size:13px}.btn.alt{background:#1b2a40;color:#dce9ff;border:1px solid #334760}.btn.danger{background:#4a1d1d;color:#ffd7d7;border:1px solid #6e2b2b}.btn:disabled{opacity:.5;cursor:wait}.status{white-space:pre-wrap;background:#08111b;border-radius:9px;padding:10px;font-size:12px;margin-top:8px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.tag{font-size:11px;background:#1c2b40;padding:5px 8px;border-radius:99px}.tag.ok{background:#123f2e}.tag.warn{background:#4a3a12}.tag.bad{background:#4a1d1d}.tag.info{background:#173a5e}h1{margin-bottom:4px}h2{font-size:18px}.task{border:1px solid #263449;border-radius:12px;padding:12px;margin:8px 0;background:#0b1320}.task b{font-size:14px}.detail{background:#08111b;border:1px solid #263449;border-radius:12px;padding:14px;margin-top:10px;font-size:13px}.detail pre{white-space:pre-wrap;font-size:12px;background:#0b1320;padding:10px;border-radius:8px;max-height:300px;overflow:auto}`;

const STATUS_LABEL: Record<string, string> = { draft: "Draft", queued: "Antrean", planning: "Perencanaan", running: "Berjalan", blocked: "Terblokir", awaiting_approval: "Menunggu Persetujuan", testing: "Pengujian", completed: "Selesai", failed: "Gagal", cancelled: "Dibatalkan" };
const STATUS_CLASS: Record<string, string> = { completed: "ok", failed: "bad", blocked: "bad", awaiting_approval: "warn", running: "info", testing: "info", cancelled: "", queued: "", planning: "", draft: "" };

export default function TasksPage() {
  const [admin, setAdmin] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projectId, setProjectId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");

  const headers = { Authorization: "Bearer " + admin, "Content-Type": "application/json" };
  const call = useCallback(async (path: string, init: RequestInit = {}) => {
    const r = await fetch(path, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    const data = await r.json().catch(() => ({ error: "Respons bukan JSON" }));
    if (!r.ok) throw new Error(data.error || "HTTP " + r.status);
    return data;
  }, [admin]);

  const refresh = useCallback(async () => {
    if (!admin) return;
    const [p, t] = await Promise.all([
      call("/api/projects"),
      call("/api/tasks" + (projectId ? "?projectId=" + projectId : "") + (statusFilter ? (projectId ? "&" : "?") + "status=" + statusFilter : ""))
    ]);
    setProjects(p.projects || []);
    setTasks(t.tasks || []);
  }, [admin, call, projectId, statusFilter]);

  useEffect(() => { if (admin) void refresh().catch((e) => setStatus(e instanceof Error ? e.message : String(e))); }, [admin, refresh]);

  async function action(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (e) { setStatus(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  async function openDetail(id: string) {
    await action(async () => {
      const d = await call("/api/tasks/" + id);
      setDetail(d); setDetailId(id); setEvidence(""); setNote("");
    });
  }

  async function runTask(id: string) {
    await action(async () => {
      const r = await call("/api/tasks/" + id + "/run", { method: "POST", body: "{}" });
      setStatus(`Tugas dijalankan oleh ${r.employee?.name || "?"} (${r.model}). Status: ${r.status}.`);
      if (r.approvalRequested) setStatus((s) => s + ` Meminta persetujuan: ${r.approvalRequested.actionType}.`);
      await refresh(); if (detailId === id) await openDetail(id);
    });
  }

  async function reviewTask(id: string, verdict: "pass" | "fail") {
    await action(async () => {
      if (verdict === "pass" && !evidence.trim()) { setStatus("Verdict lulus wajib menyertakan bukti (evidence)."); return; }
      await call("/api/tasks/" + id + "/review", { method: "POST", body: JSON.stringify({ verdict, evidence, note }) });
      setStatus(`Review tersimpan: ${verdict}.`);
      setEvidence(""); setNote("");
      await refresh(); await openDetail(id);
    });
  }

  async function patchTask(id: string, act: "cancel" | "requeue") {
    await action(async () => {
      await call("/api/tasks/" + id, { method: "PATCH", body: JSON.stringify({ action: act }) });
      setStatus(`Tugas ${act === "cancel" ? "dibatalkan" : "dimasukkan antrean"}.`);
      await refresh(); if (detailId === id) await openDetail(id);
    });
  }

  return (
    <main className="wrap"><style>{css}</style>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><span className="tag">KARYAWAN AI · TASK BOARD</span><h1>Projects & Tasks</h1>
          <p className="muted">Orkestrasi nyata: Raka merencanakan, karyawan mengeksekusi, hasil diverifikasi sebelum Completed.</p></div>
        <div className="row"><a className="tag" href="/">Kantor 3D ↗</a><a className="tag" href="/control">Control Room ↗</a></div>
      </div>

      <section className="card"><h2>1. Token admin</h2>
        <div className="field"><label>KAI_ADMIN_TOKEN (hanya di memori tab ini)</label>
          <input type="password" value={admin} onChange={(e) => setAdmin(e.target.value)} placeholder="Tempel token admin" /></div>
        <button className="btn" disabled={!admin || busy} onClick={() => void refresh()}>Muat data</button>
        <div className="status">{status || "Masukkan token untuk memuat project dan tugas."}</div>
      </section>

      {!!projects.length && (
        <section className="card"><h2>2. Projects ({projects.length})</h2>
          <div className="grid">{projects.map((p) => (
            <div className="task" key={p.id}>
              <b>{p.name}</b>
              <div className="row" style={{ marginTop: 6 }}>
                <span className="tag">{p.task_count} tugas</span>
                {!!p.active_count && <span className="tag info">{p.active_count} aktif</span>}
                {!!p.approval_count && <span className="tag warn">{p.approval_count} menunggu approval</span>}
                {!!p.attention_count && <span className="tag bad">{p.attention_count} perlu perhatian</span>}
                {p.completed_count === p.task_count && p.task_count > 0 && <span className="tag ok">selesai semua</span>}
              </div>
              <div style={{ marginTop: 8 }}><button className="btn alt" disabled={busy} onClick={() => setProjectId(projectId === p.id ? "" : p.id)}>{projectId === p.id ? "Tampilkan semua" : "Filter tugas project ini"}</button></div>
            </div>
          ))}</div>
        </section>
      )}

      <section className="card"><h2>3. Tugas{tasks.length ? ` (${tasks.length})` : ""}</h2>
        <div className="row">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ background: "#080d15", color: "#edf3fb", border: "1px solid #34435a", borderRadius: 9, padding: 9 }}>
            <option value="">Semua status</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="btn alt" disabled={!admin || busy} onClick={() => void refresh()}>Segarkan</button>
        </div>
        {!tasks.length ? <p className="muted">Belum ada tugas. Buat dari Kantor 3D (START PROJECT) atau via POST /api/manager.</p> :
          tasks.map((t) => (
            <div className="task" key={t.id}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b>{t.title}</b>
                <span className={`tag ${STATUS_CLASS[t.status] || ""}`}>{STATUS_LABEL[t.status] || t.status}</span>
              </div>
              <p className="muted">{t.project_name || "—"} · {t.employee_name || "belum ditugaskan"} · prioritas {t.priority} · {t.artifact_count} artefak</p>
              <div className="row">
                <button className="btn" disabled={busy || ["running", "completed", "cancelled"].includes(t.status)} onClick={() => void runTask(t.id)}>▶ Jalankan</button>
                <button className="btn alt" disabled={busy} onClick={() => void openDetail(t.id)}>Detail</button>
                {(t.status === "failed" || t.status === "cancelled" || t.status === "blocked") && <button className="btn alt" disabled={busy} onClick={() => void patchTask(t.id, "requeue")}>↻ Antrekan ulang</button>}
                {!["completed", "cancelled"].includes(t.status) && <button className="btn danger" disabled={busy} onClick={() => void patchTask(t.id, "cancel")}>Batalkan</button>}
              </div>
              {detailId === t.id && detail && (
                <div className="detail">
                  <p className="muted">ID: {detail.task.id}</p>
                  <p>{detail.task.description}</p>
                  {!!detail.task.acceptance_criteria && <p><b>Kriteria penerimaan:</b> {detail.task.acceptance_criteria}</p>}
                  {!!detail.task.result_evidence && <p><b>Bukti:</b> {detail.task.result_evidence}</p>}
                  {!!detail.dependencies.length && <p><b>Dependensi:</b> {detail.dependencies.map((d: any) => `${d.title} (${STATUS_LABEL[d.status] || d.status})`).join(", ")}</p>}
                  {!!detail.artifacts.length && <><b>Artefak ({detail.artifacts.length}):</b>{detail.artifacts.map((a: any) => <pre key={a.id}>📄 {a.title} — v{a.current_version}\n{a.preview}</pre>)}</>}
                  {!!detail.approvals.length && <p><b>Approval:</b> {detail.approvals.map((a: any) => `${a.action_type}: ${a.status}`).join(", ")}</p>}
                  {!!detail.toolRuns.length && <p className="muted">Tool runs: {detail.toolRuns.map((r: any) => `${r.tool_name}(${r.status}${r.exit_code != null ? "/" + r.exit_code : ""})`).join(", ")}</p>}
                  {["testing", "awaiting_approval", "failed"].includes(detail.task.status) && (
                    <div className="field"><label>Review QA — bukti wajib untuk lulus</label>
                      <textarea rows={2} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Bukti verifikasi kriteria penerimaan..." />
                      <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (untuk gagal)..." />
                      <div className="row"><button className="btn" disabled={busy} onClick={() => void reviewTask(t.id, "pass")}>✓ Lulus</button>
                        <button className="btn danger" disabled={busy} onClick={() => void reviewTask(t.id, "fail")}>✗ Gagal</button></div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
      </section>
    </main>
  );
}
