import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { cwd } from "node:process";
import type { EvalResult } from "../types.ts";
import { buildSkillObject } from "./skill-parser.ts";

function resolveModel(registry: ModelRegistry, pattern: string): any | undefined {
  if (pattern.includes("/")) {
    const [provider, id] = pattern.split("/", 2);
    return registry.find(provider, id);
  }
  // Try exact id match across all models
  const all = registry.getAll();
  let found = all.find((m: any) => m.id === pattern);
  if (found) return found;
  // Try fuzzy match on id or name
  found = all.find((m: any) => m.id.includes(pattern) || m.name?.includes(pattern));
  if (found) return found;
  // Fallback: first model (usually safe)
  return all[0];
}

export interface EvalRunnerArgs {
  skillPath: string;
  skillName: string;
  description: string;
  query: string;
  model?: string;
  tools?: string[];
}

export async function runSingleEval(args: EvalRunnerArgs): Promise<EvalResult> {
  const startTime = Date.now();
  const skill = buildSkillObject(args.skillPath);

  // Override description if testing an improved one
  const testSkill = { ...skill, description: args.description };

  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    skillsOverride: (current) => ({
      skills: [...current.skills, testSkill],
      diagnostics: current.diagnostics,
    }),
  });
  await loader.reload();

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    resourceLoader: loader,
    tools: args.tools ?? ["read", "bash"],
    authStorage,
    modelRegistry,
    model: args.model
      ? resolveModel(modelRegistry, args.model)
      : undefined,
  });

  let triggered = false;
  const messagesSnapshot: AgentMessage[] = [];

  const unsub = session.subscribe((event) => {
    if (event.type === "tool_execution_start" && event.toolName === "read") {
      const path = event.args?.path || event.args?.file_path;
      if (path === skill.filePath) {
        triggered = true;
      }
    }
    if (event.type === "message_end" && event.message) {
      messagesSnapshot.push(event.message);
    }
  });

  try {
    await session.prompt(args.query);
  } finally {
    unsub();
  }

  // Extract usage from the last assistant message
  const assistantMessages = messagesSnapshot.filter((m) => m.role === "assistant");
  const lastAssistant = assistantMessages[assistantMessages.length - 1];
  const usage = lastAssistant?.usage;

  const timeMs = Date.now() - startTime;

  session.dispose();

  return {
    query: args.query,
    triggered,
    triggerConfidence: triggered ? 1.0 : 0.0,
    timeMs,
    tokens: {
      input: usage?.input ?? 0,
      output: usage?.output ?? 0,
      total: usage?.totalTokens ?? 0,
      cacheRead: usage?.cacheRead ?? 0,
      cacheWrite: usage?.cacheWrite ?? 0,
    },
    cost: usage?.cost?.total ?? 0,
    messagesSnapshot,
  };
}

export function writeRunArtifacts(
  runDir: string,
  skillPath: string,
  evalResult: EvalResult,
  shouldTrigger: boolean,
  runIndex: number,
): void {
  const skillFilePath = join(skillPath, "SKILL.md");
  mkdirSync(runDir, { recursive: true });
  const outputsDir = join(runDir, "outputs");
  mkdirSync(outputsDir, { recursive: true });

  // Build transcript.md
  const lines: string[] = [
    "# Eval Run Transcript",
    "",
    `## Eval Prompt`,
    "",
    evalResult.query,
    "",
    `## Run ${runIndex}`,
    "",
    `Triggered: ${evalResult.triggered}`,
    `Expected: ${shouldTrigger ? "trigger" : "no trigger"}`,
    `Duration: ${(evalResult.timeMs / 1000).toFixed(2)}s`,
    `Tokens: ${evalResult.tokens.total} (↑${evalResult.tokens.input} ↓${evalResult.tokens.output})`,
    "",
    "## Messages",
    "",
  ];

  for (const msg of evalResult.messagesSnapshot) {
    lines.push(`### ${msg.role}`);
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") lines.push(part.text);
        else if (part.type === "toolCall") {
          lines.push(`\`\`\`json\n${JSON.stringify({ name: part.name, arguments: part.arguments }, null, 2)}\n\`\`\``);
        }
      }
    } else if (msg.role === "user") {
      for (const part of msg.content) {
        if (part.type === "text") lines.push(part.text);
      }
    } else if (msg.role === "toolResult") {
      lines.push(`Tool: ${(msg as any).toolName}`);
      for (const part of msg.content) {
        if (part.type === "text") lines.push(part.text);
      }
    }
    lines.push("");
  }

  writeFileSync(join(outputsDir, "transcript.md"), lines.join("\n"), "utf8");

  // Also write response.md so generate_review.py shows output files
  const lastAssistantMsg = evalResult.messagesSnapshot
    .filter((m) => m.role === "assistant")
    .pop();
  const responseText = lastAssistantMsg?.content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n") ?? "";
  if (responseText.trim()) {
    writeFileSync(join(outputsDir, "response.md"), responseText.trim(), "utf8");
  }

  // grading.json
  const pass = shouldTrigger === evalResult.triggered;
  const grading = {
    summary: {
      pass_rate: pass ? 1.0 : 0.0,
      passed: pass ? 1 : 0,
      failed: pass ? 0 : 1,
      total: 1,
    },
    timing: {
      total_duration_seconds: evalResult.timeMs / 1000,
    },
    execution_metrics: {
      total_tool_calls: evalResult.messagesSnapshot.filter(
        (m) => m.role === "assistant" && m.content.some((c) => c.type === "toolCall"),
      ).length,
      output_chars: JSON.stringify(evalResult.messagesSnapshot).length,
      errors_encountered: 0,
    },
    expectations: [
      {
        text: shouldTrigger ? "Skill should be triggered" : "Skill should NOT be triggered",
        passed: pass,
        evidence: evalResult.triggered
          ? `Read tool called for ${skillFilePath}`
          : `Read tool was not called for ${skillFilePath}`,
      },
    ],
    user_notes_summary: {
      uncertainties: [],
      needs_review: [],
      workarounds: [],
    },
  };
  writeFileSync(join(runDir, "grading.json"), JSON.stringify(grading, null, 2), "utf8");

  // timing.json
  const timing = {
    total_duration_seconds: evalResult.timeMs / 1000,
    total_tokens: evalResult.tokens.total,
  };
  writeFileSync(join(runDir, "timing.json"), JSON.stringify(timing, null, 2), "utf8");
}
