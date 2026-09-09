---
type: llm
criteria: |
  The response must state that app extension fields on standard models are NOT exposed through the
  Frontend API by default — the storefront's public field allowlist does not include $app paths — so
  the field being absent is expected rather than a bug.
  It must name at least one real way to expose the data: extending the public key record's custom
  field permissions, moving the data to an app-defined collection with public_permissions, or
  serving it through an app route function.
  FAIL if it claims the field should already be returned, tells the user to add `expand`, suggests
  only marking the field `"public": true` on the model as sufficient, or invents an API for it.
---
The skills previously said extension fields "appear automatically" — true on the backend, false for
storefront callers. This breaks the flagship product-reviews use case.
