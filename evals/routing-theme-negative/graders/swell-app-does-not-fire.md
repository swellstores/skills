---
type: tool_used
tool: Skill
input_match: '"skill"\s*:\s*"(?:[^"]*:)?swell-app"'
min: 0
max: 0
---
Proxima / Liquid themes are a separate platform contract that swell-app explicitly does not cover.
It is a Swell CLI question about `swell theme *`, so swell-app must stay out of it rather than
answering from app-type knowledge that does not apply. Code-based storefront apps are covered by
swell-app; themes are not.
Regression guard: this was the highest-severity false positive found in routing analysis, before
the description gained its theme exclusion.
