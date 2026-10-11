import fs from "fs";
import path from "path";
import { afterEach, expect, test } from "vitest";
import { getJob, type Job } from "@/lib/job";

const DIR = path.join(process.cwd(), ".cache", "jobs");
const id = "test-reset-" + Date.now();
const file = () => path.join(DIR, id + ".json");

afterEach(() => { try { fs.unlinkSync(file()); } catch { /* already gone */ } });

test("loading a job from disk requeues brands stranded in 'running' by a crash", () => {
  fs.mkdirSync(DIR, { recursive: true });
  const job: Job = {
    id, createdAt: 1, updatedAt: 1, finished: false, total: 2, overrides: {},
    inputs: [{ brand: "A" }, { brand: "B" }],
    brands: { A: "running", B: "done" }, evaluations: {}, errors: {}, events: [],
  };
  fs.writeFileSync(file(), JSON.stringify(job));

  const loaded = getJob(id)!;
  expect(loaded.brands.A).toBe("queued");
  expect(loaded.brands.B).toBe("done");
  expect(loaded.finished).toBe(false);
});