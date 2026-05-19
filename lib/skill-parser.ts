import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { SkillInfo } from "../types.ts";

export function parseSkillMd(skillPath: string): SkillInfo {
  const skillFile = join(skillPath, "SKILL.md");
  const content = readFileSync(skillFile, "utf8");
  const parsed = parseFrontmatter(content);
  const frontmatter = parsed.frontmatter as Record<string, unknown>;

  const name = String(frontmatter.name || "").trim();
  let description = "";
  const rawDesc = frontmatter.description;
  if (typeof rawDesc === "string") {
    description = rawDesc.trim();
  } else if (Array.isArray(rawDesc)) {
    description = rawDesc.join(" ").trim();
  }

  return {
    name,
    description,
    content,
    frontmatter,
  };
}

export function buildSkillObject(skillPath: string): Skill {
  const info = parseSkillMd(skillPath);
  return {
    name: info.name,
    description: info.description,
    filePath: join(skillPath, "SKILL.md"),
    baseDir: skillPath,
    source: "custom",
  };
}
