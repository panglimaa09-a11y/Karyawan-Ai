import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

type ProjectFile = { path: string; content: string };

function parseRepo(repoUrl: string) {
  const raw = repoUrl.trim().replace(/\.git\/?$/, "").replace(/\/$/, "");
  const match = raw.match(/github\.com[/:]([^/]+)\/([^/]+)$/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

async function github(path: string, init: RequestInit, token: string) {
  return fetch("https://api.github.com" + path, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const repoUrl = String(body?.repoUrl || "").trim();
    const branch = String(body?.branch || "main").trim() || "main";
    const message = String(body?.message || "feat: publish AI Office project").trim();
    const files = Array.isArray(body?.files)
      ? body.files.filter((f: any) => f && typeof f.path === "string" && typeof f.content === "string").slice(0, 100)
      : [];

    if (!repoUrl || !files.length) {
      return NextResponse.json({ error: "Repository dan file project wajib diisi." }, { status: 400 });
    }

    const token = process.env.GITHUB_TOKEN || "";
    if (!token) {
      return NextResponse.json({
        error: "GITHUB_TOKEN belum dipasang di environment server. Tambahkan token GitHub sebagai server secret; jangan masukkan token ke UI."
      }, { status: 503 });
    }

    const parsed = parseRepo(repoUrl);
    if (!parsed) return NextResponse.json({ error: "URL GitHub tidak valid. Contoh: https://github.com/user/repo" }, { status: 400 });

    const base = await github(`/repos/${parsed.owner}/${parsed.repo}/git/ref/heads/${encodeURIComponent(branch)}`, { method: "GET" }, token);
    if (!base.ok) {
      const detail = await base.text();
      return NextResponse.json({ error: `Branch ${branch} tidak ditemukan atau token tidak punya akses.`, detail: detail.slice(0, 500) }, { status: base.status });
    }
    const baseData = await base.json();
    const baseSha = baseData.object?.sha;
    if (!baseSha) return NextResponse.json({ error: "Tidak dapat membaca commit branch." }, { status: 502 });

    const treeRes = await github(`/repos/${parsed.owner}/${parsed.repo}/git/trees/${baseSha}?recursive=1`, { method: "GET" }, token);
    if (!treeRes.ok) return NextResponse.json({ error: "Gagal membaca isi repository." }, { status: treeRes.status });
    const treeData = await treeRes.json();
    const existing = new Map<string, string>((treeData.tree || []).filter((x: any) => x.path && x.sha).map((x: any) => [x.path, x.sha]));

    const treeEntries = [];
    for (const file of files) {
      const path = file.path.replace(/^\/+/, "").replace(/\\/g, "/");
      if (!path || path.includes("..")) continue;
      const blob = await github(`/repos/${parsed.owner}/${parsed.repo}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: file.content, encoding: "utf-8" })
      }, token);
      if (!blob.ok) return NextResponse.json({ error: `Gagal membuat blob untuk ${path}.` }, { status: blob.status });
      const blobData = await blob.json();
      treeEntries.push({ path, mode: "100644", type: "blob", sha: blobData.sha });
      existing.delete(path);
    }

    const tree = await github(`/repos/${parsed.owner}/${parsed.repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseSha, tree: treeEntries })
    }, token);
    if (!tree.ok) return NextResponse.json({ error: "Gagal membuat Git tree." }, { status: tree.status });
    const treeData2 = await tree.json();

    const commit = await github(`/repos/${parsed.owner}/${parsed.repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message, tree: treeData2.sha, parents: [baseSha] })
    }, token);
    if (!commit.ok) return NextResponse.json({ error: "Gagal membuat commit.", detail: (await commit.text()).slice(0, 500) }, { status: commit.status });
    const commitData = await commit.json();

    const updateRef = await github(`/repos/${parsed.owner}/${parsed.repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commitData.sha, force: false })
    }, token);
    if (!updateRef.ok) return NextResponse.json({ error: "Commit berhasil dibuat tetapi branch gagal diperbarui.", detail: (await updateRef.text()).slice(0, 500) }, { status: updateRef.status });

    return NextResponse.json({
      ok: true,
      repo: `${parsed.owner}/${parsed.repo}`,
      branch,
      commit: commitData.sha,
      files: treeEntries.map((x: any) => x.path),
      url: `https://github.com/${parsed.owner}/${parsed.repo}/commit/${commitData.sha}`
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "GitHub publish gagal." }, { status: 500 });
  }
}
