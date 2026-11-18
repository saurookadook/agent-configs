---
name: plan-and-grill-gh-card
description: Write an implementation plan for one GitHub issue, then grill the plan and settle its open decisions. Takes the issue as the first argument.
disable-model-invocation: true
---

# Plan and grill a GitHub card

`/plan-and-grill-gh-card <card>`, for example `/plan-and-grill-gh-card acme/widgets#412`.

Two phases: write the plan with the `plan-gh-card` procedure, then grill it. You settle every question the evidence answers. The user settles only the judgment calls.

## Step 1: take the card argument

The card is the first argument. Accept either form, and take the owner, repo, and number out of it:

- `acme/widgets#412`
- an issue URL, such as `https://github.com/acme/widgets/issues/412`

An issue number is unique only within its repo, so a bare `412` or `#412` is not enough. If there is no argument, or the argument does not name both a repo and a number, tell the user to run `/plan-and-grill-gh-card <owner/repo#number>` or pass an issue URL, and stop. The argument is the only source of the card: the working directory, the branch name, and the conversation are not.

Done when: you hold owner, repo, and number as literals, and the number is bare digits.

## Step 2: write the plan

Read `~/.claude/skills/plan-gh-card/SKILL.md` and run its Steps 2 to 6. They check the credential, fetch the card tree and its comments, ground every acceptance criterion in the repo, and write the plan file. This skill replaces its Step 1 (arguments) and Step 7 (hand back).

Its gates hold: a pull request number, a transferred issue, or a `CLOSED` card stops this skill before grilling.

Done when: the completion criterion of `plan-gh-card` Step 6 is met.

## Step 3: grill the plan

Invoke the `grilling` skill with the plan file as its subject. Seed its design tree from the plan: every item in Open questions, every decision the plan guessed, every step whose approach has a live alternative, and every Out of scope line the card could be read to include.

Run grilling's rounds with one change: sort each frontier question before you ask it.

- **Settled by evidence**: the card tree, its comments, the code, a component `CLAUDE.md` or contract file, a repo convention, or an earlier decision in this session fixes the answer. Settle it yourself, and record the answer with its source: `path:line`, a card number, or the earlier decision. Fact-finding goes to a sub-agent, as grilling already says.
- **Judgment call**: two or more answers stay viable once the evidence is in, or the answer changes scope, behavior a user can see, a public contract, or the size of the work. Put it to the user.

A question you cannot sort with confidence is a judgment call.

Each round, first list the questions you settled this round, one line each with the answer and its source, so the user can overturn any of them. Then ask the round's judgment calls with `AskUserQuestion`:

- One question per judgment call, with 2 to 4 options.
- The recommended option goes first, with "(Recommended)" at the end of its label.
- Each option's description says what choosing it changes in the plan.
- Each question names the card number and the plan step it affects, because the user may see only the question dialog.
- The tool takes at most 4 questions per call. A round with more judgment calls uses more calls.

A round with no judgment calls reports its settled questions and moves straight to the next round.

Grilling's end rule holds. When the frontier is empty, list every decision with its answer and source, and ask the user to confirm the shared understanding. A decision the user reopens goes back on the frontier.

Done when: every branch of the design tree has an answer and a source (evidence, or "user"), and the user has confirmed the list.

## Step 4: fold the decisions into the plan

Edit the plan file:

- Add a **Decisions** section between Acceptance criteria and Open questions: a table with one row per settled question, holding the question, the answer, and the source.
- Rewrite every step that a decision changed, and every Out of scope line that a decision moved.
- Remove from Open questions everything that grilling settled. Keep only what the user deferred, and write "None" if nothing remains.

Done when: no item left in Open questions has a row in Decisions, every acceptance criterion still maps to a step, and every child task still maps to a step.

## Step 5: hand back

Report in the chat: the plan's path, the step count, the number of decisions settled by evidence, the number settled by the user, and every deferred question. Then stop.

The plan file is the only change this skill makes. The branch, the commits, and the code stay as they are.
