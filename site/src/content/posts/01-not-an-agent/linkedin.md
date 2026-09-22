I asked a language model to count the TypeScript files in my project.

It told me it couldn't count them "from the image alone."

There was no image. There was a command-line program with no concept of a file
upload, and one sentence of text. The model guessed it was looking at a
screenshot pasted into a chat window, because that is how a question like that
usually reaches it, and it has no way to check.

Then it did something better. It gave me the command to run, for two operating
systems, and finished with: "I'll tell you the number once you provide the
output."

There is no "once." The program makes one model call, prints the answer, and
exits. The model had just described the loop it needed — run a command, read
the result, answer — and handed every step after the first back to me, because
I hadn't built anywhere else for them to go.

That is the whole argument for agents in one reply. Not that the model was
wrong. It was a very good chat message. It just could not turn a reply into a
result, and nothing in the text tells you which of the two you got.

I'm building an agent from scratch in nine commits and writing up each one,
with the real recorded runs — including the ones that fail like this. You can
step through this exact trace on the post.

Commit 1 of 9: An LLM Is Not an Agent.

https://baradelli.github.io/nine-commits/posts/01-not-an-agent/
