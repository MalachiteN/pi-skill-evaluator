import type { BatchResult, OptimizationAttempt } from "../types.ts";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

function resolveModel(registry: ModelRegistry, pattern: string): any | undefined {
  if (pattern.includes("/")) {
    const [provider, id] = pattern.split("/", 2);
    return registry.find(provider, id);
  }
  const all = registry.getAll();
  let found = all.find((m: any) => m.id === pattern);
  if (found) return found;
  found = all.find((m: any) => m.id.includes(pattern) || m.name?.includes(pattern));
  if (found) return found;
  return all[0];
}

export interface ImproveArgs {
  skillName: string;
  skillContent: string;
  currentDescription: string;
  evalResults: BatchResult[];
  history: OptimizationAttempt[];
  model?: string;
}

export async function improveDescription(args: ImproveArgs): Promise<string> {
  const failedTriggers = args.evalResults.filter(
    (r) => r.shouldTrigger && !r.pass
  );
  const falseTriggers = args.evalResults.filter(
    (r) => !r.shouldTrigger && !r.pass
  );

  const trainScore = `${args.evalResults.filter((r) => r.pass).length}/${args.evalResults.length}`;

  let prompt = `You are optimizing a skill description for a pi coding agent skill called "${args.skillName}". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that the agent sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.

The description appears in the agent's available skills list. When a user sends a query, the agent decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.

Here's the current description:
<current_description>
"${args.currentDescription}"
</current_description>

Current scores (Train: ${trainScore}):
<scores_summary>
`;

  if (failedTriggers.length > 0) {
    prompt += "FAILED TO TRIGGER (should have triggered but didn't):\n";
    for (const r of failedTriggers) {
      prompt += `  - "${r.query}" (triggered ${r.triggers}/${r.runs} times)\n`;
    }
    prompt += "\n";
  }

  if (falseTriggers.length > 0) {
    prompt += "FALSE TRIGGERS (triggered but shouldn't have):\n";
    for (const r of falseTriggers) {
      prompt += `  - "${r.query}" (triggered ${r.triggers}/${r.runs} times)\n`;
    }
    prompt += "\n";
  }

  if (args.history.length > 0) {
    prompt +=
      "PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):\n\n";
    for (const h of args.history) {
      const scoreStr = `${h.passed}/${h.total}`;
      prompt += `<attempt train=${scoreStr}>\n`;
      prompt += `Description: "${h.description}"\n`;
      if (h.note) prompt += `Note: ${h.note}\n`;
      prompt += "</attempt>\n\n";
    }
  }

  prompt += `</scores_summary>

Skill content (for context on what the skill does):
<skill_content>
${args.skillContent}
</skill_content>

Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful.

Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.

Here are some tips that we've found to work well in writing these descriptions:
- The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
- The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
- The description competes with other skills for the agent's attention — make it distinctive and immediately recognizable.
- If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.

Please respond with only the new description text in <new_description> tags, nothing else.`;

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
    model: args.model ? resolveModel(modelRegistry, args.model) : undefined,
    tools: ["read", "bash"],
  });
  let responseText = "";

  const unsub = session.subscribe((event) => {
    if (event.type === "message_end" && event.message?.role === "assistant") {
      for (const part of event.message.content) {
        if (part.type === "text") {
          responseText += part.text;
        }
      }
    }
  });

  try {
    await session.prompt(prompt);
  } catch (e: any) {
    console.error("Description optimization failed:", e.message);
    throw e;
  } finally {
    unsub();
    session.dispose();
  }

  const match = responseText.match(/<new_description>([\s\S]*?)<\/new_description>/);
  let description = match ? match[1].trim().replace(/^"|"$/g, "") : responseText.trim().replace(/^"|"$/g, "");

  if (description.length > 1024) {
    // Truncate to last sentence under 1024 chars as a safety net
    const truncated = description.slice(0, 1024);
    const lastPeriod = truncated.lastIndexOf(".");
    if (lastPeriod > 500) {
      description = truncated.slice(0, lastPeriod + 1);
    } else {
      description = truncated;
    }
  }

  return description;
}
