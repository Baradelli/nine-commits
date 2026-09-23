# Cover image prompt — Post 06

Used only if replacing the generated typographic cover (`cover.png`) with
generative art.

## Parameters

- Size: 1200 × 627 (set it on the request; no image model honours a ratio
  written into the sentence)
- Aspect: 1.91:1, the Open Graph card ratio the site's covers are built to

## Prompt

> A dark editorial illustration for a technical article titled "Four
> Operations". Central image: four plain rectangular blocks of identical size
> standing in a row, each one solid and evenly lit, resting on a thin
> horizontal rule. A fifth block of the same size stands at the right end of
> the row, drawn only as an outline with nothing inside it, and it casts a
> long flat shadow across the rule that the four solid blocks do not cast. The
> shadow is the only thing in the image that is longer than a block. Flat
> vector style, limited palette of blueprint navy (#0b1e2d), cool off-white
> (#dce6ec) and a single amber accent (#e8a93c) used only on the outline of
> the fifth block and on its shadow. Generous negative space on the left third
> for a title overlay. No text in the image. No numerals. No people. No
> robots, no glowing brains, no circuit board motifs, no toolboxes, no
> wrenches, no hands.

## Why this image

The finding is not that the fifth tool broke anything. It did not: it was
reached for on exactly the task it was right for, ten times out of ten, and
never once on the forty runs where it was wrong. Four blocks and five blocks
hold the row up equally well, which is why the fifth is the same size and sits
in the same line rather than being drawn as an intruder.

What the fifth has that the four do not is the shadow. Its definition rides in
every request for the whole life of every run — 88 tokens, measured, before the
agent has done anything at all — and that charge is paid whether or not the
tool is ever called. An empty outline casting the only long shadow in the
picture is the shape of a cost with no corresponding body.

The thin rule under the blocks is there so the row reads as a set rather than
as a comparison. This post is not a before-and-after.

## Negative prompt

toolbox, wrench, hammer, screwdriver, spanner, swiss army knife, hands holding
tools, robot arm, gear, cog, machinery, folder icon, file icon, document icon,
floppy disk, save icon, keyboard, terminal window, code editor screenshot,
padlock, shield, firewall, warning triangle, red cross, checkmark, scales,
balance beam, seesaw, stock-photo businessman, lens flare, text, numerals,
watermark, heavy drop shadows on the four solid blocks

The negative list names the toolbox and the wrench because "four operations"
and "a fifth tool" are phrases a diffusion model draws as hardware, and nothing
in this post is about tools as objects. It names the padlock and the shield
because the sandbox is the other half of the commit and a lock on a cover would
promise a post about security rather than a post about a tool nobody misused.
It names the scales and the seesaw because the four and the five did not come
out unequal, and a balance drawn tipping either way would be an illustration of
a result this page does not have.
