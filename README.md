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

## Attribution

Built while following **"Build an AI Agent from Scratch"** by
[Scott Moss](https://github.com/Hendrixer) — [course notes](https://publish.obsidian.md/agents-v2/course),
[reference repository](https://github.com/Hendrixer/agents-v2).

The agent implementation here is my own. The curriculum, the lesson structure
and the concepts are the instructor's.
