# Agents

One file per role, resolved by the engine as `process/agents/<name>.md` (the names match
`process/workflow.yaml`). Each is a **persona + contract**: what it reads, what it writes,
and which BMAD tasks/templates to use.

**Seed the BMAD ones from upstream BMAD**, then adapt to your house style + standards.

| File | Role | Lane | Source |
|---|---|---|---|
| `analyst.md` | Analyst | product | BMAD |
| `pm.md` | Product Manager | product | BMAD |
| `po.md` | Product Owner | product | BMAD |
| `ux-expert.md` | UX Expert | product | BMAD |
| `architect.md` | Architect | developer | BMAD |
| `sm.md` | Scrum Master | bridge | BMAD |
| `dev.md` | Developer | developer | BMAD |
| `qa.md` | QA / Test Architect | developer | BMAD |
| `code-review.md` | Code reviewer | developer | project-specific |
| `release.md` | Release | developer | project-specific |
| `deploy.md` | Deployment | developer | project-specific |
| `prod-verify.md` | Production verification | developer | project-specific |
