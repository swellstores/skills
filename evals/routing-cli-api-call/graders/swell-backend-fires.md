---
type: tool_used
tool: Skill
input_match: '"skill"\s*:\s*"(?:[^"]*:)?swell-backend"'
min: 1
---
`swell api` is a Backend API data-access command and belongs to swell-backend, not swell-app.
Regression guard: swell-app's trigger list previously claimed `swell api` and won this prompt.
