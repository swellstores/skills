---
type: tool_used
tool: Skill
input_match: '"skill"\s*:\s*"(?:[^"]*:)?swell-(app|backend|storefront)"'
min: 0
max: 0
---
A question about another platform that merely mentions Swell in passing must not load any Swell
skill. swell-backend has the broadest trigger surface (webhooks, retries, delivery) and is the most
likely false positive here.
