import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface EvalItem {
  query: string;
  shouldTrigger: boolean;
}

export interface EvalResult {
  query: string;
  triggered: boolean;
  triggerConfidence: number;
  timeMs: number;
  tokens: {
    input: number;
    output: number;
    total: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  cost?: number;
  messagesSnapshot: AgentMessage[];
}

export interface BatchResult {
  query: string;
  shouldTrigger: boolean;
  triggerRate: number;
  triggers: number;
  runs: number;
  pass: boolean;
  results: EvalResult[];
}

export interface EvalSetResult {
  skillPath: string;
  skillName: string;
  description: string;
  batchResults: BatchResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}

export interface OptimizationAttempt {
  description: string;
  passed: number;
  failed: number;
  total: number;
  results?: BatchResult[];
  note?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  content: string;
  frontmatter: Record<string, unknown>;
}

export interface ParsedArgs {
  skillPath: string;
  evalSet: string;
  runs: number;
  threshold: number;
  model?: string;
  output: string;
  optimize: boolean;
  maxIter: number;
  report?: string;
  baseline?: string;
  parallel: boolean;
}
