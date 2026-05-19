import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

function findScript(scriptName: string): string | undefined {
  const candidates = [
    join(process.env.HOME || process.env.USERPROFILE || "", ".agents", "skills", "skill-creator", "scripts", scriptName),
    join(process.env.HOME || process.env.USERPROFILE || "", ".pi", "agent", "skills", "skill-creator", "scripts", scriptName),
    join(process.env.HOME || process.env.USERPROFILE || "", ".pi", "skills", "skill-creator", "scripts", scriptName),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return undefined;
}

function findPython(): string {
  for (const cmd of ["python", "python3", "py"]) {
    try {
      execSync(`${cmd} --version`, { stdio: "ignore" });
      return cmd;
    } catch {
      // ignore
    }
  }
  throw new Error("No Python interpreter found (tried python3, python, py)");
}

export function aggregateBenchmark(
  workspaceDir: string,
  skillName: string,
  skillPath: string,
  outputPath?: string,
): { jsonPath: string; mdPath: string } {
  const script = findScript("aggregate_benchmark.py");
  if (!script) {
    throw new Error(
      "aggregate_benchmark.py not found. Please install the skill-creator skill."
    );
  }

  const python = findPython();
  const args = [
    `"${script}"`,
    `"${workspaceDir}"`,
    "--skill-name",
    `"${skillName}"`,
    "--skill-path",
    `"${skillPath}"`,
  ];
  if (outputPath) {
    args.push("--output", `"${outputPath}"`);
  }

  execSync(`${python} ${args.join(" ")}`, {
    stdio: "inherit",
    encoding: "utf8",
  });

  const jsonPath = outputPath || join(workspaceDir, "benchmark.json");
  return {
    jsonPath,
    mdPath: jsonPath.replace(/\.json$/, ".md"),
  };
}
