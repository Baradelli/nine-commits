<!--
Shipping copy for LinkedIn. Hook #11 Myth Bust. 1771 characters.
Scored 75.9 PASS on the humanizer; treat the body below as final and paste it as-is.
Numbers verified: 10 of 10, against runs.tsv and the published page.

No link in the body, on purpose: LinkedIn suppresses the reach of posts that
carry an outbound link. The post URL goes in the FIRST COMMENT instead, which
is what "Link in the comments." at the end refers to:
https://baradelli.github.io/nine-commits/posts/07-context/

Drafted as 2.12% and "47 searches"; the post says 2.1% and "about forty-seven".
Changed to match the page rather than the raw figure.
-->

One web search can fill your context window. I published that claim, and it fills two per cent of it.

I'd written it on the index of a series before building the thing. That's the format. Nine claims, nine commits, and each commit has to earn the claim it was handed or change it in public where the old one was.

So I measured. One search plus one page read costs 5,644 tokens. The window is 266,684. I found the edge by bisection: 1,200,015 characters accepted, 1,224,000 refused.

That's 2.1%. You'd need about forty-seven of them.

Neither number needed the agent I'd spent six commits building. A published context size and one page of text would have done it.

The other half held. Fifty runs with the history left alone finished nothing at all. Every one died on overflow. Fifty with compaction finished 24.

But the sentence was still wider than the runs, and splitting them is what showed it.

When the agent read one page a turn, compaction saved it every time. Zero overflows in eighteen runs.

When it pulled several pages into one turn, it failed seventeen times in thirty-two.

So compaction protects you from accumulation. It can do nothing about one turn that arrives bigger than the budget.

The cost surprised me too. Of 143 graded answers the summariser threw away, the summaries kept 139. It doesn't lose the facts. It makes the agent go back and fetch them again, 5.54 pages a run against the control's 3.00.

One more. My trace format has had a "compaction" frame since commit 1, and my site rendered it in three separate places. No recording had ever contained one.

Six commits of a code path that had never seen real data.

The first real one broke four things. One was a budget meter that couldn't go down.

Commit 7 of 9. Link in the comments.
