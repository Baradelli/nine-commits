# Cover image prompt — Post 02

Used only if replacing the generated typographic cover (`cover.png`) with
generative art.

## Parameters

- Size: 1200 × 627 (set it on the request; no image model honours a ratio
  written into the sentence)
- Aspect: 1.91:1, the Open Graph card ratio the site's covers are built to

## Prompt

> A dark editorial illustration for a technical article titled "Giving It
> Hands". Central image: two identical mechanical hands reaching down toward a
> flat plane of paper, one from the left and one from the right. Beneath the
> left hand the paper is covered in fine, sharp, evenly ruled lines; beneath
> the right hand the same paper is blank. The hands are the same object, drawn
> the same way, at the same scale, evenly lit — the difference is entirely in
> what is under them, never in the hands themselves. Flat vector style,
> limited palette of blueprint navy (#0b1e2d), cool off-white (#dce6ec) and a
> single amber accent (#e8a93c) reserved for the ruled lines. Generous
> negative space on the left third for a title overlay. No text in the image.
> No people. No robots, no glowing brains, no circuit board motifs.

The two hands are deliberately identical, and the prompt says so twice, in
positive terms — same object, same scale, same lighting — because a diffusion
model will otherwise reach for the obvious contrast and make one of them
broken.

## Why this image

The tools are the same code in both runs. The only thing that differs between
them is the sentence describing each one, and the recorded runs say that
sentence is worth a sixfold difference in which tool gets picked. So the
picture has to put the difference somewhere other than the hands: identical
instruments, and a surface that is either ruled for them or blank.

It is also honest about what the post found. The hands do not look different,
and neither does the code. You cannot see a bad tool description by looking at
the tool.

## Negative prompt

robots, humanoid AI, glowing brain, circuit board, neural network diagram,
broken or damaged hand, asymmetrical hands, stock-photo businessman, lens
flare, text, watermark, heavy drop shadows
