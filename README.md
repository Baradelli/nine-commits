# Nine Commits

One AI agent, built in nine commits — with the real execution traces that
produced each post.

Every interactive demo on [the site](https://baradelli.github.io/nine-commits)
replays a run that actually happened on my machine, recorded from the agent in
`agent/` at the commit the post is tagged with.

## Layout

- `agent/` — the agent. Plain TypeScript, no agent framework.
- `site/` — the blog (Astro).
- `tools/` — trace normalization and cover generation.

## Recording a trace

```
npm start --workspace @nine-commits/agent -- "<task>"   # writes agent/traces/<id>.json
npm run record -- agent/traces/<id>.json <post-slug> [trace-b.json]
npm run validate
```

`record` redacts against this machine's home directory, the deny list in
`tools/trace/redact.config.ts`, and every sensitive-looking value in the
environment — including `agent/.env`, which it reads itself. The optional
third argument names the output file, for posts that carry more than one
trace.

`validate` re-scans every committed trace. Set `REDACT_HOME_DIR` to scan for a
home directory other than that of whoever is running it; CI does, because its
own home directory appears in no committed trace.

The run itself is configured by environment:

| Variable | What it does |
| --- | --- |
| `TOOL_DESCRIPTIONS` | `precise` (the default) or `thin` — which set of tool descriptions the model is given. This is the post 2 experiment; both sets are in `agent/src/tools/descriptions.ts`. |
| `TRACE_EXPECT` | Comma-separated facts the final answer must contain for the run to count as having answered the question. Required — the recorder refuses to grade a run nobody said what to expect from. |
| `TRACE_ID` | The trace's id, and the file it is written to. |
| `TRACE_COMMIT` | The tag the trace is recorded against. |

So one side of the post 2 comparison is:

```
TOOL_DESCRIPTIONS=precise TRACE_ID=precise-descriptions \
TRACE_EXPECT="agent/src/config.ts,gpt-5-mini" \
npm start --workspace @nine-commits/agent -- \
  "Which file in this project sets the model name the agent uses, and what is it set to?"
```

The model is not deterministic, so one run per side will not reproduce the
post's conclusion. The post says so, and gives the counts over 21 runs each.

## Grading a trace

```
npm run eval           # one block per committed run
npm run eval -- --tsv  # the same table, for piping
```

`TRACE_EXPECT` grades the final sentence. `npm run eval` grades the frames:
which tools were called, whether each fact the answer states appears in
something a tool actually returned, and whether the ground truth reached the
model alongside a copy of itself — in which case the verdict is `undecidable`
rather than `success`. The questions live in `tools/eval/question.ts` and the
per-trace verdicts in `tools/eval/suite.ts`, which `npm test` gates. This is
post 4.

## Attribution

Built while following **"Build an AI Agent from Scratch"** by
[Scott Moss](https://github.com/Hendrixer) — [course notes](https://publish.obsidian.md/agents-v2/course),
[reference repository](https://github.com/Hendrixer/agents-v2).

The agent implementation here is my own. The curriculum, the lesson structure
and the concepts are the instructor's.
