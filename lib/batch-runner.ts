import type { BatchResult, EvalItem, EvalResult } from "../types.ts";
import { runSingleEval, writeRunArtifacts } from "./eval-runner.ts";

export interface BatchRunnerArgs {
  skillPath: string;
  skillName: string;
  description: string;
  evalItem: EvalItem;
  runsPerQuery: number;
  triggerThreshold: number;
  model?: string;
  tools?: string[];
  runDirBase?: string;
}

export async function runBatch(args: BatchRunnerArgs): Promise<BatchResult> {
  const results: EvalResult[] = [];
  let triggers = 0;

  for (let i = 0; i < args.runsPerQuery; i++) {
    const result = await runSingleEval({
      skillPath: args.skillPath,
      skillName: args.skillName,
      description: args.description,
      query: args.evalItem.query,
      model: args.model,
      tools: args.tools,
    });

    if (result.triggered) triggers++;
    results.push(result);

    // Write artifacts if runDirBase is provided
    if (args.runDirBase) {
      const runDir = `${args.runDirBase}/run-${i}`;
      writeRunArtifacts(runDir, args.skillPath, result, args.evalItem.shouldTrigger, i);
    }
  }

  const triggerRate = triggers / args.runsPerQuery;
  const pass = args.evalItem.shouldTrigger
    ? triggerRate >= args.triggerThreshold
    : triggerRate < args.triggerThreshold;

  return {
    query: args.evalItem.query,
    shouldTrigger: args.evalItem.shouldTrigger,
    triggerRate,
    triggers,
    runs: args.runsPerQuery,
    pass,
    results,
  };
}
