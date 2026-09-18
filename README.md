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

## Attribution

Built while following **"Build an AI Agent from Scratch"** by
[Scott Moss](https://github.com/Hendrixer) — [course notes](https://publish.obsidian.md/agents-v2/course),
[reference repository](https://github.com/Hendrixer/agents-v2).

The agent implementation here is my own. The curriculum, the lesson structure
and the concepts are the instructor's.
