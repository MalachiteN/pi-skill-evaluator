# pi-skill-evaluator 开发前阅读引导

> 本文档回答一个问题：**在开始编码之前，agent 应该读哪些 pi 文档？哪些可以跳过？按什么顺序读？**

pi 的文档体系庞大但结构清晰。本项目的核心依赖是 **Extension API** 和 **SDK**，因此阅读策略围绕这两个接口展开。

---

## 阅读顺序（必须按此顺序）

### Phase 1：建立整体认知（5 分钟）

1. **README.md**（pi 本体根目录）
   - 读 **Quick Start** 到 **Programmatic Usage** 即可
   - 重点理解：pi 的四种运行模式（interactive / print / JSON / RPC）
   - 明确 `pi -p` 就是我们要用的入口
   - 路径：`C:\ProgramData\nvm\v24.15.0\node_modules\@earendil-works\pi-coding-agent\README.md`

### Phase 2：掌握扩展机制（核心，15-20 分钟）

2. **extensions.md**（全文精读）
   - 这是本项目最核心的文档，**每一个章节都可能用到**
   - 必须完整阅读的部分：
     - Quick Start（最小扩展长什么样）
     - Extension Locations（扩展放在哪）
     - Writing an Extension（工厂函数签名）
     - 所有 Events 章节（尤其 `tool_call`、`tool_execution_start`、`before_agent_start`、`session_start`）
     - ExtensionContext（`ctx.ui`、`ctx.sessionManager`、`ctx.signal` 等）
     - ExtensionCommandContext（`ctx.waitForIdle()`、`ctx.newSession()` 等）
     - ExtensionAPI Methods（`pi.registerTool`、`pi.registerCommand`、`pi.sendMessage`、`pi.appendEntry`）
     - Custom Tools（`pi.registerTool()` 的完整参数）
   - 可以跳过的部分：
     - Custom UI（本项目是批处理模式，无交互）
     - Message Renderer（除非后期需要美化 TUI 输出）
     - Doom overlay / Snake 等游戏示例（纯娱乐）
   - 路径：`C:\ProgramData\nvm\v24.15.0\node_modules\@earendil-works\pi-coding-agent\docs\extensions.md`

3. **sdk.md**（按需分段，10 分钟）
   - 本项目大量使用 SDK，但不是全部功能
   - **必须读的章节**：
     - `createAgentSession()` — 如何创建隔离的测试会话
     - `AgentSession` 接口 — `prompt()`、`subscribe()`、`dispose()`
     - `DefaultResourceLoader` — `skillsOverride` 是注入被测 skill 的核心
     - `SessionManager` — `SessionManager.inMemory()` 和 `SessionManager.create()`
     - `SettingsManager` — 如果需要自定义测试环境配置
   - **可以跳过的章节**：
     - `createAgentSessionRuntime()`（除非要重写 pi 的运行时）
     - `InteractiveMode` / `runPrintMode` / `runRpcMode`（这些是 pi 内置的运行模式，扩展内不需要）
     - Session tree navigation（本项目不涉及分支导航）
     - Custom providers（除非测试需要切换模型提供商）
   - 路径：`C:\ProgramData\nvm\v24.15.0\node_modules\@earendil-works\pi-coding-agent\docs\sdk.md`

### Phase 3：理解运行模式与事件格式（5 分钟）

4. **json.md**（速览）
   - 了解 `--mode json` 的输出格式（JSONL）
   - 本项目虽然不用 `pi --mode json` 做测试，但 `session.subscribe()` 的事件类型和 JSON 模式的事件是一一对应的
   - 重点看 event types 的枚举值
   - 路径：`C:\ProgramData\nvm\v24.15.0\node_modules\@earendil-works\pi-coding-agent\docs\json.md`

5. **usage.md**（速览）
   - 只看 CLI 参数表，确认 `pi -p`、`--skill`、`--tools`、`--no-skills` 等参数的用法
   - 路径：`C:\ProgramData\nvm\v24.15.0\node_modules\@earendil-works\pi-coding-agent\docs\usage.md`

### Phase 4：代码示例（10-15 分钟）

6. **示例扩展代码**（关键几个，其余扫一眼）
   以下示例位于：
   `C:\ProgramData\nvm\v24.15.0\node_modules\@earendil-works\pi-coding-agent\examples\extensions\`

   | 示例文件 | 为什么读 | 读哪些行 |
   |----------|----------|----------|
   | `hello.ts` | 最小扩展模板 | 全文（约 20 行） |
   | `commands.ts` | 如何注册 `/command` | 全文 |
   | `tools.ts` | 如何注册工具 | 全文 |
   | `dynamic-tools.ts` | 动态注册工具 + `promptGuidelines` | 全文 |
   | `provider-payload.ts` | `before_provider_request` 事件用法 | 全文（约 15 行） |
   | `dynamic-resources/index.ts` | `resources_discover` + `skillsOverride` 的用法 | 全文（约 15 行） |
   | `subagent/index.ts` | **最重要**：spawn pi 子进程、解析 JSON 事件流、提取 usage | 重点看 `runSingleAgent` 函数（约 150-250 行） |
   | `send-user-message.ts` | `pi.sendUserMessage()` 的用法 | 全文 |
   | `reload-runtime.ts` | 命令如何触发 `/reload` | 全文 |

   可以跳过的示例：
   - `doom-overlay/`、`snake.ts`、`tic-tac-toe.ts`、`space-invaders.ts`（纯娱乐）
   - `overlay-*.ts`（自定义 UI overlay，本项目不需要）
   - `questionnaire.ts`、`qna.ts`（交互式问答，本项目批处理）
   - `custom-provider-*/`（除非要接入新模型提供商）

---

## 关键信息速查表

### 扩展工厂函数签名

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // 或 async function
}
```

### 注册命令

```typescript
pi.registerCommand("skill-eval", {
  description: "...",
  handler: async (args, ctx) => {
    // args 是字符串，需手动解析
    // ctx 有 waitForIdle, newSession 等
  },
});
```

### 创建隔离测试会话

```typescript
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";

const loader = new DefaultResourceLoader({
  skillsOverride: (current) => ({
    skills: [...current.skills, testSkill],
    diagnostics: current.diagnostics,
  }),
});
await loader.reload();

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  resourceLoader: loader,
  tools: ["read", "bash"],
});
```

### 检测工具调用

```typescript
let triggered = false;
const unsub = session.subscribe((event) => {
  if (event.type === "tool_execution_start" && event.toolName === "read") {
    const path = event.args?.path || event.args?.file_path;
    if (path === targetSkillPath) triggered = true;
  }
});
```

### 获取 usage 数据

```typescript
await session.prompt(query);
const messages = session.agent.state.messages;
const lastAssistant = messages.filter(m => m.role === "assistant").pop();
const usage = lastAssistant?.usage;
// usage.input, usage.output, usage.totalTokens, usage.cost?.total
```

---

## 开发前 Checklist

- [ ] 已读完 `extensions.md` 的 Events 和 ExtensionAPI Methods 章节
- [ ] 已确认 `read` 工具的参数 schema（`path` 还是 `file_path`？）
- [ ] 已看过 `subagent/index.ts` 的 `runSingleAgent` 实现
- [ ] 已确认 `DefaultResourceLoader.skillsOverride` 的返回类型
- [ ] 已确认 `SessionManager.inMemory()` 的用法
- [ ] 已确认 `session.subscribe()` 返回 unsubscribe 函数
- [ ] 已确认 `tool_execution_start` 事件包含 `args` 字段
- [ ] 已确认 `pi -p` 模式下扩展命令会立即执行（不经过 LLM）
- [ ] 已确认 skill-creator 的 Python 脚本路径（`aggregate_benchmark.py`、`generate_review.py`）

---

## 常见问题（开发前预判）

**Q：为什么不直接在扩展的 `pi.on("tool_call", ...)` 里检测触发？**  
A：那会污染用户主会话。正确做法是在命令 handler 内部用 `session.subscribe()` 绑定到隔离的内存 session。

**Q：测试会话需要加载用户的日常扩展吗？**  
A：默认不需要。用 `DefaultResourceLoader` 显式控制，只加载最小工具集（`["read", "bash"]`）。如果需要模拟真实环境，可通过 `additionalExtensionPaths` 显式添加。

**Q：如何验证 `read` 工具参数名？**  
A：直接 spawn `pi --mode json` 跑一次，看 `tool_execution_start` 事件的 `args` 字段。或阅读 `examples/extensions/subagent/index.ts` 中的工具调用解析逻辑。

**Q：描述优化怎么调用 LLM？**  
A：优先尝试用 `@earendil-works/pi-ai` 的底层 API。如果困难，可降级为在主会话中让模型生成建议文本（用户手动采纳）。
