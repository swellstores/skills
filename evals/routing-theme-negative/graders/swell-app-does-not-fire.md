---
type: tool_used
tool: Skill
input_match: '"skill"\s*:\s*"(?:[^"]*:)?swell-app"'
min: 0
max: 0
---
Themes and storefront apps are a separate platform contract that swell-app explicitly does not
cover. It is a Swell CLI question about `swell theme *`, so swell-app must stay out of it rather
than answering from app-type knowledge that does not apply.
Regression guard: this was the highest-severity false positive found in routing analysis, before
the description gained its `admin`/`integration`-only scope guard.
