# Cover image prompt — Post 05

Used only if replacing the generated typographic cover (`cover.png`) with
generative art.

## Parameters

- Size: 1200 × 627 (set it on the request; no image model honours a ratio
  written into the sentence)
- Aspect: 1.91:1, the Open Graph card ratio the site's covers are built to

## Prompt

> A dark editorial illustration for a technical article titled "Judging a
> Moving Target". Central image: two measuring instruments in a row, each a
> plain vertical ruler drawn as a thin bar with evenly spaced tick marks. The
> left ruler is held against a small solid amber square and its ticks line up
> with the square's edges exactly. The right ruler is held against nothing at
> all — empty space where the object should be — and yet a single amber mark
> sits confidently on it at a precise tick, as if something had been measured.
> A third, much fainter ruler stands behind both, tilted, with no marks on it.
> Flat vector style, limited palette of blueprint navy (#0b1e2d), cool
> off-white (#dce6ec) and a single amber accent (#e8a93c) used only on the
> square and the two marks. Generous negative space on the left third for a
> title overlay. No text in the image. No numerals on the rulers. No people.
> No robots, no glowing brains, no circuit board motifs, no gavels, no scales
> of justice.

## Why this image

The post has one finding and it is a shape: an instrument that reads correctly
against the thing it can measure, and reads with the same confidence against
nothing. The left ruler is the control set — six cases with a known answer,
where the judge scored 53 of 54. The right ruler is the four runs whose
provenance is not in the trace, where it returned the same verdict 36 times
out of 36 at a mean confidence of 0.93.

The amber mark on the right ruler is precise on purpose. The failure is not a
wobble or a wide error bar. It is a specific verdict, in the right vocabulary,
with a citation that checks out, about something that is not there to be
measured — which is why it sits at a tick rather than smeared across several.

The third ruler behind them is this post's own harness, which is the next
instrument nobody has checked.

## Negative prompt

gavel, scales of justice, courtroom, judge's wig, checkmark, tick mark as
approval, red cross, X mark, dartboard, bullseye with arrows, crosshair,
target reticle, clipboard, report card, star rating, robots, humanoid AI,
glowing brain, circuit board, neural network diagram, stock-photo businessman,
lens flare, text, numerals, watermark, heavy drop shadows

The negative list names the dartboard and the crosshair because "moving
target" is a phrase a diffusion model draws literally, and this post is not
about aim. Nothing here is missing a target. The problem is an instrument that
reports a reading when there is nothing under it.
