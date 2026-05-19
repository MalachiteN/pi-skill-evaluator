# pi-skill-evaluator

Automated skill description trigger-rate evaluation for the pi coding agent.

## Features

- **Trigger Detection**: Uses isolated in-memory agent sessions to test whether a skill's description causes the agent to `read` the skill file.
- **Batch Evaluation**: Runs each eval query multiple times (default 3) to compute a stable trigger rate.
- **Benchmark Aggregation**: Compatible with `skill-creator`'s Python scripts (`aggregate_benchmark.py`, `generate_review.py`).
- **Description Optimization**: Iteratively improves the skill description using an LLM, based on eval failures.
- **Baseline Comparison**: Compare against an older version of the skill.
- **Static Reports**: Generates standalone HTML reports.

## Installation

Add to your pi settings (`~/.pi/agent/settings.json`):

```json
{
  "packages": [
    "git:https://github.com/MalachiteN/pi-skill-evaluator.git"
  ]
}
```

Then run `/reload` in pi (or restart).

## Dependencies

- [skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) skill (for `aggregate_benchmark.py` and `generate_review.py`)
- Python 3 (for the above scripts)

## Usage

### Basic Evaluation

```bash
/skill-eval ./my-skill --eval-set ./evals.json
```

### With Options

```bash
/skill-eval ./my-skill \
  --eval-set ./evals.json \
  --runs 5 \
  --threshold 0.6 \
  --output ./results \
  --report ./report.html
```

### Non-interactive (CI) Mode

```bash
pi -p "/skill-eval ./my-skill --eval-set ./evals.json --report report.html"
```

### Optimize Description

```bash
/skill-eval ./my-skill \
  --eval-set ./evals.json \
  --optimize \
  --max-iter 5 \
  --report report.html
```

### Compare with Baseline

```bash
/skill-eval ./my-skill \
  --eval-set ./evals.json \
  --baseline ./my-skill-old \
  --report report.html
```

### Fast vs Full Mode

By default, eval runs in **fast mode**: as soon as the agent reads the target `SKILL.md`, the session is immediately disposed. This is 3–5× faster and sufficient for trigger-detection and description optimization.

Use **full mode** when you need complete transcripts, token usage, and output files in the HTML report:

```bash
/skill-eval ./my-skill \
  --eval-set ./evals.json \
  --full \
  --report report.html
```

## Eval Set Format

`evals.json` is an array of objects:

```json
[
  { "query": "How do I deploy to production?", "shouldTrigger": true },
  { "query": "What is 2+2?", "shouldTrigger": false }
]
```

## Command Options

| Option | Default | Description |
|--------|---------|-------------|
| `skill-path` | — | Path to the skill directory (must contain `SKILL.md`) |
| `--eval-set` | `./evals.json` | Path to eval set JSON |
| `--runs` | `3` | Runs per query |
| `--threshold` | `0.5` | Trigger rate threshold (0-1) |
| `--model` | Current pi model | Model for test sessions (provider/id) |
| `--output` | `./skill-eval-results` | Output directory |
| `--optimize` | `false` | Enable description optimization loop |
| `--max-iter` | `5` | Max optimization iterations |
| `--report` | — | Generate static HTML report |
| `--baseline` | — | Baseline skill path for comparison |
| `--parallel` | `false` | Run evals in parallel |
| `--fast` | `true` | Trigger-detect only; abort on first read (default) |
| `--full` | `false` | Wait for full agent response; needed for reports |

## Output Structure

```
<output-dir>/
└── iteration-1/
    ├── eval-0/
    │   ├── eval_metadata.json
    │   ├── with_skill/
    │   │   └── run-0/
    │   │       ├── grading.json
    │   │       ├── timing.json
    │   │       └── outputs/
    │   │           └── transcript.md
    │   └── old_skill/          # if --baseline
    │       └── run-0/
    │           └── ...
    ├── benchmark.json
    ├── benchmark.md
    └── report.html             # if --report
```

## Architecture

- **`EvalRunner`** (`lib/eval-runner.ts`): Runs a single query in an isolated `createAgentSession` with `SessionManager.inMemory()`.
- **`BatchRunner`** (`lib/batch-runner.ts`): Aggregates multiple runs into a trigger rate.
- **`EvalSetRunner`** (`lib/eval-set-runner.ts`): Runs all evals, writes artifacts compatible with `skill-creator` Python scripts.
- **`DescriptionOptimizer`** (`lib/description-optimizer.ts`): Uses a dedicated agent session to generate improved descriptions.
- **`BenchmarkAggregator`** / **`ReportGenerator`**: Thin wrappers around `skill-creator`'s Python scripts.

## License

MIT
