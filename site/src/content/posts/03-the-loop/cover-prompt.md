# Cover image prompt — Post 03

Used only if replacing the generated typographic cover (`cover.png`) with
generative art.

## Parameters

- Size: 1200 × 627 (set it on the request; no image model honours a ratio
  written into the sentence)
- Aspect: 1.91:1, the Open Graph card ratio the site's covers are built to

## Prompt

> A dark editorial illustration for a technical article titled "The Loop".
> Central image: a single continuous ribbon of paper running from left to
> right, which turns back on itself once in the middle and passes over its own
> path before continuing. The ribbon is drawn as one unbroken line; the
> crossing is the only place it touches itself. At the far right the ribbon
> simply stops, cleanly cut, with nothing after it. Flat vector style, limited
> palette of blueprint navy (#0b1e2d), cool off-white (#dce6ec) and a single
> amber accent (#e8a93c) used only at the cut end. Generous negative space on
> the left third for a title overlay. No text in the image. No people. No
> robots, no glowing brains, no circuit board motifs, no infinity symbol, no
> ouroboros.

The negative list names the infinity symbol and the ouroboros explicitly,
because those are what a diffusion model reaches for when it is handed the
word "loop", and both of them are wrong for this post. An agent's loop is not
endless. It ends, and where it ends is the whole of the second half.

## Why this image

The loop in this commit is one turn back — the model reads what its own action
returned and acts again. Drawing that as a ribbon that crosses its own path
once, rather than as a circle, keeps the run going somewhere: it starts at a
question and finishes at an answer, and the crossing is the part that was
missing at v2.

The cut at the right end is the stop condition, and the amber is spent there
rather than on the crossing, because what stops it is the harder half of this
post. It stops because the model decided to stop. Nothing checks.

## Negative prompt

infinity symbol, ouroboros, snake, circular arrows, recycling symbol, robots,
humanoid AI, glowing brain, circuit board, neural network diagram,
stock-photo businessman, lens flare, text, watermark, heavy drop shadows
