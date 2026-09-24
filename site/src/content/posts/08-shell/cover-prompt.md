# Cover image prompt — Post 08

Used only if replacing the generated typographic cover (`cover.png`) with
generative art.

## Parameters

- Size: 1200 × 627 (set it on the request; no image model honours a ratio
  written into the sentence)
- Aspect: 1.91:1, the Open Graph card ratio the site's covers are built to

## Prompt

> A dark editorial illustration for a technical article titled "Shell Access,
> and Why That's Terrifying". Central image: a very large, very heavy doorway
> standing wide open, drawn as a thin outline, its opening running off the top
> of the frame so the top edge is never shown. Bolted across the opening,
> filling it completely, is a flat grille of vertical bars set so close
> together that the gaps between them are hairline — narrower than the bars
> themselves. Through those hairline gaps a small amount of light falls onto
> the floor in front of the doorway, a thin striped band, and that band is the
> only solid colour in the picture. Flat vector style, limited palette of
> blueprint navy (#0b1e2d), cool off-white (#dce6ec) and a single warm amber
> accent (#c2410c) used only on the band of light. Generous negative space on
> the left third for a title overlay. No text in the image. No numerals. No
> people. No robots, no glowing brains, no circuit board motifs, no padlocks,
> no shields, no keyholes.

## Why this image

The doorway is the shell and the grille is the allow-list, and the drawing has
to be honest about both at once, because the finding is that they are the same
size.

The opening runs off the top of the frame for the same reason post 7's vessel
did: you cannot draw the thing and see both ends of it. A shell is every
program on the machine, every flag of every program, and every program those
programs can start. Ninety-seven attacks went at the guard and eighty were
refused, and the eighty are not the interesting number — the interesting number
is that nobody can say what the doorway's height is.

The grille is drawn with the gaps *narrower than the bars* on purpose, because
that is the measurement. The allow-list that survived being attacked cannot
write a file, cannot run an interpreter, cannot chain two commands, and refused
more than a third of the command lines the model actually wrote. It is not a
door you can walk through. The light on the floor is what does get past — a
count, a listing, a search — and it is the only colour in the picture because
it is genuinely all of it.

A padlock and a shield are both in the negative list because both say *this is
secured*, and the post's argument is the opposite: nothing here is secured, one
thing is narrowed. A keyhole is out because a keyhole implies a key, and there
is no key — there is a list of fifteen names and a bet that a name is an
identity, which the post also measures and finds wanting.

## Negative prompt

padlock, shield, keyhole, key, chain, fence, prison bars with wide gaps, vault
door, safe, firewall, brick wall, stop sign, warning triangle, skull, terminal
window, command prompt, blinking cursor, ASCII art, brain, glowing orb, neural
network diagram, circuit board, server rack, cloud icon, hacker in a hoodie,
binary digits, matrix rain, stock-photo businessman, lens flare, text,
numerals, watermark, three-dimensional rendering, gradient mesh

The negative list names the terminal window and the blinking cursor because
"shell" is a word a diffusion model draws as a black rectangle with green text
in it, and a picture of a terminal is a picture of the interface rather than of
the surface. It names prison bars with wide gaps because a grille whose gaps
you could reach through would illustrate the opposite of the result. And it
names matrix rain and the hoodie because this post is not about an attacker; it
is about a tool that does what it is told.
