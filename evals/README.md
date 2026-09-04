# Eval suite

Behavioral tests for the `swell` plugin's three skills, run with `claude plugin eval`.

```bash
claude plugin eval .                 # whole suite against this plugin
claude plugin eval . --tag routing   # just the trigger tests (cheapest)
claude plugin eval . --case 'writes-*'
claude plugin eval . --runs 5 --threshold 0.8
```

`claude plugin eval` is currently in **early access**; without it enabled the command exits with
`` `plugin eval` is currently in early access `` and these files are inert. Nothing here depends on
that gate being open — the cases are plain YAML/Markdown.

By default the runner adds a **no-plugin baseline arm** and reports the score delta, which is the
number that matters: it shows what the skills add over the model's own knowledge of Swell. Every
regression case below is written so the baseline plausibly fails it — these are the specific things
a model gets wrong about Swell when nobody tells it otherwise.

## What is tested

**Routing** (`--tag routing`) — does the right skill fire, and stay quiet when it shouldn't?
Trigger descriptions are the only routing surface, so these guard against both misses and
false positives.

| case | asserts |
|---|---|
| `routing-app-hook` | app-function debugging fires `swell-app` |
| `routing-backend-import` | a swell-node import script fires `swell-backend` |
| `routing-storefront-cart` | swell-js cart work fires `swell-storefront` |
| `routing-cli-api-call` | `swell api` routes to `swell-backend`, not `swell-app` |
| `routing-theme-negative` | a Proxima **theme** question does NOT fire `swell-app` |
| `routing-other-platform-negative` | a Shopify question mentioning Swell fires no Swell skill |

**Regression** (`--tag regression`) — the corrections from the source-verification pass, written as
assertions. Each one is a mistake an agent makes without the skill:

| case | the trap |
|---|---|
| `writes-array-merge` | a plain array PUT merges *positionally*; it does not replace or append |
| `transaction-atomicity` | validation failures do **not** roll a transaction back |
| `storefront-app-field-visibility` | `$app` fields are not readable from the Frontend API by default |
| `cli-environment-safety` | `swell api` writes to **test** unless `--live` is passed |
| `product-import-stock-tracking` | `stock_tracking` must be set or stock never decrements |
| `webhook-not-firing` | `enabled` defaults to false; there is no payload signature |

## Conventions

- Skill assertions use `tool_used` against the `Skill` tool, matching the skill name with an
  optional plugin prefix (`(?:[^"]*:)?swell-app`) so they survive plugin/version renaming.
- A negative assertion is the same grader with `min: 0` and `max: 0`.
- `llm` graders carry the substance; a `regex` grader is added only where an exact token
  (`$set`, `--live`, `stock_tracking`) is genuinely load-bearing.

Not used here: the `with-only` grader marker mentioned in `claude plugin eval --help`. Its
frontmatter syntax isn't documented anywhere discoverable, so rather than guess a key that would
silently do nothing, skill-fired graders are left as ordinary graders. Under `--ablation
with-without` the runner already treats `tool_used: Skill` as a plugin-fired indicator.
