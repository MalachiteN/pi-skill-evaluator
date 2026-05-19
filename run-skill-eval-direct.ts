import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "./lib/args-parser.ts";
import { parseSkillMd } from "./lib/skill-parser.ts";
import { runEvalSet } from "./lib/eval-set-runner.ts";
import { improveDescription } from "./lib/description-optimizer.ts";
import { aggregateBenchmark } from "./lib/benchmark-aggregator.ts";
import { generateReport } from "./lib/report-generator.ts";
import type { OptimizationAttempt } from "./types.ts";

async function main() {
  const argsStr = process.argv.slice(2).join(" ");
  if (!argsStr.trim()) {
    console.error("Usage: npx tsx run-skill-eval-direct.ts <skill-path> [options]");
    process.exit(1);
  }

  const args = parseArgs(argsStr);

  const skillFile = join(args.skillPath, "SKILL.md");
  if (!existsSync(skillFile)) {
    console.error(`SKILL.md not found at ${args.skillPath}`);
    process.exit(1);
  }

  const skillInfo = parseSkillMd(args.skillPath);
  if (!skillInfo.name) {
    console.error("SKILL.md is missing a 'name' in frontmatter");
    process.exit(1);
  }

  const evalSet = JSON.parse(readFileSync(args.evalSet, "utf8"));
  if (!Array.isArray(evalSet)) {
    console.error("Eval set must be an array");
    process.exit(1);
  }

  mkdirSync(args.output, { recursive: true });

  const history: OptimizationAttempt[] = [];
  let bestDescription = skillInfo.description;
  let bestPassed = -1;

  const maxIter = args.optimize ? args.maxIter : 1;

  for (let iter = 1; iter <= maxIter; iter++) {
    console.log(`\n=== Iteration ${iter}/${maxIter} ===`);
    console.log(`Description: ${bestDescription}`);

    const result = await runEvalSet({
      skillPath: args.skillPath,
      skillName: skillInfo.name,
      description: bestDescription,
      evalSet,
      runsPerQuery: args.runs,
      triggerThreshold: args.threshold,
      model: args.model,
      parallel: args.parallel,
      outputDir: args.output,
      iteration: iter,
    });

    const passed = result.summary.passed;
    const total = result.summary.total;
    console.log(`Result: ${passed}/${total} passed`);

    writeFileSync(
      join(args.output, `iteration-${iter}`, "eval_results.json"),
      JSON.stringify(result, null, 2),
      "utf8"
    );

    if (passed > bestPassed) {
      bestPassed = passed;
    }

    if (args.baseline && iter === 1) {
      console.log("\n--- Running baseline ---");
      const baselineSkillInfo = parseSkillMd(args.baseline);
      const baselineResult = await runEvalSet({
        skillPath: args.baseline,
        skillName: baselineSkillInfo.name,
        description: baselineSkillInfo.description,
        evalSet,
        runsPerQuery: args.runs,
        triggerThreshold: args.threshold,
        model: args.model,
        parallel: args.parallel,
        outputDir: args.output,
        iteration: iter,
        configName: "old_skill",
      });
      console.log(`Baseline: ${baselineResult.summary.passed}/${baselineResult.summary.total} passed`);
    }

    const iterDir = join(args.output, `iteration-${iter}`);
    try {
      aggregateBenchmark(iterDir, skillInfo.name, args.skillPath);
    } catch (e: any) {
      console.error(`Benchmark aggregation failed: ${e.message}`);
    }

    if (args.report) {
      const reportPath =
        iter === maxIter
          ? args.report
          : join(args.output, `iteration-${iter}`, "report.html");
      try {
        generateReport(iterDir, skillInfo.name, reportPath, join(iterDir, "benchmark.json"));
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
