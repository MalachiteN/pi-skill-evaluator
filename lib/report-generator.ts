import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

function findScript(scriptName: string): string | undefined {
  const candidates = [
    join(process.env.HOME || process.env.USERPROFILE || "", ".agents", "skills", "skill-creator", "eval-viewer", scriptName),
    join(process.env.HOME || process.env.USERPROFILE || "", ".pi", "agent", "skills", "skill-creator", "eval-viewer", scriptName),
    join(process.env.HOME || process.env.USERPROFILE || "", ".pi", "skills", "skill-creator", "eval-viewer", scriptName),
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

export function generateReport(
  workspaceDir: string,
  skillName: string,
  reportPath: string,
  benchmarkPath?: string,
): void {
  const script = findScript("generate_review.py");
  if (!script) {
    throw new Error(
      "generate_review.py not found. Please install the skill-creator skill."
    );
  }

  const python = findPython();
  const args = [
    `"${script}"`,
    `"${workspaceDir}"`,
    "--skill-name",
    `"${skillName}"`,
    "--static",
    `"${reportPath}"`,
  ];
  if (benchmarkPath) {
    args.push("--benchmark", `"${benchmarkPath}"`);
  }

  execSync(`${python} ${args.join(" ")}`, {
    stdio: "inherit",
    encoding: "utf8",
  });
}
