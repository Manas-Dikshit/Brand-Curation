import { round } from "../util/text";
import { band, insufficient, RUBRIC, scored, type Rule } from "./context";

/** R14: followers / post count / engagement from public markup only. Recency needs verifiable dates. */
export const social: Rule = ({ facts }) => {
  const cfg = RUBRIC.R14_social;
  const parsed = facts.social.profiles.filter(p => p.status === "parsed" && p.followers !== null);
  const walled = facts.social.profiles.filter(p => p.status !== "parsed");

  if (!facts.social.profiles.length) {
    return insufficient(
      facts.site.status === "unresolved"
        ? "Site unresolved and no analyst-supplied Instagram handle, so no social profile could be located."
        : "No social profile links found on the brand's site or in JSON-LD sameAs.",
    );
  }
  if (!parsed.length) {
    return insufficient(
      `Every profile (${facts.social.profiles.map(p => p.platform).join(", ")}) is login-walled or blocked, so follower counts are unknown. ` +
      "Blocked is recorded as Insufficient Data, never as zero followers.",
    );
  }

  const best = parsed.reduce((a, b) => ((b.followers ?? 0) > (a.followers ?? 0) ? b : a));
  const followers = best.followers ?? 0;
  const posts = best.posts;
  const likes = best.likes;
  const engagement = likes !== null && followers ? (likes / followers) * 100 : null;

  let score = band(cfg.followerBands, followers, "min")?.score ?? 1;
  const notes: string[] = [];
  if (posts !== null && posts >= cfg.postCountBonus.minPosts && score < cfg.postCountBonus.maxScore) {
    score = Math.min(cfg.postCountBonus.maxScore, score + cfg.postCountBonus.bonus);
    notes.push(`+1 for ${posts} published posts (volume/consistency).`);
  }
  if (engagement !== null) {
    const eBand = band(cfg.engagementBands, engagement, "minRatePct");
    if (eBand && eBand.score < score) {
      score = eBand.score;
      notes.push(`Capped to ${eBand.score} by a publicly parseable engagement proxy of ${round(engagement, 2)}% (likes/followers).`);
    }
  }

  return scored(
    Math.min(5, score),
    "Verified",
    `${best.platform} public meta: ${followers} followers${posts !== null ? `, ${posts} posts` : ""}${likes !== null ? `, ${likes} likes` : ""}. ${notes.join(" ")}`.trim() +
    (engagement === null ? " Engagement rate not computable: likes/comments are not publicly parseable, so followers and volume only." : ""),
    best.url,
    [
      walled.length ? `Login-walled/blocked and therefore excluded: ${walled.map(p => p.platform).join(", ")}.` : "",
      "Post recency is not scored: last-post dates are not reliably present in public markup.",
      "Follower count is not proof of revenue, reach or repeat purchase.",
    ].filter(Boolean).join(" "),
  );
};
