import { useEffect, useReducer, useState } from 'preact/hooks'
import {
  initialState,
  isAtEnd,
  reduce,
  visibleFrames,
} from '../lib/player-state.ts'
import { FrameView, type AnyFrame } from './Frame.tsx'

// Exported so `TraceCompare` can hold an array of these without restating the
// shape. The player is still the only thing that renders one.
export type Trace = {
  id: string
  commit: string
  model: string
  task: string
  outcome: 'success' | 'failure' | 'partial'
  tokens: number[]
  frames: AnyFrame[]
}

const STEP_MS = 1400

const ENDING: Record<Trace['outcome'], string> = {
  success: 'The run finished the task.',
  failure: 'The run did not finish the task.',
  partial: 'The run finished part of the task.',
}

const n = (value: number): string => value.toLocaleString('en-GB')

export default function TracePlayer({ trace }: { trace: Trace }) {
  // Generics are inferred from `reduce`; naming them explicitly breaks across
  // Preact hook typings.
  const [state, dispatch] = useReducer(reduce, initialState(trace.frames.length))

  // Server-rendered and pre-hydration markup must not claim to be
  // interactive: the controls render disabled until this flips, on mount,
  // so a click in the hydration gap is visibly inert rather than a silent
  // no-op. `useState(false)` matches on both the server render and the
  // first client render (avoiding a hydration mismatch); the effect below
  // only runs once the island has actually hydrated and attached its
  // handlers.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!state.playing) return
    const timer = setTimeout(() => dispatch({ type: 'next' }), STEP_MS)
    return () => clearTimeout(timer)
  }, [state.playing, state.index])

  const shown = visibleFrames(trace.frames, state)
  const atEnd = isAtEnd(state)

  // The margin measure is the size of the context the agent is carrying,
  // taken against the run's own peak. It is deliberately not monotonic: a
  // compaction frame makes it retreat, which is the whole point of post 7.
  const peak = trace.tokens.length > 0 ? Math.max(...trace.tokens) : 0
  const carried = trace.tokens[state.index] ?? 0
  const fill = peak > 0 ? Math.round((carried / peak) * 100) : 0

  return (
    <section
      class="player"
      aria-label={`Recorded run: ${trace.task}`}
      data-trace-player
    >
      <div class="rail" aria-hidden="true">
        <span class="rail__fill" style={`--fill: ${fill}%`}></span>
      </div>

      <div class="spread">
        <p class="marginal">Recorded run</p>

        <header>
          <h2 class="trace__task">{trace.task}</h2>
          <p class="trace__note">
            {`Recorded from ${trace.model} at commit ${trace.commit}. ${ENDING[trace.outcome]}`}
          </p>
        </header>

        {/*
          Playback sits ABOVE the transcript, not below it. The transcript is
          the only thing on this page that grows while you use it: every Next
          appends a frame, and a payload frame is capped at 22rem of scroll
          box, so controls placed after it walk down the page by up to a third
          of a screen per click. At six frames that is a nuisance; at the
          length post 7 will record it puts the transport off the bottom of
          the viewport and keeps it there.

          A sticky bar is the reflex fix and the wrong one here: it needs its
          own fill to stop the trace running underneath it, and this design
          spends its one structural device on the margin measure and has no
          floating chrome anywhere (see `styles/tokens.css`). Putting the
          transport at the head of the block costs nothing and fixes the same
          thing — the controls stop moving at all, and the landmark a reader
          scrolls back to is the top of the trace rather than its ever-moving
          end.

          It also fixes the tab order: playback now comes before the frames
          instead of behind all of them.
        */}
        <div class="player__controls" role="group" aria-label="Playback">
          <button
            type="button"
            class="control"
            data-action="prev"
            onClick={() => dispatch({ type: 'prev' })}
            disabled={!mounted || state.index === 0}
          >
            Back
          </button>
          <button
            type="button"
            class="control"
            data-action="next"
            onClick={() => dispatch({ type: 'next' })}
            disabled={!mounted || atEnd}
          >
            Next
          </button>
          <button
            type="button"
            class="control"
            data-action="play"
            onClick={() => dispatch({ type: state.playing ? 'pause' : 'play' })}
            disabled={!mounted || atEnd}
          >
            {state.playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            class="control"
            data-action="reset"
            onClick={() => dispatch({ type: 'reset' })}
            disabled={!mounted || (state.index === 0 && !state.playing)}
          >
            Start over
          </button>

          <p class="player__count" aria-live="polite">
            Frame {state.index + 1} of {trace.frames.length}
          </p>

          {peak > 0 && (
            <p class="player__budget">
              {`${n(carried)} tokens in context, against this run's peak of ${n(peak)}.`}
            </p>
          )}
        </div>

        <ol class="transcript full">
          {shown.map((frame, i) => (
            <FrameView key={i} frame={frame} />
          ))}
        </ol>
      </div>
    </section>
  )
}
