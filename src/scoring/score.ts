/** Fraud Triangle scoring: rule results -> three leg scores (0-100) -> combination rules -> tier. */
import { LEGS, type Leg, type RulesConfig } from '../rules/config';
import type { Level, RuleResult } from '../rules/engine';

export type Tier = 'clean' | 'watch' | 'suspicious' | 'not_assessable';
export const TIER_LABEL: Record<Tier, string> = { clean: 'CLEAN', watch: 'WATCH', suspicious: 'SUSPICIOUS', not_assessable: 'NOT ASSESSABLE' };

export interface LegScore {
  /** null = too few assessable rules to score this leg. */
  score: number | null;
  level: 'LOW' | 'MED' | 'HIGH' | 'N/A';
  points: number;
  assessableWeight: number;
  totalWeight: number;
  flagged: number;
}

export interface ScoreResult {
  triangle: Record<Leg, LegScore>;
  baseScore: number | null;
  score: number | null;
  tier: Tier;
  combos: { id: string; text: string; effect: string }[];
  /** Share of total rule weight that could actually be assessed. */
  coverage: number;
}

const SCORED: readonly Level[] = ['green', 'amber', 'red'];
const MAX_SCORE = 100;
const atLeast = (l: Level, min: 'amber' | 'red'): boolean => l === 'red' || (min === 'amber' && l === 'amber');

export const tierFor = (score: number, cfg: RulesConfig): Tier =>
  score >= cfg.scoring.tiers.suspiciousFrom ? 'suspicious' : score >= cfg.scoring.tiers.watchFrom ? 'watch' : 'clean';

export function scoreRules(results: RuleResult[], modelsFlagging: number, cfg: RulesConfig): ScoreResult {
  const s = cfg.scoring;
  const triangle = {} as Record<Leg, LegScore>;
  let weighted = 0;
  let weightSum = 0;
  let assessable = 0;
  let total = 0;
  for (const leg of LEGS) {
    const all = results.filter((r) => r.leg === leg && r.weight > 0);
    const live = all.filter((r) => SCORED.includes(r.level));
    const totalWeight = all.reduce((a, r) => a + r.weight, 0);
    const assessableWeight = live.reduce((a, r) => a + r.weight, 0);
    const points = live.reduce((a, r) => a + r.points, 0);
    const score = assessableWeight >= s.minLegWeight ? Math.min(MAX_SCORE, (MAX_SCORE * points) / (s.legSaturation * assessableWeight)) : null;
    triangle[leg] = {
      score: score === null ? null : Math.round(score),
      level: score === null ? 'N/A' : score >= s.legLevels.highFrom ? 'HIGH' : score >= s.legLevels.medFrom ? 'MED' : 'LOW',
      points, assessableWeight, totalWeight, flagged: live.filter((r) => r.level !== 'green').length,
    };
    assessable += assessableWeight;
    total += totalWeight;
    if (score !== null) {
      weighted += score * s.legWeights[leg];
      weightSum += s.legWeights[leg];
    }
  }
  const coverage = total > 0 ? assessable / total : 0;
  if (weightSum === 0) return { triangle, baseScore: null, score: null, tier: 'not_assessable', combos: [], coverage };

  const baseScore = weighted / weightSum;
  let score = baseScore;
  const combos: ScoreResult['combos'] = [];
  for (const c of s.combos) {
    let hit = false;
    if (c.modelsFlagging !== undefined) hit = modelsFlagging >= c.modelsFlagging;
    else if (c.anyOf !== undefined) {
      const pool = c.anyOf === '*' ? results.filter((r) => r.weight > 0) : results.filter((r) => c.anyOf?.includes(r.id));
      hit = pool.filter((r) => atLeast(r.level, c.minLevel ?? 'amber')).length >= (c.minCount ?? 1);
    }
    if (!hit) continue;
    const before = score;
    if (c.add !== undefined) score += c.add;
    if (c.floor !== undefined) score = Math.max(score, c.floor);
    score = Math.min(MAX_SCORE, score);
    combos.push({ id: c.id, text: c.text, effect: c.add !== undefined ? `+${c.add} points` : score > before ? `score raised to the floor of ${c.floor}` : `floor of ${c.floor} already exceeded` });
  }
  const rounded = Math.round(score);
  return { triangle, baseScore: Math.round(baseScore), score: rounded, tier: tierFor(rounded, cfg), combos, coverage };
}
