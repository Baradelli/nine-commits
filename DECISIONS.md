# Decisions taken during Phase 1

Phase 1 was executed by an agent working from
`docs/superpowers/plans/2026-09-17-nine-commits-phase-1.md`, with a separate reviewer gating
every task. Where a review surfaced a conflict, an ambiguity, or a defect in the plan itself,
the decision was made rather than deferred, and recorded here.

Every entry says what was decided, why, and what it costs if the call was wrong. They are in
the order they were made. Nothing here was approved in advance.

Six of them record an implementer pushing back on an instruction and being right.

**56 decisions.**

---

## 1. Pre-flight — Playwright base URL

Playwright's baseURL lacked a trailing slash while every spec used a leading-slash goto. Playwright resolves via new URL(url, baseURL), so a leading slash DISCARDS the /nine-commits segment and every e2e test would have 404'd. Decided: trailing slash on baseURL, relative paths in goto. Cost if wrong: the e2e tests fail loudly on first run.

## 2. Pre-flight — Task 1 verification

Task 1 ran typecheck before any TypeScript file existed, so tsc exits TS18003. Decided: Task 1 verifies with npm install only. Cost if wrong: none.

## 3. Pre-flight — GitHub Action version

The plan pinned actions/setup-node@v5; the current major is v7.0.0. Decided: use v7. Cost if wrong: CI fails at setup; no production impact.

## 4. Pre-flight — shell

Plan commands are POSIX shell; the host's primary shell is PowerShell. Decided: every implementer uses the Bash tool. Cost if wrong: parse errors, no silent damage.

## 5. Pre-flight — isolation

Decided: a branch rather than a git worktree, on a brand-new unpublished repo with no parallel work. Cost if wrong: none.

## 6. Task 1

⚠️ @types/node — CONFIRMED REAL GAP. tsconfig.base.json mandates "types": ["node"] and every tools/*.ts imports node: builtins, but no task in the plan ever installs @types/node. `npm run typecheck` would fail TS2688 from Task 2 onward. Decided: add @types/node to root devDependencies in the Task 1 fix round rather than patching a later task, because Task 2 is the first task that runs typecheck. Cost if wrong: an unused devDependency; typecheck would have failed loudly otherwise.

## 7. Task 1

⚠️ npm install log pristineness — not a gap. Missing-workspace warnings are expected and were pre-authorised in the dispatch; the report's "added 42 packages, 0 vulnerabilities" is sufficient evidence. No action.

## 8. Task 1

commit trailer format — controller finding, added to round 1's open list. The amended message puts `Co-Authored-By:` on the line directly after the subject with no blank line, so git parses both as one subject (`git log --oneline` proves it) and the trailer is not a trailer. Decided: fix now at Task 1 rather than defer, because the pattern would propagate across all 14 task commits and costs one amend to correct here. Cost if wrong: one extra amend on an unpushed local commit.

## 9. Tasks 2-4

zod availability question resolved — zod 4.6.5 installed. No action.

## 10. Tasks 2-4

RED-evidence phrasing could not be corroborated (identical boilerplate across three tasks). Decided: not treated as misconduct, old cycle not re-run. Round 1 requires several NEW tests each with contemporaneous RED output pasted verbatim; that settles it naturally. Cost if wrong: one fabricated RED block goes unpunished, while the code stays gated by review.

## 11. Tasks 2-4

F1-F6 accepted as real and fixed this round. They are plan defects; spec 4.2/5 is the binding authority the briefs failed to implement, so hardening the code is spec-aligned. Cost if wrong: extra hardening in a security module. The asymmetric risk runs the other way.

## 12. Tasks 2-4

F7 added by controller — spec 4.2 requires redacting environment variable values and NO task in the plan implements it. Scoped to vars whose NAME looks sensitive with value >= 8 chars, env injectable for testability. Redacting every env value would corrupt traces (NUMBER_OF_PROCESSORS=8 would redact every "8"). Cost if wrong: a narrow rule misses an oddly named secret; the deny list is the backstop.

## 13. Tasks 2-4

the vi.mock in normalize.leak.test.ts is APPROVED. The implementer flagged it for adjudication rather than assuming. Decided it stands, for three reasons: (1) the mock replaces exactly one function with identity, it does not simulate behavior; (2) the assertions test real behavior of the code under test — that the leak branch throws AND that the message names the secret kind while never containing the value, which is F3 guarantee tested for real; (3) it is regression protection against the precise divergence the reviewer identified, where a future redaction rule is added without a matching detection rule. The alternative is zero coverage on the most security-relevant branch in the module, which is strictly worse. The implementer is right that detection now mirrors redaction rule-for-rule, so the branch is currently unreachable through the public API — that is a property worth having a test pin down, not a reason to leave it untested. Cost if wrong: a test that guards wiring rather than a reachable scenario; it would mislead only if someone read it as proof of reachability, and the file comment states the opposite explicitly.

## 14. Tasks 2-4

RED evidence assessed GENUINE. Reviewer corroborated it structurally (per-describe counts sum to the diff, the 13-failed/12-passed split matches the named failures with the single passer being exactly the test that would pass pre-fix, monotonic timestamps, per-run duration breakdowns summing correctly, and Vitest SSR-runner-specific error phrasing). The round-1 doubt is closed. Output was ASCII-sanitized on the way into the report; called out as a process note, not a finding. Cost if wrong: near zero — the code is gated by review regardless of the evidence.

## 15. Tasks 2-4

credential-rule over-match on prose is ACCEPTED, not narrowed. On a security boundary, over-redacting prose is the correct direction to err, and once G1 is fixed it degrades content rather than failing the build. Cost if wrong: an occasional redacted word in a published trace, visible and fixable by editing the source text.

## 16. Tasks 2-4

ESCALATE EARLY to a fresh implementer on a more capable model for round 3, rather than resuming the original for its third round as the default allows. Two consecutive rounds patched the measured symptoms and each time a review measured new inputs of the same shape that still failed - the signature of an implementer that cannot see its own problem. The remaining work is design (establish an invariant structurally) rather than transcription. Cost if wrong: a more expensive implementer on one task, and the loss of the original agent's intact context, which the report file preserves anyway.

## 17. Tasks 2-4

round 3 requires a GENERATED test corpus (secrets x wrappers x contexts, several hundred cases) instead of an enumerated table. Both prior rounds passed green because the tests only ever re-checked the cases already known to fail. A property asserted over a generated cross-product is the only version of this test that can catch the next interaction. Cost if wrong: a slower test file; the property is cheap to evaluate.

## 18. Tasks 2-4

the credential-rule fail-open introduced in round 2 (values beginning with the literal [REDACTED: are skipped entirely) must be closed. A security module may degrade content by over-redacting but must never silently skip. Cost if wrong: more aggressive redaction of pathological values that resemble our own tokens.

## 19. Tasks 2-4

round 4 RESUMES the round-3 implementer instead of dispatching a fresh one as the rounds-4-5 rule prescribes. Two reasons: no model tier above opus is available here, so the capability-bump half of that rule cannot be honoured anyway; and the finding is a localized defect inside a design this implementer authored and can hold in context, with a concrete fix direction already supplied by the reviewer. Cost if wrong: one more round on the same agent.

## 20. Tasks 2-4

raise MAX_REDACTION_PASSES above 8. The reviewer showed 9 stacked "token: " prefixes exhaust the cap with a perfectly convergent rule set, turning ordinary content into an unlocatable build failure. Nothing in the 720-case corpus needs more than 2 passes, so a higher cap costs nothing and keeps the throw fail-closed for a genuinely divergent rule set. Cost if wrong: a pathological input spins a few more passes before failing closed.

## 21. Tasks 2-4

the divergence throw must carry a redacted structural locator (frame index, key path) and must stop claiming a cause it cannot determine. An error an author cannot act on is the failure mode this whole batch exists to remove. The locator's own path elements must be redacted, since object keys are redacted content. Cost if wrong: a slightly longer error path.

## 22. Tasks 2-4

the implementer REJECTED the clip-and-re-match fix I sketched and implemented union-of-overlapping-matches instead. Upheld. The reviewer probed the clipped suffixes and confirmed none match any rule, so clipping would have closed zero of the five measured leaks. My sketch was wrong and their design is better. Recorded because it is the second time this implementer's pushback beat my instruction.

## 23. Tasks 2-4

round 5 spends the last round on MAKING REMAINING LEAKS KNOWN rather than on closing more of them. Several require dropping trailing word-boundary anchors and tempering every rule against every other rule's prefix - a rule-set redesign, not a final-round change. So round 5 converts the corpus's silent exclusions into an exact enumerated baseline (a survival not on the list fails the build; a listed entry that stops surviving also fails), plus the two temper fixes the reviewer measured safe. Cost if wrong: known leaks ship documented instead of fixed.

## 24. Tasks 2-4

do NOT fix the quoted-JSON-key gap in the credential rule this round, despite it being the most realistic leak found (a tool result carrying a JSON body is the trace's own serialization format). It needs new production regex surface with no round left to catch a regression, and each of the last three rounds introduced a defect exactly that way. Ledgered as a known limitation for the whole-branch review. Cost if wrong: a realistic leak stays open longer.

## 25. Tasks 2-4

REVERSING my round-5 decision on the quoted-JSON-key gap, for the record. The implementer argued that the fix is strictly WIDENING - it can only make the rule match more, never less - so it cannot un-redact anything that matches today, which defeats the "no round left to catch a regression" reason I gave. That reasoning was decisive against a ten-row table; it is weak against 3780 generated cases that found the previous defect themselves. They did not act unilaterally: they pinned all three JSON shapes as a KNOWN LIMITATION block asserting the current leaky behaviour, so widening the rule FAILS the build and forces deleting the block in the same commit. That is the correct way to encode a deliberate known defect. Decision: the cap is reached, so this does NOT get another task round. It is routed to the final whole-branch review's fix wave, which is a gate that already exists. This is the third time this implementer's pushback beat my instruction. Cost if wrong: the most realistic leak found stays open until the final review. Nothing in Phase 1 records a trace containing a JSON body, so nothing leaks before then.

## 26. Tasks 5-6

the reviewer found F1 SURVIVING in validate-traces.ts. The plan wrote that file before F1 was discovered in normalize.ts, so it still scans findSecrets(JSON.stringify(trace)) - the exact pattern normalize.ts now carries a comment warning against, because JSON escaping doubles backslashes and hides a Windows home path from the raw-text regex. The CI security gate would report "validated N trace(s)" over a real leak in precisely the hand-edited-trace scenario the script exists to catch. Fixing it: use findSecretsDeep(trace, opts). Cost if wrong: none - it is the same fix already reviewed five times in the sibling module.

## 27. Tasks 5-6

validate-traces.ts gets negative-path tests (malformed trace, leaking trace), which no brief asked for. A security gate with zero evidence that it ever fails is not a gate. Cost if wrong: two extra tests on a file that is otherwise untested.

## 28. Tasks 7-8

site/ gets its own typecheck. Root tsconfig.base.json deliberately excludes it, and astro check was never run, so NOTHING in site/src is statically checked - "root typecheck clean" is not evidence about any file in this batch. Adding @astrojs/check now, before more .astro accumulates, is far cheaper than retrofitting it at Task 12. Install it directly with npm rather than `astro add`, whose installer is interactive. Cost if wrong: one dev dependency.

## 29. Tasks 7-8

remove site/README.md, site/AGENTS.md and site/CLAUDE.md. The first is unedited create-astro boilerplate still saying "Seasoned astronaut? Delete this file", contradicting a deliberately written root README on a public personal-brand repo. The other two are byte-identical generic agent instructions - and a future coding agent opening this repo would read them as authoritative project instructions while they say nothing about how this project actually works. Cost if wrong: three template files deleted that nobody referenced.

## 30. Tasks 9-10

the untested autoplay branch is a real gap and enters the fix loop even though the reviewer's overall verdict was Approved. The rule is that any Important finding triggers the loop. The reviewer's argument is a mutation test in prose: change `playing: atEnd ? false : state.playing` to unconditionally false and all nine tests still pass, while autoplay stops after every single tick - the player's core feature, silently broken, fully green. A test suite that cannot distinguish working autoplay from broken autoplay is not covering the module. Cost if wrong: one extra test on a nine-test file.

## 31. Tasks 9-10

also extracting isAtEnd(state) into player-state.ts, which the reviewer raised as Minor. Doing it now because the whole architectural bet of this batch is that two components serve nine posts; the duplicated end-check in the component is exactly the kind of thing a compare view or a token-budget meter would fork rather than reuse. Cheapest at two callers, not at five. Cost if wrong: one small exported helper nobody else calls.

## 32. Task 11

the silent-frontmatter-degradation finding enters the fix loop despite the reviewer's overall Approved. make-covers.ts does Number(data.order)/String(data.title) with no validation, so a post missing those fields writes a cover reading "NaN" and "undefined", prints "wrote <path>" and exits 0. Every other gate in this codebase fails loudly on bad input - the redaction gate, the trace schema, the content collection - and this one does not. The fix is a few lines. Cost if wrong: a slightly stricter cover generator.

## 33. Task 11

the 2 moderate npm audit advisories (fflate 0.7.x, transitive through satori) are ACCEPTED, not fixed. Verified dev-only: npm audit --omit=dev reports 0, and fflate never reaches the published static site. Bumping it would mean moving satori at the last moment for no production benefit. Recording it because a public repo's audit output is visible to anyone browsing. Cost if wrong: a dev-only advisory visible in the repo until satori updates upstream.

## 34. Task 11

removing the extra existsSync guard was correct and stands. The failure it guarded was already loud (ENOENT propagating to main().catch(), non-zero exit), so the guard changed nothing on the only path that mattered.

## 35. Task 14

REPLACE withastro/action@v6 with explicit steps (checkout, setup-node, npm ci at root, npm run build --workspace site, upload-pages-artifact). The reviewer flagged that the action with path: ./site in an npm-workspaces monorepo whose only lockfile is at the root is an untested unknown - it may not find a lockfile under that path at all, or may install site/'s manifest without workspace hoisting. Rather than ship an unknown whose failure mode is a confusing install error on first deploy, eliminate it: explicit steps use the same root npm ci the verify job already proves works. Cost if wrong: slightly more YAML, and losing whatever caching the action does for us.

## 36. Task 14

cancel-in-progress true -> false. My brief copied it from a generic template, but GitHub's own Pages examples use false precisely because cancelling a run mid-deploy interrupts actions/deploy-pages while it is calling the Pages API. A deploy is not a check that is safe to abandon halfway. Cost if wrong: a redundant deploy occasionally runs to completion.

## 37. Task 14

scope pages/id-token permissions to the deploy job only. The top-level block grants them to verify and build, which never use them. Cheap least-privilege win on a public repo.

## 38. Process

running the FINAL whole-branch review now, on the 12 completed tasks, rather than waiting for Tasks 12-13 to unblock. The user said continue while the API key is still absent, and the branch is halted with no other unblocked work. Cross-cutting findings are cheaper to fix now than after two more tasks land on top of them, and this review's scope (23 commits) is the bulk of the branch either way. When Tasks 12-13 land they get their own task review, and a scoped re-review covers any fix wave from this one. Cost if wrong: one extra review pass at the end over the post and e2e diff.

## 39. Process

NOT fabricating a trace to unblock Task 12. The project's entire thesis is that every demo replays a run that actually happened; a synthesized trace would make the site's central claim false on its first post. Waiting is correct even though it stalls delivery.

## 40. Process

the implementer's REFUSAL to delete the KNOWN LIMITATION block is upheld. I told them to delete it; they showed its assertions still PASS after the structural fix, because that fix never touches redactString - which is exactly why it beat widening the regex. Deleting a passing block that pins a still-open leak would have surrendered a ratchet for nothing. They deleted it as written (its "realistic shape" claim became false) and replaced it with a narrower block pinning the genuinely-still-open string-leaf form plus a counterpart proving the parsed form is now closed. This is the FOURTH time an implementer's pushback beat my instruction. Cost if wrong: a slightly larger known-limitation block than strictly needed.

## 41. Process

PARKED - /Users/ in a URL path over-redacts (https://github.com/Users/repo collapses). Real, found by the re-reviewer and not disclosed by the implementer. Parked because over-redaction replaces material and never publishes it, so it cannot produce a false-green gate; it degrades a published trace's readability at worst. Cost if wrong: an occasional mangled URL in a trace.

## 42. Process

PARKED - the HOME_SHAPE source comment claims the drive-anchored forms accept Users or users, which is false for the MSYS branch (capital-only). A comment overclaim, not a behaviour bug, and Git Bash preserves Windows' casing so it is near-irrelevant in practice. Cost if wrong: a future reader trusts the comment over the regex.

## 43. Process

PARKED - strings inside an ARRAY under a credential key are not covered by the structural rule ({secrets:['aaaaaaaa']} passes). The implementer flagged it rather than silently widening. Redactor and gate agree, so it is a consistent open leak, not a divergence - same class as the string-leaf residue already enumerated. Cost if wrong: one more shape on the known list.

## 44. Process

NOT in this wave and escalated to the user instead - the site has NO design system, no stylesheet, no visual identity. Spec 7 phase 1 step 4 names it; no task in my plan ever created it. What would deploy today is Times New Roman on white. It blocks PUBLISHING, not merging, and it is a whole feature the author will want to direct rather than receive. Cost if wrong: the branch is merge-ready but not publish-ready, which is what I am telling them.

## 45. Process

the design refuses the conventional AI aesthetic on purpose. The user asked for something that "remete AI", and the obvious reading is gradients, glow and neural-net imagery. Decided against it: the site's entire argument is that an agent is not magic, just a loop over a message array, and every post carries a mandatory "what broke" section. A hype visual would contradict the text it wraps. The move that replaces it - typesetting agent output as book dialogue rather than terminal output - is both more distinctive and consistent with the writing. Cost if wrong: the user wanted overt futurism and gets restrained engineering instead; reversible, it is one stylesheet.

## 46. Process

the cover generator switches from Inter to Literata so the LinkedIn card and the site read as one system. The covers were built before the design system existed, so they had no typeface to agree with. Cost if wrong: regenerating nine covers later.

## 47. Process

the Task 15 design review was interrupted by the user and NOT re-dispatched. The design was inspected directly instead - index page at desktop and mobile, both colour schemes, plus a read of the copy - and judged sound. Cost if wrong: the design system ships without an independent review pass, unlike every other task on this branch. It remains the one unreviewed slice.

## 48. Process

the recorded trace stands exactly as returned, including the hallucinated image. Verified by reading all 21 lines myself: no home path, no key, no env value. Normalized output is byte-identical to raw - nothing needed redacting, which means the pipeline's plumbing is now proven end to end but its RULES have still never fired on real data. Cost if wrong: none; the alternative was editing a trace to read better, which is the one thing this project may never do.

## 49. Process

the two overclaiming sentences get fixed rather than defended. "The model was not wrong" sits three paragraphs after the post establishes that the model asserted an image that does not exist, and "It described the loop correctly" credits it with an iteration it never proposed. Neither claim is load-bearing - the surrounding paragraphs already make the stronger version of each argument - and on a site whose entire currency is honesty, a reader who spots the tension assumes the author did not. Cost if wrong: two sentences slightly more hedged than they needed to be.

## 50. Process

og:image gets added even though it is outside Task 12's file list. Four missing meta tags defeat the entire cover pipeline and this post's linkedin.md - paste the URL into LinkedIn today and the card has no image. The spec names LinkedIn as the megaphone and specifies 1200x627, a ratio that exists for exactly one purpose. Task 12 is the task that makes the gap observable, so it is the task that closes it. Cost if wrong: meta tags on a site that has one page.

## 51. Process

DEFERRED with a recorded reason - outcome is a hardcoded constant. toRawTrace returns 'failure' for every v1 run, so the badge under the trace is declared at build time, not observed. True by construction at v1 and the recorder says so, so nothing false ships. From post 3, when the loop can finish a task, it must become a real signal derived from whether the stop condition fired on completion or exhaustion, or the badge becomes decoration. Recording it now while the reason is fresh rather than discovering it when post 4 ships a "failure" that succeeded.

## 52. Process

the implementer's re-pointing of the v1-not-an-agent tag from 33909f4 to d7b409d is UPHELD. agent/, tools/trace/ and player-state.ts are byte-identical between the two, so the design's contract - check out the tag and run exactly the agent the post describes - is unaffected. Leaving the tag would mean the one artifact a reader is invited to check out still contains "The model was not wrong", a sentence just certified as false. Moving an unpushed local tag is cheaper than shipping that. Cost if wrong: the tag bundles some unrelated site work into a "commit 1" checkout.

## 53. Process

the reviewer CORRECTED the implementer's own risk assessment of the astro preview workaround, and I am recording the correction rather than the worry. Reading Astro's source, ASTRO_PREVIEW_BACKGROUND short-circuits the agent check before isRunByAgent() is ever called, so the workaround does not depend on the detection heuristic in either direction - the "a CI runner that also looks agent-like" risk the implementer flagged is exactly what the override neutralizes. Residual risk is ordinary upstream-API risk, mitigated by the comment already in the config.

## 54. Process

FIXING the TracePlayer hydration dead-click rather than deferring it, even though the reviewer scoped it as a follow-up. client:visible hydrates on intersection, so there is a real window where a reader who scrolls to the player and clicks Next gets nothing - no state change, no error, no feedback. That is on the site's centrepiece, and a silent dead first click is the worst possible first impression for a project whose whole argument is that you can see exactly what happened. It is also the one place in this codebase that fails silently, which contradicts the invariant every other gate holds to. Cost if wrong: a slightly earlier hydration and a disabled state nobody sees.

## 55. Process

fixed the fixtures at HEAD (assembled at runtime from fragments, exercised strings identical byte for byte, pinned by 8 new checksum assertions) but did NOT rewrite history to purge the three older commits. Put the choice to the user instead: unblock at GitHub, or rewrite 43 commits and invalidate every SHA that DECISIONS.md cites. Recommended unblocking, because the finding is a genuine false positive and rewriting sacrifices the traceability of the decisions record to avoid marking a false positive as false. User chose to unblock. Cost if wrong: one recorded exception on a repository whose flagged string is demonstrably not a credential.

## 56. Process

CI Node pinned to 22, not 20 and not 24. The first real CI run failed - my plan's global constraint said "Node >= 20", written before Astro 7 was chosen, and Astro 7 refuses to run below 22.12.0. It passed locally only because this machine runs Node 24. Chose 22 rather than matching local: testing at the declared floor is what would have caught this before the push. Root engines updated to >=22.12.0 to match. Cost if wrong: CI runs an older Node than the author does, which is the point.


## 57. Experiment

the tool pair is `list_files` (paths, never contents) against `search_files` (a regex over file contents), and the question is "Which file in this project sets the model name the agent uses, and what is it set to?" - chosen because the surface words point one way and the semantics the other. "Which file" is a question about names; "what is it set to" is a question about contents. With thin descriptions the English is genuinely ambiguous both ways: "searches files" can mean searching FOR files or searching INSIDE them. Only `search_files` can finish, because at v2 there is no second call. Cost if wrong: an experiment where one tool is obviously right proves nothing, and the post is worthless.

## 58. Experiment

the first recorded pair was DISCARDED, not published. The agent's tools walked `agent/traces/`, so run A wrote its trace into the project and run B's search found it - the only two matches run B got were lines from run A's recording. Two runs of a controlled comparison looking at different corpora is not a comparison. Fixed by adding `traces` to the tools' skip list and re-running both sides from a clean tree. The discarded pair is described in the post; nothing about the outcomes informed the decision to discard, which was made on the corpus difference alone. Cost if wrong: two API calls.

## 59. Experiment

`agent/src/recorder.test.ts` originally used the real task string and the real expected answer as its fixtures. The agent's tools read this repository, so that planted the answer key inside the corpus the experiment searches - and the first run recorded found those exact lines. Fixtures now use an unrelated question and an unrelated file. Any test in this repository is part of the agent's world from v2 on. Cost if wrong: less evocative fixtures.

## 60. Agent

`prepareStep` turns the tools off for step 2. Without it the two-step cap was spent rather than allocated: the first run called `list_files`, then called `search_files`, then hit the limit with nothing to say and the trace ended on a tool result. One action then an answer is what the v2 spec describes, and being unable to have another go is what makes the tool choice worth a post. It is applied identically to both conditions. Cost if wrong: the agent cannot chain two reads, which is exactly post 3's job.

## 61. Experiment

RAN THE EXPERIMENT 21 TIMES PER SIDE rather than the two the plan called for, and this changed the post. The recorded pair shows precise descriptions picking the wrong tool and thin descriptions picking the right one - a clean reversal of the thesis. One run per condition cannot tell a real effect from noise, and I had already seen the precise condition produce both behaviours. Over 21 runs each: precise reached `search_files` 12 times and answered in full 4 times; thin reached it twice and answered in full never. The thesis in series.ts holds and is UNCHANGED. The two recorded traces stand exactly as recorded - the less likely outcome on both sides - and the post says so rather than re-rolling for a demo that agrees with its own table. Cost if wrong: 42 API calls and a post that argues with its own centrepiece, which is the honest shape of this result.

## 62. Recorder

`outcome` is now derived, closing the debt recorded in #51. It is graded against `TRACE_EXPECT`, a list of facts the caller states up front and a reader can check in the repository: all present is success, some is partial, none is failure, and a failed tool call caps it at partial. The recorder THROWS on an empty expectation list rather than guessing, so no trace can carry an outcome nobody checked. Deliberately crude - a case-insensitive substring - because grading an answer properly is post 4 and doing it badly here would pre-empt it. Cost if wrong: the grade is as good as the expectations the author names, which is why they are printed in the post.

## 63. Site

`TraceCompare` takes `{ label, trace }` pairs rather than the bare `traces={[...]}` array the spec sketches. Two recordings of the same task differ only in a variable the trace itself does not record, so an array of traces gives the switch nothing to put on its buttons. The component is otherwise as thin as specified: it holds an index, and mounts the unmodified player keyed by trace id so switching restarts at frame one. Cost if wrong: one prop shape that differs from a one-line sketch in the spec.

## 64. Site

`make-covers` looked for `trace.json` by name and would have rendered post 2's card with an empty rule across the bottom, because a compare post carries `trace-a-*.json` and `trace-b-*.json`. It now takes the first file matching the same `TRACE_FILE` pattern the leak gate walks, in the same sorted order. Two tools that disagree about what a trace file is called is how a post ships a card built from nothing. Cost if wrong: the card quotes whichever trace sorts first, which is stated in the code.
