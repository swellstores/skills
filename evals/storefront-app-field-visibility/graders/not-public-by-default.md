---
type: llm
criteria: |
  The response must state that the field being absent is expected rather than a bug: a storefront
  does not receive app extension fields (`$app` paths) on standard models through the Frontend API
  with the store's public key.
  It must name at least one real way to expose the data: moving it to an app-defined collection
  with public permissions, or serving it through an app route function. Extending the public key
  record's custom field permissions may be named as well.
  FAIL if it claims the field should already be returned, tells the user to add `expand`, suggests
  only marking the field `"public": true` on the model as sufficient, or invents an API for it.
---
The skills previously said extension fields "appear automatically" — true on the backend, false for
storefront callers. This breaks the flagship product-reviews use case.
