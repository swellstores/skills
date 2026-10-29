---
type: llm
criteria: |
  The response must state that the field is absent because the app has not marked it public: an
  app's field on a standard model reaches a storefront only when the app's model declares it
  `"public": true` (in the app's `models/products.json`), and after a push any storefront key,
  the store's own included, gets it as `$app.<app_id>.average_rating`.
  Credit, but do not require, naming an app route function or an app collection for data that
  needs logic or permissions beyond a public field.
  FAIL if it says a store's key can never read app fields on standard models, tells the user to
  add `expand`, or invents an API for it.
---
A storefront reads an app's field on a standard model once the app marks it public, on any key.
A model that misses this tells the user to move the data or build a route for something one
flag does.
