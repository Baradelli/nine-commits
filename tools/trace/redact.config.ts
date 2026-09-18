/**
 * Project-specific strings that must never appear in a published trace.
 * Add to this list whenever a run touches something private.
 *
 * A8.1 — NOTE ON WHITESPACE. Every entry is TRIMMED before it becomes a rule:
 * `'  hunter2  '` redacts `hunter2`, not the padded form, so a leading or
 * trailing space you meant to be part of the secret is dropped.
 *
 * Trimming is kept rather than matching entries verbatim because an entry
 * that is only whitespace would otherwise compile to a pattern matching every
 * space in every trace, and a deny list must not be able to corrupt the
 * content it exists to protect. It is written down here, in the file you are
 * typing in when it matters, because silent normalization on a security list
 * is a footgun wherever it is documented instead.
 *
 * Matching is case-insensitive and substring-based: an entry redacts every
 * occurrence, anywhere, in any casing.
 */
export const defaultDenyList: string[] = []
