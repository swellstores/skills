# Eval suite

Behavioral tests for the `swell` plugin's three skills, run with `claude plugin eval`.

```bash
claude plugin eval .                 # whole suite against this plugin
claude plugin eval . --tag routing   # just the trigger tests (cheapest)
claude plugin eval . --case 'writes-*'
claude plugin eval . --runs 5 --threshold 0.8
```

`claude plugin eval` is currently in **early access**. Until it is enabled, run the same suite with
the local runner, which drives plain `claude -p` and applies the same graders:

```bash
npm run eval:list                                  # list what would run, no cost
npm run eval:routing -- --runs 1 --model sonnet    # trigger accuracy only
npm run eval:regression -- --arms both             # add a no-plugin baseline
npm run eval -- --case 'writes-*' --runs 1         # one case
```

Everything after `--` is passed to the runner (`node evals/run-local.mjs`), so any flag below works
with any script.

It loads the plugin with `--plugin-dir`, reads the agent's tool calls from `--output-format
stream-json`, scores `tool_used` and `regex` graders locally, and sends `llm` graders to a judge
model (`--judge-model`, default haiku). Results land in `evals/results/` and the exit code is 1 if
any case falls below `--threshold`. Cost is printed per run — budget roughly $0.10–0.25 per case
per arm on Sonnet.

Two caveats it cannot fix for you:

- **Uninstall other Swell plugins before trusting a baseline.** A globally installed plugin still
  loads without `--plugin-dir`, so its skills fire in the "without" arm. The runner detects this and
  warns, but the delta stays meaningless until you run `/plugin uninstall swell-app@swell`.
- **Pin `--model`.** `claude -p` defaults to a small model that often answers from memory without
  invoking a skill at all, which reads as a routing failure that says nothing about the skill.

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
