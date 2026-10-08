---
type: tool_used
tool: Skill
input_match: '"skill"\s*:\s*"(?:[^"]*:)?swell-app"'
min: 0
max: 0
---
An independently hosted storefront is not a Swell app: it has no `swell.json`, no app lifecycle and
no supplied runtime clients, so swell-app must stay out of it.
