<!--
Shipping copy for LinkedIn. Hook #3 Mistake Confession. 2178 characters.
Scored 82.2 PASS on the humanizer; treat the body below as final and paste it as-is.
Fixed after a cold audit of the published series: "it cost 88 tokens of
context and nothing else" is the exact formulation the index thesis was
corrected away from in 1c020e8, and the post spends a section on why.
Restored the qualifier and the floor. Also "approved a path that wrote
outside the sandbox" — the post demonstrates approval of the path, not a
write.

Every figure in the body is one the post publishes, and that is now a test
rather than a promise — `tools/linkedin/copy.test.ts` reads this file and fails
if a number in it is not on the page. The humanizer score is the one figure
here nothing in the repository can check, because the humanizer lives outside
it; it was recomputed on the body below.

No link in the body, on purpose: LinkedIn suppresses the reach of posts that
carry an outbound link. The post URL goes in the FIRST COMMENT instead, which
is what "Link in the comments." at the end refers to:
https://baradelli.github.io/nine-commits/posts/06-four-operations/

One line is not quotable from the published post: "all 5 tools refuse and the
escape counter reads 5 instead of 0". It is true and pinned by
`agent/src/tools/write.test.ts:167`, which asserts every escaping call is
recorded, but the post's prose states it differently.
-->

The hole in my sandbox was in the part I was proudest of.

My agent got a write tool this week. Until now it could only read, so a bad run cost a wrong answer. Now it costs a modified repository, and mine is public with five posts in it.

So I wrote a guard. One function turns a model-supplied string into a path: resolve it, check containment by path segment rather than string prefix, then re-check against the real path of the deepest folder that already exists, so a symlink can't be used to create a file outside.

That last clause is the clever bit. It's where the hole was.

The existence check used existsSync. existsSync follows links. A link pointing at something that doesn't exist yet reports false, the walk climbs past it, and the link check never runs.

A reviewer measured it. The guard approved a path that resolved outside the sandbox.

My agent can't reach it: nothing in the program creates a link, and the sandbox is mkdtemp'd fresh. 150 runs, 0 stray writes. But I'd written in the post that nothing could get a path out of that function, and people copy guards out of posts.

Two lines. lstatSync doesn't follow. Refuse a link at the anchor.

Then the fix broke a sentence the fix had just written. I claimed every branch fails closed and left one realpath call outside the try, so a deleted sandbox threw a raw ENOENT carrying the absolute path every other error in that file is written to hide. Now all 5 tools refuse and the escape counter reads 5 instead of 0.

Two rounds, each adding a false claim to the paragraph it existed to correct.

The experiment underneath: 4 filesystem tools finished 50 of 50 tasks. 5 finished 50 of 50 too. The fifth was chosen 10 times out of 10 on the one task it suits, and 0 out of 10 on the task where its name is a trap. It cost 88 tokens of context and nothing else I could measure at 50 runs. That qualifier is the whole claim. 50 runs with nothing going wrong only rules out a failure rate above 5.8%, so they can't tell you it costs nothing.

My published thesis said a fifth tool makes an agent worse. I couldn't find it, so I changed the thesis to say that and not more.

Commit 6 of 9. Link in the comments.
