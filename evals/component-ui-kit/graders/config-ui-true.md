---
type: llm
criteria: |
  The response must tell the user to build the component from the Swell UI kit's elements
  (`<swell-input>`, `<swell-button>` and the like, used by their tags) and to set `ui: true` in the
  component's `config`, so the platform loads the kit into the frame configured like the checkout.
  Credit, but do not require, typing the elements with `@swell/swell-ui/preact` as a dev dependency,
  and styling leftover markup with the kit's `--swell-*` CSS variables.
  FAIL if it tells the user to bundle the kit into the component (a value import of
  `@swell/swell-ui` or its React wrappers), or to copy the checkout's colors and fonts into the
  component's own CSS as the way to match it.
---
A payment component matches the checkout through the kit the platform loads with `ui: true`. A model
that does not know this hand-copies the checkout's styles, which drift from each merchant's look, or
imports the kit, which the build drops from the bundle.
