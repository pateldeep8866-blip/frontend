export const dynamic = "force-static";
import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkAdminAuth } from "../../_lib/admin-auth";

export const runtime = "nodejs";


const RUNS_ROOT = process.env.QUANT_RUNS_ROOT || "/Users/juanramirez/NOVA/NOVA_LAB/QUANT_LAB/reports/runs";

async function safeReadJson(path) {
  try {
    const txt = await readFile(path, "utf-8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function safeReadText(path) {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

export async function GET(request) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let runFolders = [];
  try {
    runFolders = (await readdir(RUNS_ROOT, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error?.message || error) }, { status: 500 });
  }

  const latestTen = runFolders.slice(0, 10);
  const latest = latestTen[0] || null;
  const latestDir = latest ? join(RUNS_ROOT, latest) : null;

  const manifest = latestDir ? await safeReadJson(join(latestDir, "run_manifest.json")) : null;
  const metrics = latestDir ? await safeReadJson(join(latestDir, "metrics.json")) : null;
  const regime = latestDir ? await safeReadJson(join(latestDir, "regime.json")) : null;
  const singlePickCsv = latestDir ? await safeReadText(join(latestDir, "single_pick.csv")) : null;

  return NextResponse.json({
    ok: true,
    runs: latestTen,
    latest_run: latest,
    manifest,
    metrics,
    regime,
    single_pick_csv: singlePickCsv,
  });
}

