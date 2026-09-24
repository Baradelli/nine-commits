/*
 * One recorded run that stops to ask, and two recorded continuations of it.
 *
 * `TraceCompare` switches between two runs. This switches between two futures
 * of one run, which is a different claim and the one post 9's thesis makes:
 * everything before the gate is a single recording, so the reader is not
 * choosing which of two runs to watch — they are answering the question the
 * run stopped on, and watching what actually happened when it was answered
 * that way.
 *
 * **Nothing here touches `site/src/lib/player-state.ts`, which is frozen.**
 * The state machine holds a position inside one array of a fixed length, and a
 * branch is a different array of a different length, so the thing that changes
 * is which player is mounted: `key` gives the chosen branch its own reducer,
 * `initialState` sizes it, and `start` opens it at the gate through the same
 * `seek` the transport uses. Every move a reader makes still goes through the
 * frozen `reduce`. What this component adds is one boolean — which branch —
 * and the frozen machine was never asked to hold it.
 *
 * The fork point is **computed from the traces, not declared**: it is the
 * first index at which the branches stop agreeing, which for a real fork is
 * the approval frame itself. `tools/hitl/fork.test.ts` asserts the same
 * property against the code that writes the files, so a pair of traces that
 * did not share a prefix would fail the suite before it reached this file.
 */

import { useEffect, useState } from 'preact/hooks'
import { forkAt } from '../lib/branch.ts'
import TracePlayer, { type Trace } from './TracePlayer.tsx'

export type BranchRun = {
  /** What the reader is answering: `Allow` or `Deny`. */
  label: string
  /** Set on the button, so the choice is legible in the DOM and in a test. */
  decision: string
  trace: Trace
}

export default function TraceBranch({
  branches,
  caption,
  question,
}: {
  branches: BranchRun[]
  /**
   * What these recordings are, and are not, printed with the fork.
   *
   * Post 2's rule, inherited from `TraceCompare`: this block travels. A reader
   * screenshots the player or watches it and scrolls straight past, so
   * whatever qualifies it has to sit inside it rather than two screens below.
   */
  caption?: string
  /** What the run is asking, in the operator's words rather than the model's. */
  question: string
}) {
  const [chosen, setChosen] = useState<number | null>(null)
  const [at, setAt] = useState(0)
  /*
   * How many times the reader has asked to be taken to the question.
   *
   * The prefix of the published pair is thirteen frames of real work, and the
   * fork is the point of the block, so a reader who wants to answer without
   * pressing Next thirteen times has to be able to. It is a counter rather
   * than a boolean because it is part of the player's `key`: the frozen state
   * machine has no way to move a position from outside, so moving one means
   * mounting a new player, and mounting a new player at the same `start`
   * needs a key that has changed.
   */
  const [skips, setSkips] = useState(0)

  /*
   * Server-rendered and pre-hydration markup must not claim to be
   * interactive. `TracePlayer` has done this since v1 for the transport; these
   * three buttons needed it too, and the way I found out was a flaky e2e test:
   * a click that lands in the hydration gap does nothing, and the assertion
   * after it fails once in a while and passes on a re-run. Disabled until
   * mounted makes the gap visible instead of intermittent.
   */
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const first = branches[0]
  if (first === undefined) return null

  const gate = forkAt(branches.map((branch) => branch.trace))

  // One meter across the fork. Both branches carry the same run up to the
  // gate, so measuring each against its own peak would redraw the same
  // context at two different sizes the moment a reader picked a side.
  const peak = Math.max(
    ...branches.flatMap((branch) => branch.trace.tokens),
    0,
  )

  const current = chosen === null ? undefined : branches[chosen]

  // Before a choice the timeline is the shared prefix: the frames both
  // recordings agree on, and not one frame more. It is a slice of a published
  // file rather than a third recording.
  const prefix: Trace = {
    ...first.trace,
    id: `${first.trace.id}-prefix`,
    frames: first.trace.frames.slice(0, gate),
    tokens: first.trace.tokens.slice(0, gate),
  }

  const atGate = at >= gate - 1

  const fork = (
    <div class="fork" data-trace-fork>
      <p class="fork__question">
        {chosen === null
          ? question
          : `You answered ${current?.label ?? ''}. This is the run that happened.`}
      </p>
      <div class="fork__choices" role="group" aria-label="Answer the approval">
        {branches.map((branch, index) => (
          <button
            key={branch.decision}
            type="button"
            class="control"
            data-decision={branch.decision}
            aria-pressed={index === chosen}
            disabled={!mounted || (chosen === null && !atGate)}
            onClick={() => setChosen(index)}
          >
            {branch.label}
          </button>
        ))}
        {chosen === null && !atGate && (
          <button
            type="button"
            class="control"
            data-decision="skip"
            disabled={!mounted}
            onClick={() => setSkips((count) => count + 1)}
          >
            Skip to the question
          </button>
        )}
        {chosen !== null && (
          <button
            type="button"
            class="control"
            data-decision="rewind"
            disabled={!mounted}
            onClick={() => {
              setChosen(null)
              setSkips((count) => count + 1)
            }}
          >
            Back to the question
          </button>
        )}
      </div>
    </div>
  )

  return (
    <section class="compare branch" data-trace-branch>
      <div class="spread">
        <p class="marginal">One run, two answers</p>
        {caption !== undefined && (
          <p class="compare__caption" data-compare-caption>
            {caption}
          </p>
        )}
      </div>

      <TracePlayer
        key={current === undefined ? `prefix-${skips}` : current.trace.id}
        trace={current === undefined ? prefix : current.trace}
        start={
          current === undefined ? (skips === 0 ? 0 : gate - 1) : gate
        }
        peak={peak}
        onIndex={setAt}
        note={
          current === undefined
            ? 'It stops at an approval. What happens next is yours to answer.'
            : undefined
        }
        after={fork}
      />
    </section>
  )
}
