# pi-skill-evaluator — 规格文档

> 版本：0.1.0-draft  
> 目标平台：pi coding agent（`@earendil-works/pi-coding-agent`）  
> 约束：**严格不动 pi 本体代码**，全部能力通过 pi Extension API + SDK 实现。

---

## 1. 项目概述

pi-skill-evaluator 是一个 pi 扩展，用于自动化评估和优化 skill 的 description 触发准确率。它复刻了 Claude Code 生态中 `skill-creator` 的核心能力（`run_eval.py` / `improve_description.py` / `run_loop.py` / `aggregate_benchmark.py` / `generate_review.py`），但完全基于 pi 的标准扩展机制实现。

### 1.1 解决的问题

- Skill 的 `description` 字段决定 agent 是否会在适当时机 `read` 该 skill 文件
- 描述写得太保守 → skill 不会被加载（漏触发）
- 描述写得太宽泛 → skill 被错误加载（误触发）
- 手动测试耗时、不系统、不可复现
- 没有自动化反馈循环来迭代改进描述

### 1.2 非目标

- 不评估 skill **内容质量**（只评估 description 触发率）
- 不修改 skill 文件内容（只建议新的 description）
- 不提供 Web UI 服务器（只生成静态 HTML 报告文件）
- 不替代 `skill-creator` 的全部功能（仅聚焦 description 优化）

---

## 2. 核心概念

### 2.1 Skill 触发机制（pi 平台）

pi 的 system prompt 会自动注入**所有已发现 skill 的元数据**（name + description + filePath）。Agent 根据用户查询自主决定是否调用 `read` 工具加载某个 skill 文件。

因此，检测 skill 是否被"触发" = 检测 agent 在当前会话中是否对目标 skill 的 `SKILL.md` 路径发起了 `read` 工具调用。

### 2.2 Eval Set

一组测试查询，每条包含：
- `query`: 用户输入文本
- `should_trigger`: `true`（期望触发）或 `false`（期望不触发）

### 2.3 Trigger Rate

对单条查询运行 N 次（默认 3 次），统计触发次数 / 总次数 = trigger rate。  
Pass 条件：
- `should_trigger === true` 且 trigger rate ≥ threshold（默认 0.5）
- `should_trigger === false` 且 trigger rate < threshold

### 2.4 Benchmark

聚合所有 eval 的运行结果，产出：
- 每条 eval 的 pass/fail 状态
- 平均耗时、token 消耗
- 与 baseline（无 skill / 旧版本 skill）的 delta 对比

---

## 3. 架构设计

### 3.1 高层架构

```
┌─────────────────────────────────────────┐
│  用户日常 pi 会话（主进程）              │
│  ├─ 加载 pi-skill-evaluator 扩展        │
│  └─ /skill-eval 命令可用                 │
└─────────────────────────────────────────┘
                    │
                    ▼  pi -p "/skill-eval ..."
┌─────────────────────────────────────────┐
│  /skill-eval 命令 handler（批处理模式）  │
│  ├─ 解析参数                             │
│  ├─ 加载 eval set JSON                   │
│  └─ 循环：对每条 eval 调用 EvalRunner    │
└─────────────────────────────────────────┘
                    │
                    ▼  SDK createAgentSession()
┌─────────────────────────────────────────┐
│  隔离的内存测试会话（in-memory session）  │
│  ├─ SessionManager.inMemory()           │
│  ├─ DefaultResourceLoader.skillsOverride│
│  │   └─ 注入被测 skill                   │
│  ├─ 最小工具集：["read", "bash"]        │
│  └─ session.subscribe() 监听 tool_call  │
│       └─ 检测 read 是否指向目标 skill   │
└─────────────────────────────────────────┘
                    │
                    ▼  结果聚合
┌─────────────────────────────────────────┐
│  BenchmarkAggregator                    │
│  └─ benchmark.json / benchmark.md       │
│  ReviewReportGenerator                  │
│  └─ report.html（静态，--static 等价）  │
└─────────────────────────────────────────┘
```

### 3.2 关键设计原则

1. **零污染主会话**：触发检测逻辑不是扩展全局事件监听，而是 `session.subscribe()` 绑定到隔离的内存 session 实例。
2. **命令即入口**：所有功能通过 `/skill-eval` 命令暴露，支持 `pi -p` 非交互式调用。
3. **全自动批处理**：`pi -p` 模式下 `ctx.hasUI === false`，handler 不能调用任何交互式 UI 方法。
4. **Python 脚本复用**：`aggregate_benchmark.py` 和 `generate_review.py` 是 pi-agnostic 的，直接复用 skill-creator 的版本。

---

## 4. 组件规格

### 4.1 EvalRunner

负责执行单次 eval（一条查询的一次运行）。

```typescript
interface EvalRunner {
  run(args: {
    skillPath: string;
    skillName: string;
    description: string;
    query: string;
    model?: string;
    tools?: string[];
  }): Promise<EvalResult>;
}

interface EvalResult {
  query: string;
  triggered: boolean;
  triggerConfidence: number; // 预留：未来多工具检测时的置信度
  timeMs: number;
  tokens: {
    input: number;
    output: number;
    total: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  cost?: number;
  messagesSnapshot: AgentMessage[]; // 完整消息历史，用于调试
}
```

**实现要点**：
- 使用 `createAgentSession({ sessionManager: SessionManager.inMemory() })`
- `DefaultResourceLoader.skillsOverride` 注入被测 skill
- `session.subscribe()` 监听 `tool_execution_start` 事件
- 检测到 `toolName === "read"` 且 path 匹配目标 skill 路径时，标记 `triggered = true`
- 调用 `session.prompt(query)` 后等待完成
- 从最后的 assistant message 提取 `usage`
- `session.dispose()` 清理

### 4.2 BatchRunner

对单条 eval 运行多次（默认 3 次），计算 trigger rate。

```typescript
interface BatchRunner {
  run(args: {
    skillPath: string;
    skillName: string;
    description: string;
    query: string;
    runsPerQuery: number; // default 3
    triggerThreshold: number; // default 0.5
  }): Promise<BatchResult>;
}

interface BatchResult {
  query: string;
  shouldTrigger: boolean;
  triggerRate: number;
  triggers: number;
  runs: number;
  pass: boolean;
  results: EvalResult[];
}
```

### 4.3 EvalSetRunner

对 eval set 中的所有查询执行 batch run，产出完整结果集。

```typescript
interface EvalSetRunner {
  run(args: {
    skillPath: string;
    evalSet: EvalItem[];
    runsPerQuery?: number;
    triggerThreshold?: number;
    model?: string;
    parallel?: boolean; // 是否并发运行（默认 false，避免 rate limit）
  }): Promise<EvalSetResult>;
}
```

### 4.4 DescriptionOptimizer

接收 eval 结果，调用底层 LLM API 生成改进后的 description。

```typescript
interface DescriptionOptimizer {
  improve(args: {
    skillName: string;
    skillContent: string; // SKILL.md body（不含 frontmatter）
    currentDescription: string;
    evalResults: BatchResult[];
    history: OptimizationAttempt[]; // 之前失败的尝试，防止重复
    model?: string;
  }): Promise<string>; // 新的 description
}
```

**实现约束**：
- 不能直接调用 `pi -p`（那会 spawn 新进程，效率低且上下文丢失）
- 应使用 `@earendil-works/pi-ai` 的底层 API 直接调用 LLM
- 或更简单地：在主会话中让模型自己生成（因为优化过程本身就是一次性的、可交互的）

### 4.5 BenchmarkAggregator

聚合所有 batch results，生成统计报告。

**决策**：直接复用 skill-creator 的 `scripts/aggregate_benchmark.py`（Python，纯标准库，pi-agnostic）。扩展通过 `bash` 工具调用它。

```bash
python path/to/aggregate_benchmark.py <workspace-dir> \
  --skill-name <name> \
  --output benchmark.json
```

### 4.6 ReviewReportGenerator

生成可阅读的 HTML 报告。

**决策**：直接复用 skill-creator 的 `eval-viewer/generate_review.py`，使用 `--static` 模式生成独立 HTML 文件。

```bash
python path/to/generate_review.py <workspace-dir> \
  --skill-name <name> \
  --benchmark benchmark.json \
  --static report.html
```

---

## 5. 命令接口

### 5.1 `/skill-eval` 命令

**语法**：
```
/skill-eval <skill-path> [options]
```

**参数**（args 字符串解析）：
| 参数 | 说明 | 默认值 |
|------|------|--------|
| `skill-path` | 被测 skill 的目录路径（positional） | 必填 |
| `--eval-set` | Eval set JSON 文件路径 | `./evals.json` |
| `--runs` | 每条查询运行次数 | `3` |
| `--threshold` | 触发率阈值（0-1） | `0.5` |
| `--model` | 指定测试模型 | 当前 pi 默认模型 |
| `--output` | 结果输出目录 | `./skill-eval-results/` |
| `--optimize` | 启用描述优化循环 | `false` |
| `--max-iter` | 优化最大迭代次数 | `5` |
| `--report` | 生成静态 HTML 报告的路径 | 不生成 |
| `--baseline` | 与旧版本 skill 对比（路径） | 无 |

**行为**：
1. 检查 `skill-path/SKILL.md` 存在
2. 解析 eval set JSON
3. 循环运行所有 eval（batch run）
4. 保存原始结果到 `<output>/iteration-N/eval-M/with_skill/`
5. 如有 baseline，运行对照实验到 `without_skill/` 或 `old_skill/`
6. 调用 `aggregate_benchmark.py` 生成 `benchmark.json`
7. 如有 `--report`，调用 `generate_review.py --static` 生成 HTML
8. 如有 `--optimize`，进入改进循环
9. 输出 summary 到 stdout

### 5.2 `eval_skill` 工具（可选）

让主 agent 可以在对话中直接调用单次评估。

```typescript
pi.registerTool({
  name: "eval_skill",
  parameters: Type.Object({
    skillPath: Type.String(),
    query: Type.String(),
    shouldTrigger: Type.Boolean(),
  }),
  // 内部调用 EvalRunner.run()，返回结果文本
});
```

---

## 6. 工作区目录结构

```
<output-dir>/
└── iteration-1/
    ├── eval-search-query-1/
    │   ├── with_skill/
    │   │   ├── outputs/
    │   │   │   └── transcript.md
    │   │   ├── grading.json
    │   │   └── timing.json
    │   └── without_skill/
    │       └── ...
    ├── eval-search-query-2/
    │   └── ...
    ├── benchmark.json
    └── report.html

└── iteration-2/
    └── ...
```

与 skill-creator 的 workspace 布局兼容，以便直接复用 Python 脚本。

---

## 7. 与 Claude Code skill-creator 的差异映射

| Claude Code | pi-skill-evaluator | 差异说明 |
|-------------|-------------------|----------|
| `claude -p` | `pi -p "/skill-eval ..."` | pi 的命令机制天然支持 |
| `.claude/commands/` 动态注册 | `DefaultResourceLoader.skillsOverride` + `SessionManager.inMemory()` | 更干净，无文件系统 hack |
| `stream-json` 管道解析 `content_block_start` | `session.subscribe()` 监听 `tool_execution_start` | 事件驱动，代码更简洁 |
| `claude -p` 子进程嵌套 LLM | 扩展内直接调用 `@earendil-works/pi-ai` 底层 API | 无子进程开销 |
| `ProcessPoolExecutor` 并行 | `Promise.all()` 或串行 | Node.js 原生异步 |
| `aggregate_benchmark.py` | **直接复用** | pi-agnostic |
| `generate_review.py --static` | **直接复用** | pi-agnostic |

---

## 8. 已知约束与假设

### 8.1 平台约束

- **只读 pi 文档和示例，不修改 pi 本体**
- 扩展通过标准 `ExtensionAPI` 注册命令和工具
- 测试会话通过 SDK `createAgentSession()` 创建，不依赖 CLI spawn
- `pi -p` 模式下 `ctx.hasUI === false`，所有 handler 必须是全自动批处理

### 8.2 技术假设

- `read` 工具的参数名为 `path`（需验证：pi 的 read 工具 schema）
- `tool_execution_start` 事件在 agent 调用工具时必定触发
- 被测 skill 的 `filePath` 在 `DefaultResourceLoader.skillsOverride` 中可被 agent 正确访问
- `session.subscribe()` 的回调在 `session.prompt()` 返回前能完整接收所有事件
- 底层 LLM API（`@earendil-works/pi-ai`）支持独立调用（不依赖 pi 会话循环）

### 8.3 环境依赖

- Node.js（与 pi 相同版本）
- Python 3（用于复用的 `aggregate_benchmark.py` 和 `generate_review.py`）
- `skill-creator` 技能已安装（用于获取 Python 脚本路径，或可内嵌）

---

## 9. 测试策略

### 9.1 单元测试（扩展内部）

- EvalRunner：用 mock session 验证 `triggered` 逻辑
- Args parser：验证 `/skill-eval` 参数解析
- Skill parser：验证 `SKILL.md` YAML frontmatter 解析

### 9.2 集成测试

- 用一个已知行为的简单 skill（如 "greet" skill）测试完整流程
- 验证 `--optimize` 循环能收敛到更高 trigger rate
- 验证 `pi -p` 模式输出格式正确

### 9.3 与 skill-creator 的对标测试

- 同一组 eval set，分别用 Claude Code 的 `run_eval.py` 和 pi-skill-evaluator 运行
- 对比触发率统计结果的一致性
- 对比 benchmark 报告的可读性

---

## 10. 交付物

| 文件 | 说明 |
|------|------|
| `index.ts` | 扩展入口（命令 + 工具注册） |
| `lib/eval-runner.ts` | 单次评估核心 |
| `lib/batch-runner.ts` | 多次运行聚合 |
| `lib/eval-set-runner.ts` | 批量评估 |
| `lib/skill-parser.ts` | SKILL.md 解析 |
| `lib/args-parser.ts` | 命令参数解析 |
| `lib/description-optimizer.ts` | 描述优化（LLM API 调用） |
| `lib/benchmark-aggregator.ts` | 调用 Python 脚本封装 |
| `lib/report-generator.ts` | 调用 Python 脚本封装 |
| `types.ts` | TypeScript 类型定义 |
| `package.json` | 依赖声明（`@earendil-works/pi-coding-agent`, `typebox` 等） |
| `README.md` | 安装和使用说明 |
| `SPEC.md` | 本文档 |
| `DEV_GUIDE.md` | 开发前阅读引导 |

---

## 11. 风险与未决事项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| pi 的 `read` 工具参数名不确定（`path` vs `file_path`） | 触发检测失效 | 开发时实际验证，支持两者 fallback |
| `session.subscribe()` 事件顺序不确定 | 漏检触发 | 同时监听 `tool_execution_start` 和 `tool_call`，取并集 |
| 底层 LLM API 独立调用困难 | 描述优化无法自动循环 | 降级为输出建议，让用户手动采纳 |
| 并行运行触发 rate limit | 测试耗时剧增 | 默认串行，提供 `--parallel` 开关 |
| pi-chrome 等扩展改变 agent 行为 | 触发率不一致 | 测试时显式控制 `additionalExtensionPaths` |
