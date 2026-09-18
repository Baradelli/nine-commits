import { describe, it, expect } from 'vitest'
import { initialState, reduce, visibleFrames, isAtEnd } from './player-state.ts'

describe('player-state', () => {
  it('starts at the first frame, paused', () => {
    expect(initialState(5)).toEqual({ index: 0, playing: false, total: 5 })
  })

  it('advances with next', () => {
    expect(reduce(initialState(3), { type: 'next' }).index).toBe(1)
  })

  it('stops at the last frame and pauses there', () => {
    let s = initialState(2)
    s = reduce(s, { type: 'play' })
    s = reduce(s, { type: 'next' })
    s = reduce(s, { type: 'next' })
    expect(s).toEqual({ index: 1, playing: false, total: 2 })
  })

  it('does not go below the first frame', () => {
    expect(reduce(initialState(3), { type: 'prev' }).index).toBe(0)
  })

  it('clamps a seek beyond the end', () => {
    expect(reduce(initialState(3), { type: 'seek', index: 99 }).index).toBe(2)
  })

  it('clamps a negative seek', () => {
    expect(reduce(initialState(3), { type: 'seek', index: -4 }).index).toBe(0)
  })

  it('reset returns to the start and pauses', () => {
    const played = reduce(reduce(initialState(4), { type: 'play' }), {
      type: 'next',
    })
    expect(reduce(played, { type: 'reset' })).toEqual({
      index: 0,
      playing: false,
      total: 4,
    })
  })

  it('exposes frames up to and including the current index', () => {
    const frames = ['a', 'b', 'c']
    const at1 = reduce(initialState(3), { type: 'next' })
    expect(visibleFrames(frames, at1)).toEqual(['a', 'b'])
  })

  it('handles an empty trace without crashing', () => {
    const s = initialState(0)
    expect(visibleFrames([], s)).toEqual([])
    expect(reduce(s, { type: 'next' }).index).toBe(0)
  })

  it('keeps playing across an intermediate frame, and stops only on the step that reaches the end', () => {
    let s = initialState(3)
    s = reduce(s, { type: 'play' })
    s = reduce(s, { type: 'next' })
    expect(s).toEqual({ index: 1, playing: true, total: 3 })
    s = reduce(s, { type: 'next' })
    expect(s).toEqual({ index: 2, playing: false, total: 3 })
  })

  it('isAtEnd is true only at the last index', () => {
    expect(isAtEnd(initialState(3))).toBe(false)
    expect(isAtEnd(reduce(initialState(3), { type: 'next' }))).toBe(false)
    expect(
      isAtEnd(reduce(reduce(initialState(3), { type: 'next' }), { type: 'next' })),
    ).toBe(true)
    expect(isAtEnd(initialState(0))).toBe(true)
  })
})
