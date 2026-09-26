<!--
Shipping copy for LinkedIn. Hook #2 Number Reveal. 1557 characters.
Scored 84.7 PASS on the humanizer; treat the body below as final and paste it as-is.
Fixed after a cold audit of the published series: the answer key was
described as being "in the tool itself, not in the source code". It is
`agent/src/cli.ts:48`, which the post calls the agent's own source.

Every figure in the body is one the post publishes, and that is now a test
rather than a promise — `tools/linkedin/copy.test.ts` reads this file and fails
if a number in it is not on the page. The humanizer score is the one figure
here nothing in the repository can check, because the humanizer lives outside
it; it was recomputed on the body below.

No link in the body, on purpose: LinkedIn suppresses the reach of posts that
carry an outbound link. The post URL goes in the FIRST COMMENT instead, which
is what "Link in the comments." at the end refers to:
https://baradelli.github.io/nine-commits/posts/03-the-loop/
-->

I promised thirty lines of code. The real number was negative three.

I'm building an AI agent from scratch and publishing each commit. Post 3 was meant to be "the loop": history, tool results, a stop condition. I'd written that claim on the site before building the thing.

Then I built it. The loop was already there.

The SDK had been looping since the previous commit, from the moment I passed it tools. What I'd actually shipped in post 2 was a cap that stopped it after two steps, because I wanted that post to be about tool descriptions and not about loops.

So commit 3 is three lines deleted and one number raised from 2 to 10.

It worked. Same question that failed last time, unchanged: list_files, 77 paths, search_files, found agent/src/config.ts, answered correctly. 41 of 42 runs succeeded, against 4 of 21 before.

But the number I trust is the smaller one. 16 runs opened by calling the wrong tool first, and all 16 recovered. At the previous commit 28 runs opened that way and not one recovered, because the cap took the tools away on the only step left.

That's what the loop buys. Not intelligence. A second try.

Then I found something I wasn't looking for. The agent's own command-line help text contains an example that spells out the exact answer it was being graded on. Ten of my runs found it there, in the agent's own source, one line of a usage string.

I corrected the claim on the site rather than the count. The commits are supposed to earn what the page promises, not the other way round.

Commit 3 of 9. Link in the comments.
