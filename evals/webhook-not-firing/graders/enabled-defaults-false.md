---
type: llm
criteria: |
  The response must lead with the fact that a webhook created through the API has `enabled` defaulting
  to FALSE, so it must be set explicitly (or flipped afterwards) or it never fires — this is the
  most likely cause given the symptom.
  Credit, but do not require, checking the subscribed event types: a misspelled or undeclared type is
  refused on write, but a declared type that records no event is stored and produces the same silence.
  FAIL if it invents a webhook signature/HMAC secret that must be configured, claims Swell verifies
  payload signatures, or attributes the silence purely to retries/backoff without checking enabled.
---
`enabled: false` on create is the single most common cause and is invisible — the webhook record
exists and looks correct. Swell has no payload signature, so a model that invents one sends the user
hunting for a setting that does not exist.
