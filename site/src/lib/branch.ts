/**
 * Where two recordings of one run stop agreeing.
 *
 * A new file rather than a line in `player-state.ts`, which is frozen and
 * stays frozen. It holds no state and knows nothing about playback: it answers
 * one question about two arrays, which is the question the branching player
 * needs answered before it can mount anything.
 *
 * The fork point is **computed, never declared.** A post that wrote down
 * "the branch is at frame six" would be a post whose central claim is a
 * number in prose, and post 1's validate gate is this series' standing
 * reminder of what happens to a claim nothing checks. Here the page cannot
 * draw a fork anywhere except where the files actually diverge.
 */

export type BranchFrames = { frames: unknown[] }

export function forkAt(traces: readonly BranchFrames[]): number {
  const first = traces[0]
  if (first === undefined || traces.length < 2) return 0

  const shortest = Math.min(...traces.map((trace) => trace.frames.length))
  for (let i = 0; i < shortest; i += 1) {
    const here = JSON.stringify(first.frames[i])
    if (traces.some((trace) => JSON.stringify(trace.frames[i]) !== here)) return i
  }
  // No disagreement inside the shorter one: one recording is a prefix of the
  // other, and the fork is where the shorter one runs out.
  return shortest
}
