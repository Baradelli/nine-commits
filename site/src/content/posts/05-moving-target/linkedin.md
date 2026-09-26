<!--
Shipping copy for LinkedIn. Hook #19 Curiosity Gap. 1556 characters.
Scored 75.2 PASS on the humanizer; treat the body below as final and paste it as-is.
Numbers verified: 10 of 10, against judgements.tsv.

No link in the body, on purpose: LinkedIn suppresses the reach of posts that
carry an outbound link. The post URL goes in the FIRST COMMENT instead, which
is what "Link in the comments." at the end refers to:
https://baradelli.github.io/nine-commits/posts/05-moving-target/
-->

The only time my AI judge admitted it couldn't tell was the one time it was wrong.

Here's the setup. I'm building an agent in public. Last week I proved that for some recorded runs, no code can determine whether the agent read the source file or a copy of the answer that happened to be in the same search results. Both were there. Either explains the output.

So this week I asked a model instead. One call per case, handed the full trace, four labels to choose from. grounded, undecidable, from-copy, unevidenced. The prompt never hints that declining is an option worth taking.

Ten cases, nine calls each. Six cases have a known answer, and the known answers come from last week's grader, not from me.

On the six it can check: 53 of 54 right.

On the four it cannot possibly answer: 36 of 36 grounded, mean confidence 0.93, not one refusal.

undecidable shows up once in ninety calls. It's on a control where the correct answer was from-copy. The single time this judge declined to choose, declining was the mistake.

I thought the story was that it gets more confident as the evidence gets thinner. Checked it properly and that's not true. A provable grounded costs it 0.9267. An unprovable one costs 0.9283. The gap is under two thousandths.

The confidence prices the label, not the question.

Nine of the ten cases were unanimous across nine repeats. So it isn't noisy. It's consistent, and consistently reaching past what it can see, which is harder to catch than noise.

The whole experiment cost 13 cents.

Commit 5 of 9. Link in the comments.
