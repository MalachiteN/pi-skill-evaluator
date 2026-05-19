import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { OptimizationAttempt } from "./types.ts";
import { parseArgs } from "./lib/args-parser.ts";
import { parseSkillMd } from "./lib/skill-parser.ts";
import { runEvalSet } from "./lib/eval-set-runner.ts";
import { improveDescription } from "./lib/description-optimizer.ts";
import { aggregateBenchmark } from "./lib/benchmark-aggregator.ts";
import { generateReport } from "./lib/report-generator.ts";

const argsStr = process.argv.slice(2).join(" ") || "./test-skill --eval-set ./test-evals.json --runs 1 --output ./test-output";

async function main() {
  const args = parseArgs(argsStr);

  const skillPath = resolve(args.skillPath);
  const skillFile = join(skillPath, "SKILL.md");
  if (!existsSync(skillFile)) {
    console.error(`SKILL.md not found at ${skillPath}`);
    process.exit(1);
  }

  const skillInfo = parseSkillMd(skillPath);
  if (!skillInfo.name) {
    console.error("SKILL.md is missing a 'name' in frontmatter");
    process.exit(1);
  }

  const evalSetPath = resolve(args.evalSet);
  let evalSet;
  try {
    evalSet = JSON.parse(readFileSync(evalSetPath, "utf8"));
    if (!Array.isArray(evalSet)) throw new Error("Eval set must be an array");
  } catch (e: any) {
    console.error(`Failed to load eval set: ${e.message}`);
    process.exit(1);
  }

  const outputDir = resolve(args.output);
  mkdirSync(outputDir, { recursive: true });

  console.log(`Evaluating skill: ${skillInfo.name}`);
  console.log(`Initial description: ${skillInfo.description}`);
  console.log(`Eval set: ${evalSetPath} (${evalSet.length} items)`);
  console.log(`Runs per query: ${args.runs}`);
  console.log(`Output: ${outputDir}`);
  console.log(`Optimize: ${args.optimize}`);
  console.log(`Max iterations: ${args.maxIter}\n`);

  const history: OptimizationAttempt[] = [];
  let bestDescription = skillInfo.description;
  let bestPassed = -1;
  const maxIter = args.optimize ? args.maxIter : 1;

  for (let iter = 1; iter <= maxIter; iter++) {
    console.log(`\n=== Iteration ${iter}/${maxIter} ===`);
    console.log(`Description: ${bestDescription}`);

    const result = await runEvalSet({
      skillPath,
      skillName: skillInfo.name,
      description: bestDescription,
      evalSet,
      runsPerQuery: args.runs,
      triggerThreshold: args.threshold,
      model: args.model,
      parallel: args.parallel,
      outputDir,
      iteration: iter,
    });

    const passed = result.summary.passed;
    const total = result.summary.total;

    console.log(`Result: ${passed}/${total} passed`);
    for (const br of result.batchResults) {
      const status = br.pass ? "PASS" : "FAIL";
      console.log(`  [${status}] "${br.query}" => triggered=${br.triggers > 0} (rate=${br.triggerRate.toFixed(2)}) (expected=${br.shouldTrigger})`);
    }

    const iterDir = join(outputDir, `iteration-${iter}`);
    writeFileSync(
      join(iterDir, "eval_results.json"),
      JSON.stringify(result, null, 2),
      "utf8"
    );

    if (passed > bestPassed) {
      bestPassed = passed;
    }

    if (args.baseline && iter === 1) {
      console.log("\n--- Running baseline ---");
      const baselinePath = resolve(args.baseline);
      const baselineSkillInfo = parseSkillMd(baselinePath);
      const baselineResult = await runEvalSet({
        skillPath: baselinePath,
        skillName: baselineSkillInfo.name,
        description: baselineSkillInfo.description,
        evalSet,
        runsPerQuery: args.runs,
        triggerThreshold: args.threshold,
        model: args.model,
        parallel: args.parallel,
        outputDir,
        iteration: iter,
        configName: "old_skill",
      });
      const baselineDir = join(outputDir, "iteration-1", "old_skill");
      mkdirSync(baselineDir, { recursive: true });
      writeFileSync(
        join(baselineDir, "eval_results.json"),
        JSON.stringify(baselineResult, null, 2),
        "utf8"
      );
      console.log(`Baseline: ${baselineResult.summary.passed}/${baselineResult.summary.total} passed`);
    }

    try {
      aggregateBenchmark(iterDir, skillInfo.name, skillPath);
    } catch (e: any) {
      console.error(`Benchmark aggregation failed: ${e.message}`);
    }

    if (args.report) {
      const reportPath =
        iter === maxIter
          ? resolve(args.report)
          : join(outputDir, `iteration-${iter}`, "report.html");
      try {
        generateReport(
          iterDir,
          skillInfo.name,
          reportPath,
          join(iterDir, "benchmark.json")
        );
        console.log(`Report: ${reportPath}`);
      } catch (e: any) {
        console.error(`Report generation failed: ${e.message}`);
      }
    }

    if (!args.optimize || passed === total) {
      if (args.optimize && passed === total) {
        console.log("Perfect score reached!");
      }
      break;
    }

    history.push({
      description: bestDescription,
      passed,
      failed: result.summary.failed,
      total,
      results: result.batchResults,
    });

    console.log(`[optimize] Attempting to improve description (iter ${iter})...`);
    try {
      const newDesc = await improveDescription({
        skillName: skillInfo.name,
        skillContent: skillInfo.content,
        currentDescription: bestDescription,
        evalResults: result.batchResults,
        history,
        model: args.model,
      });
      bestDescription = newDesc;
      console.log(`Improved description: ${bestDescription}`);
    } catch (e: any) {
      console.error(`Description optimization failed: ${e.message}`);
      break;
    }
  }

  console.log("\n=== Final Summary ===");
  console.log(`Best description: ${bestDescription}`);
  console.log(`Best score: ${bestPassed}/${evalSet.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
