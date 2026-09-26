<!--
Shipping copy for LinkedIn. Hook #10 The Receipt. 1553 characters.
Scored 72.6 PASS on the humanizer; treat the body below as final and paste it as-is.
Fixed after a cold audit of the published series: the copy listed four
verdicts where the grader has five, and named one (`from-copy`) that none of
the seven runs returned while omitting one (`ungradable`) that one of them
did. Replaced with the property. Separately, the "86 bytes" this copy opens
on was nowhere on the page — the post now prints it and
`tools/eval/corpus.test.ts` asserts it.

Every figure in the body is one the post publishes, and that is now a test
rather than a promise — `tools/linkedin/copy.test.ts` reads this file and fails
if a number in it is not on the page. The humanizer score is the one figure
here nothing in the repository can check, because the humanizer lives outside
it; it was recomputed on the body below.

No link in the body, on purpose: LinkedIn suppresses the reach of posts that
carry an outbound link. The post URL goes in the FIRST COMMENT instead, which
is what "Link in the comments." at the end refers to:
https://baradelli.github.io/nine-commits/posts/04-does-it-work/

An earlier draft said post 2's run "passed". It graded `partial`. Corrected
against the eval output; the fix cost humanizer score and was worth it.
-->

Three runs. Three different sets of evidence. The same 86 bytes of answer.

I'm building an AI agent in public and grading it as I go. This week I stopped grading what it said and started grading what it did.

The old check was a substring match on the final text. Does it name agent/src/config.ts. Does it say gpt-5-mini. Get those two strings in and you scored.

So I wrote something that reads the trace: which tool got called, with what arguments, and what came back. list_files hands you a filename. search_files hands you a line out of a file. Not the same evidence, and a substring match can't tell them apart.

I ran it over all 7 recorded runs in the repo. 5 possible verdicts, each about where the answer came from: the source file, a copy of it, both, neither, or a question no single line answers.

Five runs ask the same question. Zero come back grounded.

Three had ground truth and a copy of the answer in the same result set, so either story fits. Two never read a line of anything and answered anyway.

One of those two made 68 observations, every one a filename. It never opened a file, and the old check gave it partial credit for naming the right one.

Here's what stuck. Those three identical answers came from very different runs. One took in 117 observations with a single copy of the answer among them. Another saw 16 copies across 8 files. Same 86 bytes out.

The text tells you nothing about how it got there.

That isn't a model problem. It's what you get when the grader reads the prose.

Commit 4 of 9. Link in the comments.
