import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BatchResult, EvalItem, EvalSetResult } from "../types.ts";
import { runBatch } from "./batch-runner.ts";

export interface EvalSetRunnerArgs {
  skillPath: string;
  skillName: string;
  description: string;
  evalSet: EvalItem[];
  runsPerQuery?: number;
  triggerThreshold?: number;
  model?: string;
  tools?: string[];
  parallel?: boolean;
  outputDir?: string;
  iteration?: number;
  configName?: string;
}

export async function runEvalSet(args: EvalSetRunnerArgs): Promise<EvalSetResult> {
  const runsPerQuery = args.runsPerQuery ?? 3;
  const threshold = args.triggerThreshold ?? 0.5;
  const iteration = args.iteration ?? 1;
  const outputDir = args.outputDir
    ? join(args.outputDir, `iteration-${iteration}`)
    : undefined;

  if (outputDir) {
    mkdirSync(outputDir, { recursive: true });
  }

  const batchResults: BatchResult[] = [];

  const runBatchForItem = async (item: EvalItem, index: number): Promise<BatchResult> => {
    const config = args.configName ?? "with_skill";
    const evalDir = outputDir ? join(outputDir, `eval-${index}`) : undefined;
    const configDir = evalDir ? join(evalDir, config) : undefined;

    if (evalDir) {
      mkdirSync(evalDir, { recursive: true });
      // Write eval_metadata.json only if not already present (avoid baseline overwrite)
      const metaPath = join(evalDir, "eval_metadata.json");
      if (!existsSync(metaPath)) {
        writeFileSync(
          metaPath,
          JSON.stringify({ eval_id: index, prompt: item.query }, null, 2),
          "utf8",
        );
      }
    }

    const result = await runBatch({
      skillPath: args.skillPath,
      skillName: args.skillName,
      description: args.description,
      evalItem: item,
      runsPerQuery,
      triggerThreshold: threshold,
      model: args.model,
      tools: args.tools,
      runDirBase: configDir,
    });

    return result;
  };

  if (args.parallel) {
    const promises = args.evalSet.map((item, index) => runBatchForItem(item, index));
    const results = await Promise.all(promises);
    batchResults.push(...results);
  } else {
    for (let i = 0; i < args.evalSet.length; i++) {
      const result = await runBatchForItem(args.evalSet[i], i);
      batchResults.push(result);
    }
  }

  const passed = batchResults.filter((r) => r.pass).length;
  const total = batchResults.length;

  return {
    skillPath: args.skillPath,
    skillName: args.skillName,
    description: args.description,
    batchResults,
    summary: {
      total,
      passed,
      failed: total - passed,
    },
  };
}
