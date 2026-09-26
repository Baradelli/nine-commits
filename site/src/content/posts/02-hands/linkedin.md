<!--
Shipping copy for LinkedIn. Hook #3 Mistake Confession. 1583 characters.
Scored 75.7 PASS on the humanizer; treat the body below as final and paste it as-is.
Fixed after a cold audit of the published series: "21 more times per side"
implied 46 runs where the post says 21 a side including the two published
traces, and the same copy then said 42.

Every figure in the body is one the post publishes, and that is now a test
rather than a promise — `tools/linkedin/copy.test.ts` reads this file and fails
if a number in it is not on the page. The humanizer score is the one figure
here nothing in the repository can check, because the humanizer lives outside
it; it was recomputed on the body below.

No link in the body, on purpose: LinkedIn suppresses the reach of posts that
carry an outbound link. The post URL goes in the FIRST COMMENT instead, which
is what "Link in the comments." at the end refers to:
https://baradelli.github.io/nine-commits/posts/02-hands/
-->

I almost shipped a conclusion I'd measured exactly once.

I'm building an AI agent from scratch and writing up each commit. Post 2 makes a claim: write a tool's description badly and the model reaches for the wrong tool.

So I tested it on gpt-5-mini. Same question, same model, same code. The only thing I changed was the wording on two tools, list_files and search_files.

With precise descriptions it called list_files, the wrong one. It got 68 paths back, then told me "I can't read the repository files from here" with that list sitting directly above it in its own context.

With thin descriptions it called search_files, the right one, and searched for model_name in a codebase that spells it MODEL_NAME. Zero hits.

Both runs came out backwards from the post I'd half-drafted.

So I took it to 21 runs a side, those two included. Precise reached the right tool 12 times out of 21 and answered in full 4 times. Thin reached it twice and answered zero.

The claim holds. But the two runs I'd recorded were the least likely outcome on both sides, and I had nearly published them as the demonstration.

The thing I was measuring was a coin I'd flipped once per side.

I kept both traces anyway, exactly as recorded. Re-rolling until the demo agrees with the table is how you end up with a series nobody should believe.

One more number worth having: the precise descriptions cost 204 tokens of standing context against 96 for the thin ones. Better tool selection isn't free, and nobody prices it.

All 42 runs ship as a file beside the post.

Commit 2 of 9. Link in the comments.
