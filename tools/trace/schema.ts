import { z } from 'zod'

export const frameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user'), content: z.string() }),
  z.object({
    type: z.literal('tool_call'),
    id: z.string(),
    name: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal('tool_result'),
    id: z.string(),
    ok: z.boolean(),
    result: z.unknown(),
  }),
  z.object({ type: z.literal('assistant'), content: z.string() }),
  z.object({
    type: z.literal('compaction'),
    before: z.number().int().nonnegative(),
    after: z.number().int().nonnegative(),
    summary: z.string(),
  }),
  z.object({
    type: z.literal('approval'),
    tool: z.string(),
    decision: z.enum(['allow', 'deny']),
  }),
])

export const traceSchema = z
  .object({
    id: z.string().min(1),
    commit: z.string().min(1),
    model: z.string().min(1),
    task: z.string().min(1),
    outcome: z.enum(['success', 'failure', 'partial']),
    tokens: z.array(z.number().int().nonnegative()),
    frames: z.array(frameSchema).min(1),
  })
  .refine((t) => t.tokens.length === t.frames.length, {
    message: 'tokens must have one entry per frame',
    path: ['tokens'],
  })

export type Frame = z.infer<typeof frameSchema>
export type Trace = z.infer<typeof traceSchema>

export function parseTrace(value: unknown): Trace {
  return traceSchema.parse(value)
}
