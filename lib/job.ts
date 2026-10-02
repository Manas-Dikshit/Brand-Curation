import fs from "fs";
import path from "path";
import { evaluateBrand } from "./engine";
import { mergeOverride, summarize } from "./scoring";
import type { RefReport } from "./criteria";
import type { BrandInput, CriterionResult, Evaluation } from "./types";

const JOB_DIR = path.join(process.cwd(), ".cache", "jobs");

export const CONCURRENCY = Number(process.env.BRAND_CONCURRENCY ?? 6);

export type BrandState = "queued" | "running" | "done" | "failed" | "skipped";

export type JobEvent = { t: number; brand: string; type: string; detail?: string };

export type Job = {
  id: string;
  createdAt: number;
  updatedAt: number;
  finished: boolean;
  total: number;
  overrides: Record<string, CriterionResult[]>;
  /** Persisted with the job so a process restart can resume without a re-upload. */
  inputs: BrandInput[];
  brands: Record<string, BrandState>;
  evaluations: Record<string, Evaluation>;
  errors: Record<string, string>;
  events: JobEvent[];
};

const jobs = new Map<string, Job>();

function file(id: string) {
  return path.join(JOB_DIR, id + ".json");
}

function persist(job: Job) {
  job.updatedAt = Date.now();
  try {
    fs.mkdirSync(JOB_DIR, { recursive: true });
    fs.writeFileSync(file(job.id), JSON.stringify(job));
  } catch { /* best effort */ }
}

function emit(job: Job, brand: string, type: string, detail?: string) {
  job.events.push({ t: Date.now(), brand, type, ...(detail ? { detail } : {}) });
  if (job.events.length > 4000) job.events.splice(0, 1000);
}

export function getJob(id: string): Job | null {
  const cached = jobs.get(id);
  if (cached) return cached;
  try {
    const job = JSON.parse(fs.readFileSync(file(id), "utf8")) as Job;
    jobs.set(id, job);
    return job;
  } catch {
    return null;
  }
}

export function createJob(brands: BrandInput[], overrides: Record<string, CriterionResult[]> = {}): Job {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const job: Job = {
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    finished: false,
    total: brands.length,
    overrides,
    inputs: brands,
    brands: Object.fromEntries(brands.map(b => [b.brand, "queued" as BrandState])),
    evaluations: {},
    errors: {},
    events: [],
  };
  jobs.set(id, job);
  emit(job, "*", "job-created", `${brands.length} brand(s) queued`);
  persist(job);
  return job;
}

/** Adds analyst overrides; finished brands are re-totaled in place. */
export function applyOverrides(job: Job, ref: RefReport, overrides: Record<string, CriterionResult[]>) {
  for (const [brand, list] of Object.entries(overrides)) {
    job.overrides[brand] = [...(job.overrides[brand] ?? []), ...list];
    const existing = job.evaluations[brand];
    if (!existing) continue;
    const merged = mergeOverride(existing.results, list);
    job.evaluations[brand] = { ...existing, results: merged, ...summarize(ref.criteria, merged) };
    emit(job, brand, "overridden", `${list.length} criterion score(s) overridden by analyst`);
  }
  persist(job);
}

/** Bounded pool over the selected states. Already-done brands are skipped, so a crash resumes. */
export async function runJob(job: Job, ref: RefReport, only: BrandState[] = ["queued", "failed"]) {
  job.finished = false;
  const byBrand = new Map(job.inputs.map(i => [i.brand, i]));
  const queue = Object.entries(job.brands)
    .filter(([, state]) => only.includes(state))
    .map(([brand]) => brand);
  if (!queue.length) {
    job.finished = true;
    persist(job);
    return job;
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const brand = queue.shift();
      if (!brand) return;
      const input = byBrand.get(brand);
      if (!input) {
        job.brands[brand] = "skipped";
        job.errors[brand] = "No upload input row for this brand in the job file.";
        emit(job, brand, "failed", job.errors[brand]);
        persist(job);
        continue;
      }
      job.brands[brand] = "running";
      emit(job, brand, "started");
      persist(job);
      const t0 = Date.now();
      try {
        let ev = await evaluateBrand(input, ref.criteria, (step, detail) => {
          emit(job, brand, "progress", detail ? `${step}: ${detail}` : step);
          if (step === "done" || step === "cache" || step === "site") persist(job);
        });
        const ov = job.overrides[brand];
        if (ov?.length) {
          const merged = mergeOverride(ev.results, ov);
          ev = { ...ev, results: merged, ...summarize(ref.criteria, merged) };
        }
        job.evaluations[brand] = ev;
        job.brands[brand] = "done";
        delete job.errors[brand];
        emit(job, brand, "done", `${ev.totalPct}% in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      } catch (e) {
        const msg = (e as Error).message;
        job.brands[brand] = "failed";
        job.errors[brand] = msg;
        emit(job, brand, "failed", msg);
      }
      persist(job);
    }
  });

  await Promise.all(workers);

  const remaining = Object.values(job.brands).some(s => s === "queued" || s === "running");
  job.finished = !remaining;
  emit(job, "*", job.finished ? "finished" : "partial", `${Object.keys(job.evaluations).length}/${job.total} evaluated`);
  persist(job);
  return job;
}

export function eta(job: Job): number | null {
  const done = Object.values(job.brands).filter(s => s === "done").length;
  if (done < 1) return null;
  const per = (Date.now() - job.createdAt) / done;
  return Math.round(((job.total - done) * per) / 1000);
}

export function jobProgress(job: Job) {
  const states = Object.values(job.brands);
  return {
    total: job.total,
    done: states.filter(s => s === "done").length,
    running: states.filter(s => s === "running").length,
    failed: states.filter(s => s === "failed").length,
    queued: states.filter(s => s === "queued").length,
    etaSeconds: eta(job),
    finished: job.finished,
  };
}
