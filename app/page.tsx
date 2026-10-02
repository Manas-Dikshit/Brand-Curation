"use client";
import { useEffect, useState } from "react";
type Ev = { brand: string; results: any[]; totalPct: number; assessedWeight: number; status: string };
export default function Home() {
  const [ref, setRef] = useState<any>(null); const [brands, setBrands] = useState<string[]>([]);
  const [evals, setEvals] = useState<Ev[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { fetch("/api/reference").then(r => r.json()).then(setRef); }, []);
  async function upload(f: File) {
    const fd = new FormData(); fd.append("file", f);
    const j = await (await fetch("/api/parse", { method: "POST", body: fd })).json(); setBrands(j.brands); setEvals([]);
  }
  async function run() {
    setBusy(true); setErr(""); const out: Ev[] = [];
    for (const b of brands) {
      const res = await fetch("/api/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand: b }) });
      const j = await res.json(); if (!res.ok) { setErr(JSON.stringify(j.issues || j.error)); break; }
      out.push(j); setEvals([...out]);
    }
    setBusy(false);
  }
  async function download() {
    const r = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ evaluations: evals }) });
    const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = "brand_curation_output.xlsx"; a.click();
  }
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <h1>Brand Curation & Evaluation</h1>
      <section style={{ background: "#fff", padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
        <h3>1. Reference validation</h3>
        {!ref ? "Checking…" : <>
          <p>Sheet: <b>{ref.sheet}</b> · {ref.criteria.length} criteria · total weight {ref.totalWeight} · <b style={{ color: ref.ok ? "green" : "crimson" }}>{ref.ok ? "OK" : "BLOCKED"}</b></p>
          <ul>{ref.issues.map((i: string) => <li key={i}>{i}</li>)}</ul>
          <small>{ref.criteria.map((c: any) => `${c.name} ${c.weight}`).join(" · ")}</small></>}
      </section>
      <section style={{ marginTop: 16 }}>
        <h3>2. Upload brand list (.xlsx, names in column A)</h3>
        <input type="file" accept=".xlsx" onChange={e => e.target.files && upload(e.target.files[0])} />
        {brands.length > 0 && <p>{brands.length} brands. <button disabled={busy || !ref?.ok} onClick={run}>{busy ? "Researching…" : "Run evaluation"}</button></p>}
        {err && <p style={{ color: "crimson" }}>{err}</p>}
      </section>
      {evals.length > 0 && <section>
        <h3>3. Results <button onClick={download}>Download Excel</button></h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th align="left">Brand</th><th>Score (%)</th><th>Assessed weight</th><th align="left">Status</th></tr></thead>
          <tbody>{evals.map(e => <tr key={e.brand} style={{ borderTop: "1px solid #ddd" }}><td>{e.brand}</td><td align="center">{e.totalPct}</td><td align="center">{e.assessedWeight}</td><td>{e.status}</td></tr>)}</tbody></table>
      </section>}
    </main>);
}
