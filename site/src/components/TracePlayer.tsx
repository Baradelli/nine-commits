import { useEffect, useReducer } from 'preact/hooks'
import { initialState, isAtEnd, reduce, visibleFrames } from '../lib/player-state.ts'
import { FrameView } from './Frame.tsx'

type AnyFrame = { type: string; [key: string]: unknown }

type Trace = {
  id: string
  commit: string
  model: string
  task: string
  outcome: 'success' | 'failure' | 'partial'
  tokens: number[]
  frames: AnyFrame[]
}

const STEP_MS = 1400

export default function TracePlayer({ trace }: { trace: Trace }) {
  // Generics are inferred from `reduce`; naming them explicitly breaks across
  // Preact hook typings.
  const [state, dispatch] = useReducer(reduce, initialState(trace.frames.length))

  useEffect(() => {
    if (!state.playing) return
    const timer = setTimeout(() => dispatch({ type: 'next' }), STEP_MS)
    return () => clearTimeout(timer)
  }, [state.playing, state.index])

  const shown = visibleFrames(trace.frames, state)
  const atEnd = isAtEnd(state)

  return (
    <section aria-label={`Recorded run: ${trace.task}`} data-trace-player>
      <header>
        <p>{trace.task}</p>
        <p>
          {trace.model} · {trace.commit} · outcome: {trace.outcome}
        </p>
      </header>

      <ol data-frames>
        {shown.map((frame, i) => (
          <FrameView key={i} frame={frame} />
        ))}
      </ol>

      <div role="group" aria-label="Playback controls">
        <button
          type="button"
          onClick={() => dispatch({ type: 'prev' })}
          disabled={state.index === 0}
        >
          Previous
        </button>
        <button
          type="button"
          data-action="next"
          onClick={() => dispatch({ type: 'next' })}
          disabled={atEnd}
        >
          Next
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: state.playing ? 'pause' : 'play' })}
          disabled={atEnd}
        >
          {state.playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={() => dispatch({ type: 'reset' })}>
          Reset
        </button>
        <p aria-live="polite">
          Frame {state.index + 1} of {trace.frames.length}
        </p>
      </div>
    </section>
  )
}
