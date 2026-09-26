<!--
Shipping copy for LinkedIn. Hook #11 Myth Bust. 1932 characters.
Scored 76.7 PASS on the humanizer; treat the body below as final and paste it as-is.
Fixed after a cold audit of the published series: "broke four things"
against the post's three defects, and "it doesn't lose the facts" against 4
of 143 answers lost and 3 of 80 mis-attributed.

Every figure in the body is one the post publishes, and that is now a test
rather than a promise — `tools/linkedin/copy.test.ts` reads this file and fails
if a number in it is not on the page. The humanizer score is the one figure
here nothing in the repository can check, because the humanizer lives outside
it; it was recomputed on the body below.

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

The cost surprised me too. Of 143 graded answers the summariser threw away, the summaries kept 139. Four went, all the same one. Three more of 80 came through with the right number cited to the wrong page. So the loss is real and it's small, and it isn't where the cost is: the cost is the agent going back and fetching the page again, 5.54 pages a run against the control's 3.00.

One more. My trace format has had a "compaction" frame since commit 1, and my site rendered it in three separate places. No recording had ever contained one.

Six commits of a code path that had never seen real data.

The first real one broke three things. One was a budget meter that couldn't go down.

Commit 7 of 9. Link in the comments.
