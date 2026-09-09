---
type: llm
criteria: |
  The response must make clear that `swell api` targets the store's TEST environment by default and
  that `--live` is required to act on live data. The command it gives for a live change must include
  the --live flag.
  FAIL if it presents a bare `swell api put ...` as operating on live data, or does not mention the
  environment default at all.
---
Safety regression: the backend skill previously described `swell api` as equivalent to a live-key
script. An agent following that silently writes to the wrong environment while reporting success.
