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

## The web tools, and the cache

v7 adds `web_search` and `fetch_page`, which are the first things the agent
does that leave the machine. The provider is the English Wikipedia through the
MediaWiki action API: documented, public, no key, and its text is CC BY-SA, so
the extracts inside the published traces are quoted from the pages the traces
link to and remain under that licence.

Both tools cache every response to `agent/webcache/`, keyed by the request URL.
The cache is **not** committed — it is somebody else's prose, and `webcache/` is
in `.gitignore` — so a fresh clone starts cold:

```
npm run warm            # fetch everything the experiment needs, once
npm run context         # the 100-run experiment, off vs on
npm run context:tally   # the committed tally, recounted
```

`npm run warm` writes `agent/webcache/MANIFEST.md` saying what was fetched,
when, and how large each page was. Every row of the tally records how many
requests actually left the machine during that run; a second pass makes none.
A cached corpus is a different experiment from a live one, and post 7 says so.

## Measuring the window

```
npm run window -- 300000     # send ~300k tokens of filler and see what happens
```

A request that exceeds the model's input limit is rejected before inference and
is not billed, so bisecting downwards from a rejection is free. Only the
acceptance is billed, at the input rate: $0.25 per million, or 0.025 cents per
thousand tokens, which put the 266,684-token acceptance at about seven cents.
This is where
`MEASURED_MODEL_WINDOW` in `agent/src/context.ts` comes from; it is a
measurement rather than a model-card figure, and the probe prints both numbers
it is bracketed by.

## Judging a summary

```
npm run summary-judge          # 18 cases x 9 repeats over the published run
npm run summary-judge:tally    # the committed judgements, recounted
```

Compaction's deterministic cost — did a number survive the summary — is checked
by code in `tools/context/task.ts`. The half code cannot check is whether the
summary says anything the transcript does not, and that is what this judge is
asked. Half its panel has a known answer built by construction: a summary
assembled from quotations, and the same summary with one number changed. This
is post 5's method pointed at post 7's problem.

## Approvals, and a run you can answer twice

```
AGENT_APPROVAL=ask npm start --workspace @nine-commits/agent -- "<task>"
npm run hitl           # the 150-run experiment: no gate, gate saying yes, gate saying no
npm run hitl:tally     # the committed tally, recounted
npm run fork           # record one run suspended at its gate and continued both ways
```

`AGENT_APPROVAL` is `off` (the default, and what commits 1 to 8 did), `ask`,
`allow` or `deny`. `ask` is the only one with a person in it: the run stops on
the terminal, prints the tool and the arguments the model wrote, and waits.
Anything that is not `y` is a no.

`npm run fork` is how post 9's two published traces were made. The run is
started with nobody available to answer, so the loop returns a conversation
with an unanswered approval in it; that conversation is then handed back twice,
once with a yes and once with a no. Both continuations are real calls, and
every frame before the gate is one recording — `tools/hitl/fork.test.ts`
asserts that against the same code, offline, with a mock model.

## Attribution

Built while following **"Build an AI Agent from Scratch"** by
[Scott Moss](https://github.com/Hendrixer) — [course notes](https://publish.obsidian.md/agents-v2/course),
[reference repository](https://github.com/Hendrixer/agents-v2).

The agent implementation here is my own. The curriculum, the lesson structure
and the concepts are the instructor's.
