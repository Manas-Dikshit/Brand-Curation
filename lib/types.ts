export type BrandInput = { brand: string; website?: string | null; instagram?: string | null };

export type Verification = "Verified" | "Evidence-based assessment" | "Insufficient Data";

export type Pillar =
  | "Product & Market Fit"
  | "Revenue & Financial Performance"
  | "Brand Presence & Marketing"
  | "Distribution Channels";

export type CriterionResult = {
  /** Must match the reference workbook row exactly. */
  name: string;
  score: number | null;
  verification: Verification;
  evidence: string;
  sourceUrl: string;
  missing: string;
  /** Which rule produced this score. Rules may only emit their own id. */
  ruleId: string | null;
  /** auto = deterministic rule; analyst = human override (analyst wins in totals). */
  source: "auto" | "analyst";
  /** Criteria we do not attempt automatically at all. */
  attempted?: boolean;
};

export type Evaluation = {
  brand: string;
  website?: string | null;
  instagram?: string | null;
  results: CriterionResult[];
  totalPct: number;
  assessedWeight: number;
  status: string;
  pillarSubtotals: Record<string, number>;
  durationMs?: number;
  error?: string;
  auto?: CriterionResult[];
  /** Platforms that were bot-protected for this brand; never counted as absent. */
  blockedPlatforms?: string[];
};
