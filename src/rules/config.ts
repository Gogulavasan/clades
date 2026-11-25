/** Typed view of config/rules.json and config/benchmarks.json. */
import benchmarksJson from '../../config/benchmarks.json';
import rulesJson from '../../config/rules.json';
import type { BeneishConfig, BeneishRatio, TataMethod } from '../models/beneish';
import type { AltmanConfig } from '../models/others';
import type { HonestParams } from '../scoring/honest';

export type Leg = 'pressure' | 'opportunity' | 'rationalisation';
export const LEGS: readonly Leg[] = ['pressure', 'opportunity', 'rationalisation'];
export type Direction = 'higher' | 'lower';
export type Format = 'num' | 'pct' | 'ppt' | 'x' | 'days' | 'int' | 'pctpoints';

export interface RuleDef {
  id: string;
  battery: string;
  title: string;
  formula: string;
  direction: Direction;
  amber: number;
  red: number;
  weight: number;
  severity: 'low' | 'medium' | 'high';
  leg: Leg;
  format: Format;
  benchmark?: string;
  plain: string;
  innocent: string;
  nextStep: string;
  enabled?: boolean;
}

export interface ComboDef {
  id: string;
  text: string;
  anyOf?: string[] | '*';
  minLevel?: 'amber' | 'red';
  minCount?: number;
  modelsFlagging?: number;
  add?: number;
  floor?: number;
}

export interface RatioText {
  name: string;
  nonManipulator: number;
  manipulator: number;
  direction: string;
  leg: Leg;
  formula: string;
  plain: string;
  innocent: string;
  nextStep: string;
}

export interface RulesConfig {
  version: string;
  beneish: BeneishConfig & { tataMethod: TataMethod; ratioWeight: number; ratios: Record<BeneishRatio, RatioText> };
  models: {
    sloan: { flagAbove: number };
    altman: AltmanConfig & { distressBelow: number; safeAbove: number };
    piotroski: { weakAtOrBelow: number };
    benford: { minCount: number };
  };
  scoring: {
    amberFraction: number;
    legSaturation: number;
    minLegWeight: number;
    legWeights: Record<Leg, number>;
    tiers: { watchFrom: number; suspiciousFrom: number };
    legLevels: { medFrom: number; highFrom: number };
    combos: ComboDef[];
    confidence: Record<string, number>;
  };
  honestProfit: HonestParams;
  rules: RuleDef[];
}

export interface Benchmarks {
  placeholder: boolean;
  asOf: string | null;
  source: string;
  coverage: string;
  default: Record<string, number>;
  sectors: Record<string, Record<string, number>>;
}

export const RULES = rulesJson as unknown as RulesConfig;
export const BENCHMARKS = benchmarksJson as unknown as Benchmarks;
