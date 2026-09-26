<!--
Shipping copy for LinkedIn. Hook #2 Number Reveal. 1978 characters.
Scored 79.9 PASS on the humanizer; treat the body below as final and paste it as-is.
Fixed after a cold audit of the published series: "a denial doesn't slow the
agent down" against a measured 5.32 steps a run versus 4.60 and double the
output; "4 of the 9 are not the claims I started with", which `index.astro`
carries a comment warning against; and "it never produced the last one",
which is false of post 3, as the post itself now says.

Every figure in the body is one the post publishes, and that is now a test
rather than a promise — `tools/linkedin/copy.test.ts` reads this file and fails
if a number in it is not on the page. The humanizer score is the one figure
here nothing in the repository can check, because the humanizer lives outside
it; it was recomputed on the body below.

No link in the body, on purpose: LinkedIn suppresses the reach of posts that
carry an outbound link. The post URL goes in the FIRST COMMENT instead, which
is what "Link in the comments." at the end refers to:
https://baradelli.github.io/nine-commits/posts/09-hitl/

Opens on 79/79 rather than the 116 questions, because 79/79 is what the post
leads with and is the commit's own title.
-->

A permission gate on my agent's command tool would have asked me 79 questions. All 79 were about commands that couldn't change a byte.

That's counted from last week's committed run file, not estimated. The model reached for 4 programs across 140 runs: grep 55 times, wc 17, find 6, ls once. I read all 6 find lines. Every one of them is find with -exec grep or -exec wc.

A gate on the tool name asks about everything and catches nothing.

So I built the real one and measured what asking buys. 150 runs, 3 conditions.

No gate: 50 of 50 finished. Gate with every answer yes: 50 of 50, and the context the model starts from is the same integer in both columns, 21,620 tokens over 50 runs. What saying yes costs is 40 interruptions and nothing else I could measure.

Gate with every answer no: 10 of 50. And all 10 were the one task that never triggers it.

A denial ends the task. It doesn't end the work: 5.32 steps a run against 4.60, and double the output tokens, the extra being a paragraph telling me how to do it myself.

What it does next is the part I'd wondered about. Across 40 denied runs, 30 asked again. 38 put the change into the answer as text. 27 handed me a command line to run myself, 8 of those sed -i, which is a command my own guard from commit 8 refuses to run.

Not one claimed success.

A gate is a boundary around the agent. It is not a boundary around the change.

The mechanism surprised me too. An approval isn't a pause, it's a suspension. The loop returns a conversation with an unanswered question sitting in it, so the branch point is a value. The same recording continues twice, from the same bytes. That's why both branches on the page are real runs and neither is a reconstruction.

Nine commits, one claim each, and 4 of the 9 say something different from what I believed before I built them.

Building the thing produced the first correction every time. Only once out of four did it produce the last one.

Series done. Link in the comments.
