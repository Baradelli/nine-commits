# Cover image prompt — Post 09

Used only if replacing the generated typographic cover (`cover.png`) with
generative art.

## Parameters

- Size: 1200 × 627 (set it on the request; no image model honours a ratio
  written into the sentence)
- Aspect: 1.91:1, the Open Graph card ratio the site's covers are built to

## Prompt

> A dark editorial illustration for a technical article titled "The Human in
> the Loop". Central image: a single thin line entering from the left, running
> straight and unbroken for most of the frame, then splitting into exactly two
> lines that continue to the right edge. The two branches are drawn
> identically — same weight, same length, neither favoured. At the split there
> is no arrow, no fork glyph and no junction box: only a small gap in the line,
> as if the line stopped there and waited. The upper branch ends in a small
> filled square; the lower branch ends in the same square, unfilled. Flat
> vector style, limited palette of blueprint navy (#0b1e2d), cool off-white
> (#dce6ec) and a single warm amber accent (#c2410c) used only on the gap at
> the split. Generous negative space on the left third for a title overlay. No
> text in the image. No numerals. No people. No robots, no glowing brains, no
> circuit board motifs, no signposts, no crossroads photography.

## Why this image

The line is the run, and the whole argument of the post is in the proportions:
the unbroken part is long and the branches are short, because the thing that
was recorded once is most of the work and the thing that differs is the end of
it. A drawing that split the line in the middle would illustrate two runs,
which is what the site has shown since post 2 and is not what this page shows.

The gap is the only coloured thing because the gap is the finding. An approval
is not a pause inside a running program — the loop *returns*, and what it
returns is a conversation with an unanswered question in it. That is why the
same recording can be continued twice: the branch point is a value, not a
moment. A drawing with an arrow or a switch at the junction would say the
program routed itself; a gap says it stopped and something outside it had to
arrive.

The two end markers are one filled and one hollow, and they are the same size.
The allowed branch wrote a file and the denied branch did not, and the denied
branch is not the smaller of the two — in the recording it is the longer one,
because the agent asked again, was refused again, and then wrote out the shell
command for a person to run by hand. Making the denied end visibly lesser would
be the picture arguing something the runs contradict.

A signpost and a crossroads are in the negative list because both are about a
traveller choosing a route. Nothing here chooses a route. The run cannot
continue at all until somebody answers, and the reader who clicks is not
picking a path through a maze — they are answering a question that was actually
asked, and watching what actually happened next.

## Negative prompt

signpost, crossroads, road, fork in a path, railway points, switch lever,
arrow, flowchart, decision diamond, git branch diagram, tree, river delta,
lightning bolt, handshake, human silhouette, pointing hand, thumbs up, thumbs
down, checkmark, cross mark, traffic light, gate, turnstile, brain, glowing
orb, neural network diagram, circuit board, terminal window, blinking cursor,
binary digits, stock-photo businessman, lens flare, text, numerals, watermark,
three-dimensional rendering, gradient mesh

The checkmark and the cross are named because *allow* and *deny* are the two
words a diffusion model reaches for a tick and a cross to draw, and a tick and
a cross say one branch is correct. Neither branch is correct: one is what
happened when the answer was yes and the other is what happened when it was no,
and the post's result is about what the second one did, not about which was
right. The decision diamond and the git branch diagram are named because this
is not a flowchart of a program — the program has no branch in it at all. The
branch is in the recording.
