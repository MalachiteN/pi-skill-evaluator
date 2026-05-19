import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { EvalItem, OptimizationAttempt, ParsedArgs } from "./types.ts";
import { parseArgs } from "./lib/args-parser.ts";
import { parseSkillMd } from "./lib/skill-parser.ts";
import { runEvalSet } from "./lib/eval-set-runner.ts";
import { improveDescription } from "./lib/description-optimizer.ts";
import { aggregateBenchmark } from "./lib/benchmark-aggregator.ts";
import { generateReport } from "./lib/report-generator.ts";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("skill-eval", {
    description: "Evaluate and optimize skill description trigger accuracy",
    handler: async (argsStr, ctx) => {
      let args: ParsedArgs;
      try {
        args = parseArgs(argsStr);
      } catch (e: any) {
        if (ctx.hasUI) ctx.ui.notify(e.message, "error");
        console.error(e.message);
        return;
      }

      const skillFile = join(args.skillPath, "SKILL.md");
      if (!existsSync(skillFile)) {
        const msg = `SKILL.md not found at ${args.skillPath}`;
        if (ctx.hasUI) ctx.ui.notify(msg, "error");
        console.error(msg);
        return;
      }

      let skillInfo;
      try {
        skillInfo = parseSkillMd(args.skillPath);
      } catch (e: any) {
        const msg = `Failed to parse SKILL.md: ${e.message}`;
        if (ctx.hasUI) ctx.ui.notify(msg, "error");
        console.error(msg);
        return;
      }

      if (!skillInfo.name) {
        const msg = "SKILL.md is missing a 'name' in frontmatter";
        if (ctx.hasUI) ctx.ui.notify(msg, "error");
        console.error(msg);
        return;
      }

      let evalSet: EvalItem[];
      try {
        const evalData = JSON.parse(readFileSync(args.evalSet, "utf8"));
        if (!Array.isArray(evalData)) {
          throw new Error("Eval set must be an array");
        }
        evalSet = evalData;
      } catch (e: any) {
        const msg = `Failed to load eval set from ${args.evalSet}: ${e.message}`;
        if (ctx.hasUI) ctx.ui.notify(msg, "error");
        console.error(msg);
        return;
      }

      mkdirSync(args.output, { recursive: true });

      const history: OptimizationAttempt[] = [];
      let bestDescription = skillInfo.description;
      let bestPassed = -1;

      const effectiveModel =
        args.model ||
        (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined);

      const maxIter = args.optimize ? args.maxIter : 1;

      for (let iter = 1; iter <= maxIter; iter++) {
        if (args.optimize && ctx.hasUI) {
          ctx.ui.notify(
            `Iteration ${iter}/${maxIter}: testing "${bestDescription.slice(0, 60)}..."`,
            "info"
          );
        }
        console.log(`\n=== Iteration ${iter}/${maxIter} ===`);
        console.log(`Description: ${bestDescription}`);

        const result = await runEvalSet({
          skillPath: args.skillPath,
          skillName: skillInfo.name,
          description: bestDescription,
          evalSet,
          runsPerQuery: args.runs,
          triggerThreshold: args.threshold,
          model: effectiveModel,
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
            model: effectiveModel,
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

        try {
          const newDesc = await improveDescription({
            skillName: skillInfo.name,
            skillContent: skillInfo.content,
            currentDescription: bestDescription,
            evalResults: result.batchResults,
            history,
            model: effectiveModel,
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

      if (ctx.hasUI) {
        ctx.ui.notify(
          `Skill eval complete: ${bestPassed}/${evalSet.length} passed`,
          bestPassed === evalSet.length ? "info" : "warning"
        );
      }
    },
  });
}
