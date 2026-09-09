---
type: llm
criteria: |
  The response must distinguish two failure classes: request errors (not found, permission denied,
  bad URL, write conflict, timeout) abort the whole transaction, whereas a FIELD-VALIDATION failure
  does NOT abort — that operation writes nothing while the other operations still commit.
  It must therefore tell the caller to inspect every returned operation slot for an `errors` key
  rather than trusting an overall success.
  FAIL if it says the transaction is fully atomic, that any failure rolls everything back, or that a
  missing required field aborts the set.
---
"Transactions are atomic" is the intuitive answer and the wrong one for validation failures. An
integration that trusts it silently half-commits.
