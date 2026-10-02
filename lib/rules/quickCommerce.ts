import { band, insufficient, RUBRIC, scored, type Rule } from "./context";

/** R08: verifiable quick-commerce listings. Blocked platforms are excluded, never counted as absent. */
export const quickCommerce: Rule = ({ facts }) => {
  const cfg = RUBRIC.R08_quick_commerce;
  const qc = facts.marketplaces.probes.filter(p => p.qc);
  const present = qc.filter(p => p.status === "present");
  const blocked = qc.filter(p => p.status.startsWith("unverifiable"));
  const readable = qc.filter(p => p.status === "present" || p.status === "absent");

  if (!readable.length) {
    return insufficient(
      `Every quick-commerce probe was blocked or empty (${qc.map(p => p.platform).join(", ") || "none"}), so presence is unknown. Absence was never inferred from a block.`,
      blocked.map(p => `${p.platform} blocked at ${p.url}`).join("; "),
      qc[0]?.url ?? "",
    );
  }
  const b = band(cfg.bands, present.length, "minCount");
  const missing = blocked.length
    ? `Unverifiable (blocked) quick-commerce platforms, excluded from the count: ${blocked.map(p => p.platform).join(", ")}.`
    : "";
  const evidence =
    `${present.length} of ${readable.length} readable quick-commerce platforms list the brand` +
    (present.length ? `: ${present.map(p => `${p.platform} ("${p.matchedTitle}")`).join("; ")}.` : `. Readable platforms with no match: ${qc.filter(p => p.status === "absent").map(p => p.platform).join(", ") || "none"}.`);
  return scored(b?.score ?? 0, present.length ? "Verified" : "Evidence-based assessment", evidence, present[0]?.url ?? qc[0]?.url ?? "", missing);
};
