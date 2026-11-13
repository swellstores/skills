# App architecture discovery trials

Manual behavioral checks for the revised `swell-app` entrypoint. These complement the automated routing suite: they test choosing and composing resources after the skill is selected. They do not verify platform claims or deployed artifacts.

For each case, start a fresh agent with no review history. Give it the user request below and the path to `skills/swell-app/SKILL.md`. Permit read-only access to the three revised skill folders and let it choose references. Do not supply this file, the assessment criteria, planning notes, platform code, or previously installed copies of the skills. Ask for the architecture, references actually read, and unresolved questions. Do not allow scaffolding, live CLI calls, edits or deployment.

Judge decisions and reference selection, not matching phrases. Record the skill revision, outcome and any demonstrated gaps in the revision project's evidence notes. A pass here does not replace implementation and runtime verification.

## Wishlist

User request: "I want a wishlist in our Swell storefront app. Logged-in shoppers can add and remove products and see only their own wishlist. Merchants should be able to inspect wishlist records in the dashboard. Propose the smallest architecture and where the code and configuration belong. Stay read-only."

Assess: an app collection with customer ownership and content views for merchants; no custom frontend for merchant CRUD. Use declarative `scope: 'account'`, which requires a login for every call, a create included, and keeps each shopper to their own records. Keep the app's existing session helpers; identify the unresolved no-scope permissions case if applicable.

## Moderated reviews

User request: "Add product reviews to our Swell storefront app. Anyone can read approved reviews, logged-in shoppers can submit them, and staff can approve or reject them from the dashboard. Products need a visible average rating. Propose the architecture and the important access boundaries. Stay read-only."

Assess: an app collection with approved-only public reads; authenticated submissions that cannot set moderation or another customer's identity; content views and actions for moderation; storefront-readable rating data. Discover model, function, action and relevant API references. Expect `input.scope: 'account'` with a pinned approved-only query, and the rating as a public app field on products, which any storefront key reads. Do not assume the Backend client applies shopper ownership.

## Bulk merchant operation

User request: "Merchants need to select up to 10,000 orders matching dashboard filters and send them to our fulfillment provider. Processing may take minutes, should survive failures, and should show progress. A confirmation dialog is enough UI. Propose the app resources and execution flow. Stay read-only."

Assess: a bulk action starting a workflow, selected records paged across durable work, progress through workflow runs, and repeat-safe external effects. Recognize the action's user identity, app permissions, workflow client restrictions and payload limits. No custom dashboard frontend solely to trigger the work; do not invent undocumented workflow limits.

## Provider callback

User request: "Our Swell integration needs to receive delivery callbacks from a provider. It POSTs JSON with its fixed signature header to one callback URL we register with them; we cannot configure any extra headers. We prefer Swell-managed hosting and have no frontend yet. Propose where this callback should land and how it can update the store safely. Stay read-only."

Assess: discover that a route needs a public key and that the callback address can carry the app's own; choose a public route function, with no frontend added merely to receive the callback. Recognize that the key does not authenticate the provider: signature verification on the raw body and input validation precede writes. Name the `/app-api` endpoint or an external service only as the fallback for a sender a route cannot take (a body that is not JSON, or no credentials kept in an address). Do not assume a shopper or store-user session is attached.

## Private runtime secret

User request: "Our existing Swell storefront app needs to call a provider from its server handlers with our company's private API secret, which merchants must not receive. We have our own Cloudflare account and want to retain Swell installation, storefront addresses and request context. Propose the hosting and configuration changes and their consequences. Stay read-only."

Assess: retain the Swell app contract while switching the frontend to Cloudflare self-hosting; keep the private value in a runtime secret binding, outside settings, source and browser code. Read the hosting and configuration references. Recognize that app functions do not inherit frontend bindings and that self-hosting has its own caching and context-verification requirements.

## Storefront widget: booking packages

User request: "Our spa app keeps treatment packages in an app collection. Merchants should be able to put a list of packages, with a buy button on each, on any page of their storefront, choosing cards or a compact strip. It must work on every storefront they create, custom domains included. Propose how the app offers this and how the widget calls our backend. Stay read-only."

Assess: a storefront app block in `script` mode declared in `swell.json` `storefront.embeds`, with a `select` prop for the layout. The script registers with `SwellAppBlocks` instead of scanning the page. It renders into a shadow root and follows the `--swell-*` tokens. Calls go through the app proxy, and the endpoint checks `isStorefrontRequest`. Read `references/storefront-blocks.md`. No origin list, no `component` mode (nothing sensitive is entered), and no `storefront` app.

## Storefront widget: card entry

User request: "Our gift card app should let shoppers buy a gift card from a form on the merchant's storefront page, entering card details through our payment provider's SDK. The provider requires that no other script on the page can read the card fields. Propose how to build the widget. Stay read-only."

Assess: a storefront app block in `component` mode, an App Component with `targets: [{ id: 'storefront.block' }]` named by the block's `component`. It calls its backend through `props.fetch`. Recognize the per-instance cost, the third-party storage caveat and the missing page fonts. Do not choose `script` mode, which would put the card fields in the merchant's page.

## Not a block: ratings on product cards

User request: "Our reviews app should show each product's average rating as stars on every product card in category grids, and the rating should be visible to search engines. Propose how the app gets the stars onto the storefront. Stay read-only."

Assess: no app block. Publish the rating as data storefronts read (a public app field or an app collection with `public_permissions`) and let the storefront render the stars in its own markup. Explain why: a block per card costs a script mount or an iframe each, and app scripts don't render on the server. A single `script` block for a review form on the product page may be offered as a separate piece.
