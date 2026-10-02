"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** Marker class per verification state. Colour never carries the meaning alone. */
const CHIP_CLASS: Record<string, string> = {
  "Verified": "chip chip--verified",
  "Evidence-based assessment": "chip chip--scored",
  "Insufficient Data": "chip chip--unverified",
};
const CHIP_LABEL: Record<string, string> = {
  "Verified": "Verified",
  "Evidence-based assessment": "Evidence-based",
  "Insufficient Data": "Insufficient",
};

/** Fleuron rule used as a decorative break between masthead and body. */
function Ornament() {
  return (
    <svg className="ornament" width="120" height="14" viewBox="0 0 120 14" fill="none" aria-hidden="true">
      <path d="M2 7h40M78 7h40" stroke="currentColor" strokeWidth="1" />
      <path d="M60 1l6 6-6 6-6-6 6-6z" stroke="currentColor" strokeWidth="1" />
      <circle cx="48" cy="7" r="1.5" fill="currentColor" />
      <circle cx="72" cy="7" r="1.5" fill="currentColor" />
    </svg>
  );
}

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

  return (
    <>
      <header className="masthead">
        <div className="masthead__topline">
          <span>Newtail · Brand Curation Desk</span>
          <span>Local edition · no API keys</span>
        </div>
        <div className="rule-double" />
        <h1 className="masthead__title">Brand Curation <em>&amp;</em> Evaluation</h1>
        <p className="masthead__standfirst">
          Fifteen weighted criteria, scored only where the evidence is on the record.
          A score without a source URL is withheld — <i>Insufficient Data</i> is never a zero.
        </p>
      </header>

      <main className="spread">
        <Ornament />

        {/* ---------------- 01 ---------------- */}
        <section className="section">
          <div className="section__head">
            <div className="folio">01</div>
            <div>
              <p className="kicker">Reference</p>
              <h2 className="section__title">The weights are read from the workbook, never typed in</h2>
            </div>
            <p className="section__note">
              All 15 criterion names must match exactly and the weights must total 100, or scoring stays disabled.
            </p>
          </div>

          <div className="panel">
            {!ref ? <p className="colophon">Checking the reference workbook…</p> : (
              <>
                <div className="factline">
                  <span className="fact"><b>Sheet</b> {ref.sheet}</span>
                  <span className="fact"><b>{ref.criteria.length}</b> criteria</span>
                  <span className="fact">total weight <b>{ref.totalWeight}</b></span>
                  <span className={ref.ok ? "good" : "bad"}>{ref.ok ? "VALIDATED" : "BLOCKED — SCORING DISABLED"}</span>
                </div>
                {ref.issues.length > 0 && (
                  <ul className="plain bad">
                    {ref.issues.map((i, n) => <li key={n}>{i}</li>)}
                  </ul>
                )}
                <blockquote className="pullquote">
                  Blocked platforms are recorded as unverifiable, never as absent.
                  Missing data is Insufficient Data, never 0.
                  <cite>House rules</cite>
                </blockquote>
                <div className="stack">
                  <details>
                    <summary className="index small">Rubric notes &amp; direction warnings</summary>
                    <ul className="plain">{ref.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                  </details>
                  <details>
                    <summary className="index small">Weights per criterion</summary>
                    <ul className="plain">{ref.criteria.map(c => <li key={c.name}>{c.name} — {c.weight}% ({c.ruleId})</li>)}</ul>
                  </details>
                </div>
              </>
            )}
          </div>
        </section>

        {/* ---------------- 02 ---------------- */}
        <section className="section">
          <div className="section__head">
            <div className="folio">02</div>
            <div>
              <p className="kicker">The list</p>
              <h2 className="section__title">Name the brands to research</h2>
            </div>
            <p className="section__note">.xlsx with Brand, optional Website, optional Instagram. Duplicates collapse.</p>
          </div>

          <div className="panel stack">
            <div className="row">
              <input type="file" accept=".xlsx" aria-label="Brand list"
                onChange={e => e.target.files?.[0] && uploadBrands(e.target.files[0])} />
              <button className="btn" onClick={loadDemo} disabled={busy || !ref?.ok}>Load demo data (offline)</button>
            </div>
            {brands.length > 0 && (
              <div className="row">
                <span className="lede">{brands.length} brand{brands.length === 1 ? "" : "s"} ready.</span>
                {dupes.length > 0 && <span className="warn">Collapsed {dupes.length} duplicate(s): {dupes.join(", ")}</span>}
                <button className="btn btn--accent" disabled={busy || !ref?.ok} onClick={run}>
                  {busy ? "Starting…" : "Run evaluation"}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ---------------- 03 ---------------- */}
        {progress && (
          <section className="section">
            <div className="section__head">
              <div className="folio">03</div>
              <div>
                <p className="kicker">In progress</p>
                <h2 className="section__title">The desk is working</h2>
              </div>
              <p className="section__note">
                {progress.done}/{progress.total} done · {progress.running} running · {progress.failed} failed · {progress.queued} queued
                {progress.etaSeconds !== null && progress.etaSeconds > 0 && ` · ~${progress.etaSeconds}s left`}
              </p>
            </div>
            <div className="progress">
              <div className="progress__fill" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            {progress.failed > 0 && (
              <p className="row" style={{ marginTop: 10 }}>
                <button className="btn" onClick={retryFailed}>Re-run failed only</button>
              </p>
            )}
            {feed.length > 0 && <pre className="feed">{feed.slice(-14).join("\n")}</pre>}
          </section>
        )}

        {/* ---------------- issues ---------------- */}
        {errors.length > 0 && (
          <section className="section">
            <div className="section__head">
              <div className="folio">!</div>
              <div>
                <p className="kicker">Issues</p>
                <h2 className="section__title">What needs your attention</h2>
              </div>
            </div>
            <div className="panel">
              <ul className="plain bad">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          </section>
        )}

        {/* ---------------- 04 ---------------- */}
        {evals.length > 0 && (
          <section className="section">
            <div className="section__head">
              <div className="folio">04</div>
              <div>
                <p className="kicker">The record</p>
                <h2 className="section__title">Scores, and everything behind them</h2>
              </div>
              <p className="section__note">
                Open a criterion to read its evidence or file an analyst score. Analyst scores need a source URL
                and win over the automatic ones.
              </p>
            </div>

            <div className="row" style={{ marginBottom: 8 }}>
              <select value={pillar} onChange={e => setPillar(e.target.value)} aria-label="Filter by pillar">
                <option>All</option>
                {pillars.map(p => <option key={p}>{p}</option>)}
              </select>
              <input type="file" accept=".xlsx" aria-label="Import analyst evidence"
                title="Bulk import: Brand, Criterion, Score, Evidence, Source URL"
                onChange={e => e.target.files?.[0] && importEvidence(e.target.files[0])} />
              <button className="btn btn--accent" onClick={download}>Download Excel</button>
            </div>

            {evals.map(e => (
              <article className="card" key={e.brand}>
                <div className="card__head">
                  <div>
                    <h3 className="card__brand">{e.brand}</h3>
                    <p className="card__meta">
                      {e.status} · assessed {e.assessedWeight} of 100 weight
                      {e.durationMs ? ` · ${(e.durationMs / 1000).toFixed(1)}s` : ""}
                    </p>
                    {e.error && <p className="bad">{e.error}</p>}
                  </div>
                  <p className="card__score">
                    <span className="card__pct">{e.totalPct}<sup>%</sup></span>
                    <span className="card__sub">weighted score</span>
                  </p>
                </div>

                {e.status !== "Complete" && (
                  <p className="warn">
                    Partial total — {e.results.filter(r => r.score === null).length} criterion/ies unscored and NOT
                    normalised. Not comparable with a Complete brand.
                  </p>
                )}

                <div className="subtotals">
                  {(Object.keys(e.pillarSubtotals).length ? Object.keys(e.pillarSubtotals) : pillars).map(p => (
                    <div key={p}>{p} <b>{e.pillarSubtotals[p] ?? 0}</b></div>
                  ))}
                </div>

                <table className="sheet">
                  <thead>
                    <tr>
                      <th className="pillar">Pillar</th>
                      <th>Criterion</th>
                      <th className="num">Score</th>
                      <th className="num">Wt</th>
                      <th>Status</th>
                      <th>Source</th>
                      <th>Rule</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.results
                      .filter(r => pillar === "All" || ref?.criteria.find(c => c.name === r.name)?.pillar === pillar)
                      .map(r => {
                        const c = ref?.criteria.find(x => x.name === r.name);
                        const open = expanded[`${e.brand}|${r.name}`];
                        return (
                          <Fragment key={r.name}>
                            <tr className={r.score === null ? "is-unscored" : undefined}>
                              <td className="pillar">{c?.pillar ?? ""}</td>
                              <td>
                                <button className="criterion"
                                  onClick={() => setExpanded(x => ({ ...x, [`${e.brand}|${r.name}`]: !x[`${e.brand}|${r.name}`] }))}>
                                  {r.name}
                                </button>
                              </td>
                              <td className="num score">{r.score ?? "—"}</td>
                              <td className="num">{c?.weight}</td>
                              <td>
                                <span className={CHIP_CLASS[r.verification] ?? CHIP_CLASS["Insufficient Data"]}>
                                  {CHIP_LABEL[r.verification] ?? "Insufficient"}
                                </span>
                              </td>
                              <td className="provenance">{r.source}{r.source === "analyst" && " ✎"}</td>
                              <td className="ruleid">{r.ruleId ?? "—"}</td>
                            </tr>
                            {open && (
                              <tr>
                                <td className="pillar" />
                                <td colSpan={6}>
                                  <div className="detail">
                                    <OverrideEditor brand={e.brand} r={r} onSave={patch => override(e.brand, r.name, patch)} />
                                    <dl>
                                      {r.evidence && (<><dt>Evidence</dt><dd className="lede">{r.evidence}</dd></>)}
                                      {r.sourceUrl && (<><dt>Source</dt><dd><a href={r.sourceUrl} target="_blank" rel="noreferrer">{r.sourceUrl}</a></dd></>)}
                                      {r.missing && (<><dt>Missing</dt><dd className="warn">{r.missing}</dd></>)}
                                    </dl>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                  </tbody>
                </table>
              </article>
            ))}
          </section>
        )}

        <Ornament />
        <p className="colophon dropcap">
          Every figure here traces to a URL a reviewer can open. Where the public record does not
          support a score, the column says so instead of guessing — that is what keeps a partial
          total from being read as a verdict.
        </p>
      </main>
    </>
  );
}

function OverrideEditor({ brand, r, onSave }: { brand: string; r: Result; onSave: (p: Partial<Result>) => void }) {
  const [score, setScore] = useState<string>(r.score === null ? "" : String(r.score));
  const [evidence, setEvidence] = useState(r.evidence ?? "");
  const [url, setUrl] = useState(r.sourceUrl ?? "");
  const [verification, setVerification] = useState<string>(r.verification);
  const [msg, setMsg] = useState("");
  return (
    <div className="editor">
      <div className="row">
        <label className="small">
          Score{" "}
          <input type="number" min={0} max={5} step={1} style={{ width: 70 }} value={score}
            onChange={e => setScore(e.target.value)} placeholder="—" />
        </label>
        <select value={verification} aria-label="Verification status" onChange={e => setVerification(e.target.value)}>
          <option>Verified</option>
          <option>Evidence-based assessment</option>
          <option>Insufficient Data</option>
        </select>
        <input placeholder="Evidence (required for a score)" value={evidence} aria-label="Evidence"
          onChange={e => setEvidence(e.target.value)} />
        <input placeholder="https:// source URL (required)" value={url} aria-label="Source URL"
          onChange={e => setUrl(e.target.value)} />
        <button className="btn" onClick={() => {
          if (score === "") return onSave({ score: null, verification: "Insufficient Data", evidence, sourceUrl: url });
          const n = Number(score);
          if (!Number.isInteger(n) || n < 0 || n > 5) return setMsg("Score must be an integer 0-5.");
          if (!/^https?:\/\//i.test(url)) return setMsg("A source URL is required; the score would be withheld on export.");
          setMsg("");
          onSave({ score: n, evidence, sourceUrl: url, verification: verification as Result["verification"], missing: "" });
        }}>Save analyst score</button>
        <span className="small">0–5, integer. Blank means Insufficient Data.</span>
      </div>
      {msg && <span className="bad">{msg}</span>}
    </div>
  );
}