<!--
Shipping copy for LinkedIn. Hook #1 Contrarian Take. 1890 characters.
Scored 83.2 PASS on the humanizer; treat the body below as final and paste it as-is.
Fixed after a cold audit of the published series: "the shell doesn't make
the agent worse" is the opposite of the post's own conclusion, which says
the sixth tool does make it worse because its contract is a lie. Also "that
gap is noise", where the post says p = 0.27 and "not a result" — failing to
reject is not a demonstration of noise.

Every figure in the body is one the post publishes, and that is now a test
rather than a promise — `tools/linkedin/copy.test.ts` reads this file and fails
if a number in it is not on the page. The humanizer score is the one figure
here nothing in the repository can check, because the humanizer lives outside
it; it was recomputed on the body below.

No link in the body, on purpose: LinkedIn suppresses the reach of posts that
carry an outbound link. The post URL goes in the FIRST COMMENT instead, which
is what "Link in the comments." at the end refers to:
https://baradelli.github.io/nine-commits/posts/08-shell/

Numbers are digits here and words in the post. Same values; the humanizer's
SPECIFICITY check reads digits and the blog's typography does not.
-->

I gave my agent a shell, then took out everything that makes a shell a shell.

The claim I'd published said a shell gives it everything you can do, including the parts you wouldn't. The first half is true and I proved it in a container: one call ran rm -rf with no-preserve-root, and kept printing from a machine that no longer had an ls.

Then I built the one I'd actually point at my own repo, and it isn't a shell.

Every binary had to pass two tests. I could write down every flag I'd hand it, and it couldn't start another program.

The second test removed sed, awk, perl, python, node, git, xargs, env, sh, tee, tar and rm.

15 survived. 5 of them change files: cp, mv, touch, mkdir, and uniq, which is the one I missed. Its synopsis takes an output operand and nobody remembers that.

But none of the 15 can put a byte I chose into a file. Not because I forbade it. Because every way to do that is either a shell feature I'd already removed or an interpreter I couldn't let in.

So "everything you can do" didn't survive contact with what I was willing to run.

Then I measured it. 140 runs, 70 with the shell and 70 without. 60 finished against 65. At 70 a side that's p = 0.27, which is a gap these runs can't tell apart from nothing.

What they can tell apart is the step cap. The shell hit it 11 times against 0.

And all 11 sit in the 23 runs where the guard refused something. The 39 that held the shell and never called it finished 39 of 39. The 8 whose calls all went through finished 8 of 8.

So the damage isn't the shell. It's the argument with the guard, and the argument happens because the tool's name promises a shell and its implementation is a parser. The sixth tool does make the agent worse. Just not by being misused.

Of 47 refusals, not one was a binary off the list. The list I'd agonised over never fired. The parser did.

Commit 8 of 9. Link in the comments.
