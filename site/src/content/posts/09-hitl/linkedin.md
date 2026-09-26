<!--
Shipping copy for LinkedIn. Hook #2 Number Reveal. 1676 characters.
Scored 76.7 PASS on the humanizer; treat the body below as final and paste it as-is.
Numbers verified: 12 of 12, against runs.tsv and the published page.

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

No gate: 50 of 50 finished. Gate with every answer yes: 50 of 50. The gate costs nothing when you say yes.

Gate with every answer no: 10 of 50. And all 10 were the one task that never triggers it.

A denial doesn't slow the agent down. It ends the task.

What it does next is the part I'd wondered about. Across 40 denied runs, 30 asked again. 38 put the change into the answer as text. 27 handed me a command line to run myself, 8 of those sed -i, which is a command my own guard from commit 8 refuses to run.

Not one claimed success.

A gate is a boundary around the agent. It is not a boundary around the change.

The mechanism surprised me too. An approval isn't a pause, it's a suspension. The loop returns a conversation with an unanswered question sitting in it, so the branch point is a value. The same recording continues twice, from the same bytes. That's why both branches on the page are real runs and neither is a reconstruction.

Nine commits, one claim each, and 4 of the 9 are not the claims I started with.

Building the thing produced the first correction every time. It never produced the last one.

Series done. Link in the comments.
