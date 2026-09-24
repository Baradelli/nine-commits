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
    // The plan's thesis was "thirty lines that turn a text completion into an
    // agent". Built, the honest count is three lines deleted and a cap raised:
    // history and tool results were already the SDK's job at v2. The index is
    // a claim the commits have to earn, so the claim changed rather than the
    // count. Post 3 shows the diff.
    thesis:
      'History, tool results, and a stop condition. The first two came with the SDK. The loop was three lines deleted and a cap raised from two to ten.',
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
    // The plan's thesis was "four filesystem primitives are enough to do real
    // work, and adding a fifth makes the agent worse". The first half held:
    // fifty runs with four tools finished fifty tasks. The second half did not
    // survive a hundred runs with five — same completion, no misuse of the
    // extra tool, and on the one task the fifth existed for it was chosen ten
    // times out of ten. What the fifth did cost was its own definition, in
    // the first request. The index is a claim the commits have to earn, so the
    // claim changed rather than the tasks — and it carries the ceiling with it,
    // because all three conditions scored 100% and a null result stated without
    // its detection floor is a stronger claim than the runs support. Post 6
    // shows the tally.
    thesis:
      'List, read, write, edit. Four filesystem primitives finished all five tasks, fifty runs out of fifty. So did a fifth — it cost eighty-eight tokens in the first request and changed nothing else I could measure at fifty runs.',
  },
  {
    order: 7,
    tag: 'v7-context',
    title: 'Context Is the Real Constraint',
    // The plan's thesis was "one web search can fill the window; compaction is
    // not an optimisation, it is what keeps the loop alive". The first half is
    // false by a factor of about fifty: one search and one page read is 5,644
    // tokens against a window measured at 266,684. The second half held, but
    // only against accumulation, and that condition is load-bearing enough to
    // be on this line rather than four hundred lines into the post: fifty runs
    // with the history left alone finished nothing at all, and seventeen of the
    // fifty runs with compaction on still ended on an overflow — every one of
    // those seventeen a run that had asked for three tool calls in a single
    // turn (`runs.tsv`, `stopped_by` against `max_parallel`), while the
    // eighteen runs that never asked for more than one lost none. What
    // compaction buys also turned out not to be the thing worth naming: the
    // compacted runs kept 139 of the 143 answers the rewrite threw away, and
    // paid for it by fetching 5.54 pages a run against the control's 3.00. The
    // index is a claim the commits have to earn, so the claim changed rather
    // than the experiment. Post 7 shows the tally.
    thesis:
      'One web search fills two per cent of the window, not the window. Compaction keeps the loop alive against accumulation — fifty runs without it finished nothing, seventeen with it still died on one oversized turn — and what it costs is not the facts, it is that the agent goes back and fetches them again.',
  },
  {
    order: 8,
    tag: 'v8-shell',
    title: "Shell Access, and Why That's Terrifying",
    // The plan's thesis was "giving the agent a shell gives it everything you
    // can do, including the parts you would not do". The first half is true and
    // is demonstrated rather than asserted: an unguarded `execSync` in a
    // container with no mounts and no network deleted the container's own
    // filesystem and went on printing from a machine whose `ls` no longer
    // existed. The second half did not survive being built. "The parts you
    // would not do" is a claim about a shell, and the shell I could actually
    // defend is not one: the allow-list that survived ninety-seven attacks
    // holds no interpreter, no redirection and no metacharacter, so nothing in
    // it can author a byte of its own — every idiom that composes content is
    // either a shell feature or an interpreter. That is narrower than
    // read-only, deliberately: five of the fifteen mutate the filesystem —
    // `cp`, `mv`, `touch`, `mkdir` and `uniq`, whose second operand is an
    // output file — and `cp a b` replaces every byte of `b`. Two rounds of
    // corrections named four of the five, which is why the set is measured in
    // `tools/shell/writers.test.ts` and not listed from memory anywhere that
    // ships. What the model did with it is the finding. It wrote shell,
    // not commands: forty-seven of seventy-nine command lines refused, `find
    // -exec` six times out of six finds, `|| true` fifteen times and `&&`
    // never, and not once a program outside the list — the part of the guard
    // everybody writes first never fired at all. The result is post 6's
    // original thesis coming true one tool later, except on `largest-file`,
    // where the four have no primitive for a byte count, count the characters
    // in their heads for six thousand output tokens a run, and get it wrong
    // three times in ten. The index is a claim the commits have to earn, so
    // the claim changed. Post 8 shows the tally, the attack table and the
    // container.
    thesis:
      "A shell is everything you can do: in a container, one call deleted the machine it was running on. The one I would let near this machine cannot author a byte of its own, refused forty-seven of the seventy-nine commands the model wrote, and finished sixty of seventy tasks against the four filesystem primitives' sixty-five — a gap these runs cannot distinguish. What they can distinguish is the step cap, which it hit eleven times against zero. The one thing it finished more often is the byte count the four have no primitive for.",
  },
  {
    order: 9,
    tag: 'v9-hitl',
    title: 'The Human in the Loop',
    thesis:
      'An approval prompt is a branch in the trace. Both branches were recorded; you pick which one runs.',
  },
]
