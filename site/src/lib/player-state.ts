export type PlayerState = {
  index: number
  playing: boolean
  total: number
}

export type PlayerAction =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'reset' }
  | { type: 'seek'; index: number }

export function initialState(total: number): PlayerState {
  return { index: 0, playing: false, total }
}

function clamp(index: number, total: number): number {
  const last = Math.max(0, total - 1)
  return Math.min(Math.max(index, 0), last)
}

export function reduce(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'next': {
      const index = clamp(state.index + 1, state.total)
      const atEnd = index === Math.max(0, state.total - 1)
      return { ...state, index, playing: atEnd ? false : state.playing }
    }
    case 'prev':
      return { ...state, index: clamp(state.index - 1, state.total) }
    case 'play':
      return { ...state, playing: true }
    case 'pause':
      return { ...state, playing: false }
    case 'reset':
      return initialState(state.total)
    case 'seek':
      return { ...state, index: clamp(action.index, state.total) }
  }
}

export function visibleFrames<T>(frames: T[], state: PlayerState): T[] {
  if (frames.length === 0) return []
  return frames.slice(0, state.index + 1)
}
