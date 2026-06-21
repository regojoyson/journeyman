---
id: STORY-<epic-slug>-<n>
title: <human title>
epic: EPIC-<slug>
jiraKey: null        # written back once, on first mirror to Jira — do not hand-edit
repos: []            # code repos this story touches (short names) → engine clones these
points: null         # set during Solution sizing
lane: developer
status: null         # READ-ONLY echo of Jira status — change status in Jira, not here
created: YYYY-MM-DD
---

# <Story title>

## User story

As a <role>, I want <capability>, so that <benefit>.

## Acceptance criteria

- [ ] <criterion>
- [ ] <criterion>

## Technical notes

<implementation hints, links to epic architecture, affected files>

## Definition of Done

- [ ] Code + tests merged in all `repos`
- [ ] Code review passed
- [ ] QA / quality gate passed
- [ ] Docs updated
