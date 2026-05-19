import type { ParsedArgs } from "../types.ts";

export function parseArgs(argsStr: string): ParsedArgs {
  const args = argsStr.trim().split(/\s+/);
  const result: ParsedArgs = {
    skillPath: "",
    evalSet: "./evals.json",
    runs: 3,
    threshold: 0.5,
    output: "./skill-eval-results",
    optimize: false,
    maxIter: 5,
    parallel: false,
  };

  if (args.length === 0 || args[0].startsWith("--")) {
    throw new Error("Usage: /skill-eval <skill-path> [options]");
  }

  result.skillPath = args[0];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--eval-set":
        if (!next) throw new Error("--eval-set requires a value");
        result.evalSet = next;
        i++;
        break;
      case "--runs":
        if (!next) throw new Error("--runs requires a value");
        result.runs = parseInt(next, 10);
        i++;
        break;
      case "--threshold":
        if (!next) throw new Error("--threshold requires a value");
        result.threshold = parseFloat(next);
        i++;
        break;
      case "--model":
        if (!next) throw new Error("--model requires a value");
        result.model = next;
        i++;
        break;
      case "--output":
        if (!next) throw new Error("--output requires a value");
        result.output = next;
        i++;
        break;
      case "--optimize":
        result.optimize = true;
        break;
      case "--max-iter":
        if (!next) throw new Error("--max-iter requires a value");
        result.maxIter = parseInt(next, 10);
        i++;
        break;
      case "--report":
        if (!next) throw new Error("--report requires a value");
        result.report = next;
        i++;
        break;
      case "--baseline":
        if (!next) throw new Error("--baseline requires a value");
        result.baseline = next;
        i++;
        break;
      case "--parallel":
        result.parallel = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        break;
    }
  }

  return result;
}
