---
type: llm
criteria: |
  Before building anything, the response must ask the user how closely the rebuild should follow the
  current site, offering at least the choice between recreating it closely (its layout, words,
  photos, logo and menus) and taking only its look and feel. Credit, but do not require, also
  offering to start from a Swell theme, asking whether to build in code or with Wave's own
  "Rebuild a website", and asking what data comes over and whether there is Shopify admin access.
  Saying that Wave's no-code rebuild changes one storefront rather than producing a reusable theme,
  or recommending the code route, is accurate and is not a failure.
  PASS when it asks the closeness question before building. FAIL only if it starts writing theme
  files or running commands without asking, or if it says that Wave or Swell can't reproduce the
  site's layout or design closely.
---
A user who isn't asked gets whatever level of copy the agent picks, and a simplified result reads as
a limit of Swell. Wave's own rebuild asks this question first; the skill must too.
