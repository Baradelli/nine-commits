<!--
Shipping copy for LinkedIn. Scored 85.3 PASS on the humanizer; treat the body
below as final and paste it as-is.

No link in the body, on purpose: LinkedIn suppresses the reach of posts that
carry an outbound link. The post URL goes in the FIRST COMMENT instead, which
is what "Link in the comments." at the end refers to:
https://baradelli.github.io/nine-commits/posts/01-not-an-agent/

One deliberate deviation from the staged draft: the staged file wrote the
command as `find.` with no space, which would not run and does not match
`trace.json`. Restored to `find .`.
-->

"I can't directly count files from the image alone."

There was no image.

I'd asked gpt-5-mini to count the TypeScript files in my project. It was running in a terminal. Just one sentence of text, no attachment.

It guessed it was looking at a pasted screenshot, because that's how a question like that usually arrives. It has no way to check. So it guessed wrong.

Then it handed me the command to run myself:

find . -type f -name "*.ts" | wc -l

And signed off with "I'll tell you the number once you provide the output."

So I ran it. I got 4,697 files back.

4,660 of those are inside node_modules. The real answer is 37.

So the plan was wrong too. Correctly shaped, quietly useless, and here's the part that kept me up: the model would have taken 4,697 and handed it back as the answer. It can't look at a number it didn't produce and think "that can't be right."

My program makes one call, prints the reply, and exits. 33 lines of agent, 2 frames, 245 tokens, zero files read.

An agent would have run the command, seen 4,697, and noticed a repo with 37 source files doesn't have four thousand. Then it would have run a better one.

That second look is the loop. It's the whole difference between a reply and a result, and nothing in the text tells you which one you got.

I'm building an agent from scratch in nine commits, each with the real recorded run, failures included.

Commit 1 of 9. Link in the comments.
