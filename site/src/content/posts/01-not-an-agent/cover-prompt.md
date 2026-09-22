# Cover image prompt — Post 01

Used only if replacing the generated typographic cover (`cover.png`) with
generative art.

## Parameters

- Size: 1200 × 627 (set it on the request; no image model honours a ratio
  written into the sentence)
- Aspect: 1.91:1, the Open Graph card ratio the site's covers are built to

## Prompt

> A dark editorial illustration for a technical article titled "An LLM Is Not
> an Agent". Central image: a bright, sharply detailed speech bubble floating
> above a closed laptop. The laptop is dark, shut, and evenly lit, its surface
> clean and unmarked — the light from the bubble falls nowhere on it, and the
> laptop casts its own soft shadow onto the desk while the bubble casts none.
> The bubble's tail curls away from the machine and out of the frame toward
> the viewer. Flat vector style, limited palette of blueprint navy (#0b1e2d),
> cool off-white (#dce6ec) and a single cyan accent (#5fd3e4) reserved for the
> bubble. Generous negative space on the left third for a title overlay.
> No text in the image. No people. No glowing brains, no robots, no circuit
> board motifs.

The "no shadow" idea is stated positively as well as negatively — an unmarked,
evenly lit laptop surface, with the bubble's light landing nowhere — because
diffusion models act on what a prompt describes, not on what it forbids.

## Why this image

The recorded run contains a wrong fact and a correct plan. It asserted an image
that did not exist, and it also named the right command for two platforms and
closed with "I'll tell you the number once you provide the output" — a second
turn the program has no way to give it.

So the picture has two jobs. The bubble throws no light on the laptop, because
nothing the model said touched the machine. And the tail points back out at the
reader, because the model's plan ends with the human running the command. That
is the post in one frame: a reply, addressed to someone else, where a result
should have been.

## Negative prompt

robots, humanoid AI, glowing brain, circuit board, neural network diagram,
stock-photo businessman, lens flare, text, watermark, drop shadow under the
speech bubble, reflections on the laptop lid
