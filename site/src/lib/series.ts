/**
 * The nine commits, as planned in the design spec (§3.2).
 *
 * The index is a table of contents for a series in progress, not a list of
 * whatever happens to be published. A post that has not been written yet is
 * still part of the argument — it names the claim that commit has to earn —
 * so the shape of the series lives here and the content collection is joined
 * onto it by `order`.
 */
export type PlannedPost = {
  order: number
  /** The git tag the post is bound to. */
  tag: string
  title: string
  thesis: string
}

export const SERIES_LENGTH = 9

export const PLANNED: readonly PlannedPost[] = [
  {
    order: 1,
    tag: 'v1-not-an-agent',
    title: 'An LLM Is Not an Agent',
    thesis:
      'An agent is a model, a set of actions, and a loop. Take the loop away and what is left is a chatbot.',
  },
  {
    order: 2,
    tag: 'v2-hands',
    title: 'Giving It Hands',
    thesis:
      "A tool's description is a prompt. Write it badly and the model reaches for the wrong tool.",
  },
  {
    order: 3,
    tag: 'v3-the-loop',
    title: 'The Loop',
    thesis:
      'History, tool results, and a stop condition. Thirty lines that turn a text completion into an agent.',
  },
  {
    order: 4,
    tag: 'v4-does-it-work',
    title: 'But Does It Work?',
    thesis:
      'Single-turn evals test the decision the model made, not the prose it wrapped around it.',
  },
  {
    order: 5,
    tag: 'v5-moving-target',
    title: 'Judging a Moving Target',
    thesis:
      'When the output is different every run, the grader has to be a model too — and then the grader needs grading.',
  },
  {
    order: 6,
    tag: 'v6-four-operations',
    title: 'Four Operations',
    thesis:
      'List, read, write, edit. Four filesystem primitives are enough to do real work, and adding a fifth makes the agent worse.',
  },
  {
    order: 7,
    tag: 'v7-context',
    title: 'Context Is the Real Constraint',
    thesis:
      'One web search can fill the window. Compaction is not an optimisation, it is what keeps the loop alive.',
  },
  {
    order: 8,
    tag: 'v8-shell',
    title: "Shell Access, and Why That's Terrifying",
    thesis:
      'Giving the agent a shell gives it everything you can do, including the parts you would not do.',
  },
  {
    order: 9,
    tag: 'v9-hitl',
    title: 'The Human in the Loop',
    thesis:
      'An approval prompt is a branch in the trace. Both branches were recorded; you pick which one runs.',
  },
]
