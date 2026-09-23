/*
 * Two recordings of the same question, and a switch between them.
 *
 * Spec §4.3 calls this a thin wrapper over the player, and it is meant
 * literally: nothing here knows what a frame is, nothing here restyles the
 * transcript, and the player is mounted unchanged. All this component adds is
 * the one control the compare posts need — which run am I watching — set as a
 * pair of drafting-style toggles in the margin above the trace.
 *
 * Each run gets its own player instance, keyed by trace id, so switching
 * starts the new recording at its first frame instead of inheriting a
 * position from a run of a different length.
 */

import { useState } from 'preact/hooks'
import TracePlayer, { type Trace } from './TracePlayer.tsx'

export type ComparedRun = {
  /** What the reader is switching between: the variable, not the trace id. */
  label: string
  trace: Trace
}

export default function TraceCompare({ traces }: { traces: ComparedRun[] }) {
  const [selected, setSelected] = useState(0)
  const current = traces[selected] ?? traces[0]
  if (current === undefined) return null

  return (
    <section class="compare" data-trace-compare>
      <div class="spread">
        <p class="marginal">Two runs</p>
        <div
          class="compare__switch"
          role="group"
          aria-label="Which recorded run to watch"
        >
          {traces.map((run, index) => (
            <button
              key={run.trace.id}
              type="button"
              class="control"
              data-run={run.trace.id}
              aria-pressed={index === selected}
              onClick={() => setSelected(index)}
            >
              {run.label}
            </button>
          ))}
        </div>
      </div>

      <TracePlayer key={current.trace.id} trace={current.trace} />
    </section>
  )
}
