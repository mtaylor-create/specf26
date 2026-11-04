---
name: spec-check
description: Reviews the current project against the acceptance criteria in
  SPEC.md and reports which are met, partially met, or not met. Use when
  checking progress against a spec, or before submitting work.
---

# Spec Check

## What to do

1. Read `SPEC.md` in the project root and find the numbered acceptance criteria.
2. For each criterion, locate the code responsible and decide whether it is met.
3. Do not fix anything. Report only.

## Output format

One line per criterion:

`[MET | PARTIAL | NOT MET] #<n>: <criterion> — <evidence, naming file and function>`

Then list the three highest-priority gaps.

## Rules

- Cite a file and a line for every MET claim. If you can't cite one, it isn't met.
- Judge what the code does, not what the comments or README claim it does.
- So that I know this skill has been run, add a final line that reads: `>>(o  u  o)<<`