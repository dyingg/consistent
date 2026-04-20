# Coach agent evals

Scorers, datasets, and a standalone runner for evaluating the `consistent-coach` agent.

## What's here

```
evals/
├── scorers/               # custom code scorers (no LLM judge)
│   ├── fibonacci-points.ts    # every created task has sprintPoints ∈ {1,2,3,5,8,13}
│   ├── context-filled.ts      # every created task has a non-empty `context`
│   └── bulk-preferred.ts      # >=2 same-goal task creations → bulk-create-tasks
├── datasets/              # seed prompts
│   └── planning.ts            # task-breakdown cases
├── eval-agent.ts          # builds an Agent with the same prompt/tools but no Memory
├── run.ts                 # standalone runner (exits 1 on threshold failure)
└── README.md
```

## Running

```bash
# From repo root (loads ../../.env automatically)
pnpm --filter @consistent/core evals
```

Env vars consumed:

| Var                 | Default                         | Notes                                              |
| ------------------- | ------------------------------- | -------------------------------------------------- |
| `AI_MODEL`          | `anthropic/claude-haiku-4-5`    | Model router string (`provider/model`)             |
| `ANTHROPIC_API_KEY` | —                               | Whichever provider key matches `AI_MODEL`          |

The runner **calls the real LLM** (mocked DB, real model). Cost is ~N × one
short agent conversation per run, so keep datasets small and cache-friendly.

## How it works

1. `run.ts` stubs every service method the tools touch (plain async fns that
   return synthetic data).
2. `createEvalAgent` builds a fresh `Agent` with the production prompt, model,
   and tools — but no Memory — and binds those stubs.
3. `runEvals` feeds each prompt in `planningCases` to the agent, collects the
   messages, and invokes every scorer's pipeline.
4. Each scorer inspects the tool calls the agent actually emitted (via
   `extractToolResults`) and emits a score in `[0, 1]`.
5. Thresholds in `run.ts` gate the exit code — CI can run this and fail the
   job on regression.

## Adding a case

Append to `datasets/planning.ts` (or add a new file under `datasets/` and
include it in `run.ts`'s `data` array). Each case is just a user prompt.

## Adding a scorer

Add `scorers/<name>.ts` using `createScorer({ type: 'agent' })` with either
`extractToolResults` (for tool-call checks) or
`getAssistantMessageFromRunOutput` (for response-text checks). Export it from
`scorers/index.ts` and include it in `run.ts`'s `scorers: []` array plus an
entry in the `THRESHOLDS` map.

## What this doesn't cover yet

- **Real-DB state scorers** — stubs mean we check tool choice and arg shape,
  not real side-effects. Follow-up: build an integration-test variant that
  boots Nest + real DB for a handful of hero cases.
- **LLM-judge scorers** — no `prompt-alignment`, `answer-relevancy`, etc. yet.
  Plug in via `@mastra/evals/scorers/prebuilt` when you need semantic grading.
- **Studio / trace scoring** — scorers aren't registered on the production
  `Mastra` instance. Add a `scorers: { ... }` to `mastra.ts` to enable live
  scoring and historical trace scoring in Studio.
- **CI gating** — the runner isn't wired into GitHub Actions. Once thresholds
  are stable, add a workflow step that runs `pnpm --filter @consistent/core evals`
  on PRs that touch `apps/core/src/ai/`.
