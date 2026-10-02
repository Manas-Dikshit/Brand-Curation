"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ImportError } from "@/lib/overrides";

type Result = {
  name: string; score: number | null; verification: string; evidence: string;
  sourceUrl: string; missing: string; ruleId: string | null; source: "auto" | "analyst";
};
type Eval = {
  brand: string; results: Result[]; totalPct: number; assessedWeight: number; status: string;
  pillarSubtotals: Record<string, number>; durationMs?: number; error?: string;
};
type Brand = { brand: string; website?: string | null; instagram?: string | null };
type Ref = {
  ok: boolean; sheet: string; totalWeight: number; issues: string[]; notes: string[];
  criteria: { name: string; weight: number; pillar: string; ruleId: string }[];
};
type Progress = { total: number; done: number; running: number; failed: number; queued: number; etaSeconds: number | null; finished: boolean };

const CHIP: Record<string, { bg: string; fg: string; label: string }> = {
  "Verified": { bg: "#dcfce7", fg: "#14532d", label: "Verified" },
  "Evidence-based assessment": { bg: "#dbeafe", fg: "#1e3a8a", label: "Evidence-based" },
  "Insufficient Data": { bg: "#f3f4f6", fg: "#4b5563", label: "Insufficient" },
};

export default function Home() {
  const [ref, setRef] = useState<Ref | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [dupes, setDupes] = useState<string[]>([]);
  const [evals, setEvals] = useState<Eval[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [feed, setFeed] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  /** Row-level evidence import errors; carried into the Quality Check sheet. */
  const [importErrors, setImportErrors] = useState<ImportError[]>([]);
  const [busy, setBusy] = useState(false);
  const [pillar, setPillar] = useState("All");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const esRef = useRef<EventSource | null>(null);
  const sinceRef = useRef(0);

  useEffect(() => { fetch("/api/reference").then(r => r.json()).then(setRef).catch(e => setErrors([String(e)])); }, []);

  const pillars = useMemo(() => Array.from(new Set(ref?.criteria.map(c => c.pillar) ?? [])), [ref]);

  const localResults = useRef<Record<string, Result[]>>({});
  useEffect(() => { localResults.current = Object.fromEntries(evals.map(e => [e.brand, e.results])); }, [evals]);

  const recalc = useCallback((all: Eval[]) => {
    if (!ref) return all;
    const byPillar: Record<string, Record<string, number>> = {};
    for (const e of all) {
      let points = 0, assessed = 0;
      const sub: Record<string, number> = {};
      for (const c of ref.criteria) {
        const r = e.results.find(x => x.name === c.name);
        if (r?.score !== null && r?.score !== undefined) {
          const v = (r.score / 5) * c.weight;
          points += v; assessed += c.weight;
          sub[c.pillar] = Math.round(((sub[c.pillar] ?? 0) + v) * 10) / 10;
        }
      }
      const total = ref.criteria.reduce((s, c) => s + c.weight, 0);
      const status = assessed === 0 ? "Not assessed"
        : Math.abs(assessed - total) < 1e-9 ? "Complete"
        : `Partial (${Math.round(assessed * 10) / 10}/${Math.round(total * 10) / 10} weight scored)`;
      byPillar[e.brand] = sub;
      all.find(x => x.brand === e.brand)!.totalPct = Math.round(points * 10) / 10;
      all.find(x => x.brand === e.brand)!.assessedWeight = Math.round(assessed * 10) / 10;
      all.find(x => x.brand === e.brand)!.status = status;
    }
    for (const e of all) e.pillarSubtotals = byPillar[e.brand] ?? {};
    return all;
  }, [ref]);

  const pushEvals = useCallback((incoming: Eval[]) => {
    setEvals(prev => {
      const map = new Map(prev.map(e => [e.brand, e]));
      for (const e of incoming) {
        const old = map.get(e.brand);
        const results = old && localResults.current[e.brand]?.some(r => r.source === "analyst")
          ? e.results.map(r => localResults.current[e.brand].find(l => l.name === r.name && l.source === "analyst") ?? r)
          : e.results;
        map.set(e.brand, { ...e, results });
      }
      return recalc([...map.values()]);
    });
  }, [recalc]);

  const listen = useCallback((id: string) => {
    esRef.current?.close();
    const es = new EventSource(`/api/jobs/${id}/stream?since=${sinceRef.current}`);
    esRef.current = es;
    es.addEventListener("progress", ev => setProgress(JSON.parse((ev as MessageEvent).data)));
    es.addEventListener("brand", ev => pushEvals(JSON.parse((ev as MessageEvent).data).evaluations ?? []));
    es.addEventListener("events", ev => {
      const batch = JSON.parse((ev as MessageEvent).data) as { brand: string; type: string; detail?: string; t: number }[];
      sinceRef.current = batch.at(-1)!.t + 1;
      setFeed(f => [...f.slice(-40), ...batch.map(b => `${b.brand === "*" ? "" : b.brand + " "}${b.type}${b.detail ? ": " + b.detail : ""}`)].slice(-40));
    });
    es.onerror = () => { es.close(); };
  }, [pushEvals]);

  async function uploadBrands(f: File) {
    setErrors([]);
    const fd = new FormData(); fd.append("file", f);
    const res = await fetch("/api/parse", { method: "POST", body: fd });
    const j = await res.json();
    if (!res.ok) return setErrors([j.error ?? "Upload failed"]);
    setBrands(j.brands ?? []); setDupes(j.duplicates ?? []); setEvals([]); setProgress(null); setFeed([]); sinceRef.current = 0;
  }

  async function run() {
    setBusy(true); setErrors([]); setEvals([]); sinceRef.current = 0;
    const res = await fetch("/api/jobs", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ brands }),
    });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) return setErrors([j.error ?? "Run failed"]);
    setJobId(j.jobId);
    history.replaceState(null, "", `?job=${j.jobId}`);
    listen(j.jobId);
  }

  /** A reload carries ?job=... in the URL, so an in-flight run reconnects itself. */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("job");
    if (!id) return;
    setJobId(id);
    fetch(`/api/jobs/${id}`).then(r => r.json()).then(st => {
      setBrands(st.inputs ?? []);
      setEvals(recalc(st.evaluations ?? []));
      const { total, done, running, failed, queued, etaSeconds, finished } = st;
      setProgress({ total, done, running, failed, queued, etaSeconds, finished });
      setErrors(Object.entries(st.errors ?? {}).map(([b, e]) => `${b}: ${e}`));
    }).catch(() => { /* unknown job id: start clean */ });
    listen(id);
  }, [listen, recalc]);

  async function retryFailed() {
    if (!jobId) return;
    const res = await fetch(`/api/jobs/${jobId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "retry-failed" }) });
    if (!res.ok) setErrors([(await res.json()).error ?? "Retry failed"]);
    else listen(jobId);
  }

  /** Inline analyst override. Applied locally first so totals move instantly. */
  function override(brand: string, name: string, patch: Partial<Result>) {
    setEvals(prev => {
      const next = prev.map(e => {
        if (e.brand !== brand) return e;
        const results: Result[] = e.results.map(r => r.name === name
          ? { ...r, ...patch, source: "analyst" as const, ruleId: null }
          : r);
        localResults.current[e.brand] = results;
        return { ...e, results };
      });
      return recalc(next);
    });
  }

  async function importEvidence(f: File) {
    const fd = new FormData(); fd.append("file", f);
    if (jobId) fd.append("jobId", jobId);
    const res = await fetch("/api/overrides", { method: "POST", body: fd });
    const j = await res.json();
    if (!res.ok) return setErrors([j.error ?? "Import failed"]);
    setImportErrors(j.errors ?? []);
    setErrors((j.errors ?? []).map((e: ImportError) => `Row ${e.row}${e.brand ? " (" + e.brand + ")" : ""}: ${e.error}`));
    setFeed(f => [...f, `Imported ${j.imported} analyst score(s); ${j.errors?.length ?? 0} row error(s)`]);
  }

  async function loadDemo() {
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch("/api/demo");
      const j = await res.json();
      if (!res.ok) return setErrors([j.error ?? "Demo run failed"]);
      setBrands(j.brands);
      setJobId(null);
      setProgress(null);
      setEvals(recalc(j.evaluations));
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    // export what the analyst sees: local inline overrides + row errors included.
    // The server re-gates and re-totals whatever arrives, so nothing is trusted blindly.
    const res = await fetch("/api/export", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ evaluations: evals, duplicates: dupes, importErrors }),
    });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "brand_curation_output.xlsx"; a.click();
    URL.revokeObjectURL(a.href);
  }

  const shown = pillar === "All" ? evals : evals.map(e => e);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24, fontSize: 14 }}>
      <h1 style={{ marginBottom: 4 }}>Brand Curation & Evaluation</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        Runs locally with no API keys. Evidence-gated: a score without a source URL is withheld.
      </p>

      <Section title="1. Reference validation">
        {!ref ? "Checkingâ€¦" : (
          <>
            <p>
              Sheet <b>{ref.sheet}</b> Â· {ref.criteria.length} criteria Â· total weight <b>{ref.totalWeight}</b> Â·{" "}
              <b style={{ color: ref.ok ? "#15803d" : "#b91c1c" }}>{ref.ok ? "OK" : "BLOCKED â€” scoring disabled"}</b>
            </p>
            {ref.issues.map((i, n) => <p key={n} style={{ color: "#b91c1c" }}>{i}</p>)}
            <details><summary style={{ cursor: "pointer" }}>Rubric notes &amp; direction warnings</summary>
              <ul>{ref.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </details>
            <details><summary style={{ cursor: "pointer" }}>Weights per criterion</summary>
              <ul>{ref.criteria.map(c => <li key={c.name}>{c.name} â€” {c.weight}% ({c.ruleId})</li>)}</ul>
            </details>
          </>
        )}
      </Section>

      <Section title="2. Upload brand list (.xlsx: Brand, optional Website, optional Instagram)">
        <input type="file" accept=".xlsx" onChange={e => e.target.files?.[0] && uploadBrands(e.target.files[0])} />
        {" "}<button onClick={loadDemo} disabled={busy || !ref?.ok}>Load demo data (offline)</button>
        {brands.length > 0 && (
          <p>
            {brands.length} brand(s) ready.
            {dupes.length > 0 && <span style={{ color: "#9a6700" }}> Collapsed {dupes.length} duplicate(s): {dupes.join(", ")}</span>}
            {" "}<button disabled={busy || !ref?.ok} onClick={run}>{busy ? "Startingâ€¦" : "Run evaluation"}</button>
          </p>
        )}
      </Section>

      {progress && (
        <Section title="3. Progress">
          <p>{progress.done}/{progress.total} done Â· {progress.running} running Â· {progress.failed} failed Â· {progress.queued} queued
            {progress.etaSeconds !== null && progress.etaSeconds > 0 && ` Â· ~${progress.etaSeconds}s left`}</p>
          <div style={{ background: "#e5e7eb", height: 8, borderRadius: 4 }}>
            <div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, height: 8, background: "#2563eb", borderRadius: 4 }} />
          </div>
          {progress.failed > 0 && <p><button onClick={retryFailed}>Re-run failed only</button></p>}
          {feed.length > 0 && (
            <pre style={{ maxHeight: 140, overflow: "auto", background: "#111", color: "#c9d1d9", padding: 8, fontSize: 11 }}>
              {feed.slice(-14).join("\n")}
            </pre>
          )}
        </Section>
      )}

      {errors.length > 0 && <Section title="Issues"><ul style={{ color: "#b91c1c" }}>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Section>}

      {shown.length > 0 && (
        <Section title="4. Results">
          <p style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select value={pillar} onChange={e => setPillar(e.target.value)}>
              <option>All</option>
              {pillars.map(p => <option key={p}>{p}</option>)}
            </select>
            <input type="file" accept=".xlsx" onChange={e => e.target.files?.[0] && importEvidence(e.target.files[0])}
              title="Bulk import: Brand, Criterion, Score, Evidence, Source URL" />
            <button onClick={download}>Download Excel</button>
          </p>
          <p style={{ color: "#666" }}>Click a criterion row to edit it. Analyst scores need a source URL and win over auto scores.</p>

          {shown.map(e => (
            <details key={e.brand} style={{ border: "1px solid #e5e7eb", borderRadius: 6, marginBottom: 8, padding: 8 }} open>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                {e.brand} â€” {e.totalPct}% Â· assessed {e.assessedWeight} Â· {e.status}
                {e.error && <span style={{ color: "#b91c1c" }}> Â· {e.error}</span>}
              </summary>
              {e.status !== "Complete" && (
                <p style={{ color: "#9a6700", margin: "4px 0" }}>
                  Partial total â€” {e.results.filter(r => r.score === null).length} criterion/ies unscored and NOT normalised. Not comparable with a Complete brand.
                </p>
              )}
              {pillar !== "All" && (
                <p style={{ color: "#666", margin: "4px 0" }}>
                  {pillar} subtotal: {e.pillarSubtotals[pillar] ?? 0} pts
                </p>
              )}
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                    <th>Pillar</th><th>Criterion</th><th>Score</th><th>Wt</th><th>Status</th><th>Source</th><th>Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {e.results.filter(r => pillar === "All" || ref?.criteria.find(c => c.name === r.name)?.pillar === pillar).map(r => {
                    const c = ref?.criteria.find(x => x.name === r.name);
                    const chip = CHIP[r.verification] ?? CHIP["Insufficient Data"];
                    const open = expanded[`${e.brand}|${r.name}`];
                    return (
                      <Fragment key={r.name}>
                        <tr style={{ borderBottom: "1px solid #f3f4f6", background: r.score === null ? "#fafafa" : undefined }}>
                          <td style={{ color: "#666" }}>{c?.pillar ?? ""}</td>
                          <td>
                            <button style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer", textDecoration: "underline" }}
                              onClick={() => setExpanded(x => ({ ...x, [`${e.brand}|${r.name}`]: !x[`${e.brand}|${r.name}`] }))}>
                              {r.name}
                            </button>
                          </td>
                          <td align="center">{r.score ?? "â€”"}</td>
                          <td align="center">{c?.weight}</td>
                          <td><span style={{ background: chip.bg, color: chip.fg, padding: "1px 6px", borderRadius: 8, fontSize: 11 }}>{chip.label}</span></td>
                          <td style={{ fontSize: 11 }}>{r.source}{r.source === "analyst" && " âœŽ"}</td>
                          <td style={{ fontSize: 11, color: "#666" }}>{r.ruleId ?? "â€”"}</td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={7} style={{ background: "#f9fafb", padding: 8 }}>
                              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                                <label>Score
                                  <input type="number" min={0} max={5} style={{ width: 60, marginLeft: 4 }}
                                    value={r.score ?? ""}
                                    onChange={ev => {
                                      const v = ev.target.value;
                                      override(e.brand, r.name, v === "" ? { score: null, verification: "Insufficient Data" } : { score: Number(v) });
                                    }} />
                                </label>
                                <span style={{ fontSize: 11, color: "#666" }}>0-5, integer, blank = Insufficient Data</span>
                              </div>
                              <OverrideEditor brand={e.brand} r={r} onSave={patch => override(e.brand, r.name, patch)} />
                              {r.evidence && <p style={{ margin: "6px 0" }}><b>Evidence:</b> {r.evidence}</p>}
                              {r.sourceUrl && <p style={{ margin: "6px 0" }}><b>Source:</b> <a href={r.sourceUrl} target="_blank" rel="noreferrer">{r.sourceUrl}</a></p>}
                              {r.missing && <p style={{ margin: "6px 0", color: "#9a6700" }}><b>Missing / notes:</b> {r.missing}</p>}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </details>
          ))}
        </Section>
      )}

      <p style={{ color: "#666", marginTop: 24 }}>
        Blocked platforms are recorded as unverifiable, never as absent. Missing data is Insufficient Data, never 0.
      </p>
    </main>
  );
}

function OverrideEditor({ brand, r, onSave }: { brand: string; r: Result; onSave: (p: Partial<Result>) => void }) {
  const [score, setScore] = useState<string>(r.score === null ? "" : String(r.score));
  const [evidence, setEvidence] = useState(r.evidence ?? "");
  const [url, setUrl] = useState(r.sourceUrl ?? "");
  const [verification, setVerification] = useState<string>(r.verification);
  const [msg, setMsg] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <label>
          Score{" "}
          <input type="number" min={0} max={5} step={1} style={{ width: 70 }} value={score}
            onChange={e => setScore(e.target.value)} placeholder="—" />
        </label>
        <select value={verification} onChange={e => setVerification(e.target.value)}>
          <option>Verified</option>
          <option>Evidence-based assessment</option>
          <option>Insufficient Data</option>
        </select>
        <input placeholder="Evidence (required for a score)" value={evidence} onChange={e => setEvidence(e.target.value)} style={{ flex: "1 1 320px" }} />
        <input placeholder="https:// source URL (required)" value={url} onChange={e => setUrl(e.target.value)} style={{ flex: "1 1 320px" }} />
        <button onClick={() => {
          if (score === "") return onSave({ score: null, verification: "Insufficient Data", evidence, sourceUrl: url });
          const n = Number(score);
          if (!Number.isInteger(n) || n < 0 || n > 5) return setMsg("Score must be an integer 0-5.");
          if (!/^https?:\/\//i.test(url)) return setMsg("A source URL is required; the score would be withheld on export.");
          setMsg("");
          onSave({ score: n, evidence, sourceUrl: url, verification: verification as Result["verification"], missing: "" });
        }}>Save analyst score</button>
      </div>
      {msg && <span style={{ color: "#b91c1c" }}>{msg}</span>}
      <small style={{ color: "#666" }}>Brand: {brand} · criterion: {r.name}</small>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children}
    </section>
  );
}
