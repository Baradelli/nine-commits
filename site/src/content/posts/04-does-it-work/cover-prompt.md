# Cover image prompt — Post 04

Used only if replacing the generated typographic cover (`cover.png`) with
generative art.

## Parameters

- Size: 1200 × 627 (set it on the request; no image model honours a ratio
  written into the sentence)
- Aspect: 1.91:1, the Open Graph card ratio the site's covers are built to

## Prompt

> A dark editorial illustration for a technical article titled "But Does It
> Work?". Central image: three identical printed sentences stacked one above
> the other, rendered as featureless grey bars of exactly the same length, so
> they read as the same line repeated. Beneath each bar, a short vertical
> thread drops down to a different cluster of small marks: the first thread
> ends in a single amber mark, the second in a scattered crowd of pale marks,
> the third in nothing at all. The bars are identical; only what hangs below
> them differs. Flat vector style, limited palette of blueprint navy
> (#0b1e2d), cool off-white (#dce6ec) and a single amber accent (#e8a93c) used
> only on the one isolated mark. Generous negative space on the left third for
> a title overlay. No text in the image. No people. No robots, no glowing
> brains, no circuit board motifs, no checkmarks, no red crosses, no scales of
> justice, no magnifying glass.

The negative list names checkmarks, crosses and scales because those are what
a diffusion model reaches for when it is handed the word "evaluation", and all
three are wrong for this post. Nothing here is being marked right or wrong.
The verdict the post is about is "I cannot tell", and there is no icon for
that.

## Why this image

Three real recorded runs in this repository end with the same sentence,
character for character, and the evidence behind them is not the same. That is
the whole post, and it is a picture: identical on top, different underneath.
The reader who only sees the top row has to grade three runs that look
identical, which is exactly what the substring check was doing.

The amber goes on the single isolated mark — the one run whose answer has one
possible source — because it is the only one of the three the trace can
actually account for, and it took a different question rather than a better
grader to get it.

The third thread ending in nothing is the run that answered without having
read anything. It is drawn as an absence rather than as an error, because the
grader it fooled did not see an error either.

## Negative prompt

checkmark, tick, red cross, X mark, scales of justice, gavel, magnifying
glass, clipboard, report card, star rating, traffic lights, robots, humanoid
AI, glowing brain, circuit board, neural network diagram, stock-photo
businessman, lens flare, text, watermark, heavy drop shadows
