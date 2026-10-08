# App workflow builds

Manual end-to-end checks for the revised `swell-app` skill: a fresh agent builds and deploys a working app from a user-style request, and someone else verifies the result. They complement the [architecture discovery trials](../architecture-entrypoint/cases.md), which stop at a design. They are not run by the eval scripts.

## Method

For each case, start a fresh agent with no review history, on the model a typical user would run. Give it:

- the request below, word for word;
- the path to a frozen copy of the three revised skill folders, starting at `swell-app/SKILL.md`, as the only Swell documentation it may use (the packages a scaffold installs are allowed; other Swell repositories, the public documentation site and installed copies of the skills are not);
- an empty working directory, a released `swell` CLI that is logged in, and a store whose test environment it may write to;
- the limits: test environment only, no `--live`, no versions, installs in other environments or releases, no changes to other apps, `@example.com` addresses for any person it creates.

Ask it to finish with a report: what it built, the checks it ran and their results, the skill files it read, every place the skill was missing, wrong or unclear and what it guessed there, and what it could not verify.

Do not supply this file, the acceptance checks, planning notes or an expected architecture.

The builder's report is not evidence that the app works. A separate verifier runs the checks listed under each case against the deployed app — as a shopper, a visitor, the provider and a store user — and reads the code for the identity and permission decisions. Write down the skill revision, the CLI version and the result of each check in the revision project's evidence notes.

Classify each failed check before changing anything: the skill was wrong or silent (fix the owning reference, then rerun the case once with a fresh agent); the gap is API knowledge (belongs to the API skills); the platform, CLI or template misbehaved (report it; the skill does not describe the bug); or the agent erred against clear text.

## Product reviews

An `admin` app with no frontend.

Request: "Build a Swell app with the id `wfreviews` that adds product reviews to our store, and deliver it working in the store's test environment.

- A logged-in shopper submits a review of a product from our storefront: a rating from 1 to 5, a title and a text. The storefront is a separate site that already exists and talks to Swell with the store's public key; it is not part of this task, but tell me exactly how it should submit and read reviews.
- A review belongs to the customer who is logged in. One customer can review a product once.
- New reviews are pending. Anyone browsing the storefront can read the approved reviews of a product and must never see pending or rejected ones.
- Staff see all reviews in the dashboard, can filter them by status, and can approve or reject one review or many selected reviews at once. Rejecting asks for a reason.
- Each product has an average rating and a count of its approved reviews that the storefront can read.
- When a review is approved, the reviewer gets an email. The merchant can switch that email off in the app's settings.
- No custom dashboard pages."

Checks:

1. The push output has no skipped or failed file, and `swell inspect` shows every resource deployed and enabled.
2. `permissions` is declared and holds no scope the code does not use.
3. A submission without a logged-in customer is refused. With a customer's session it creates one pending review tied to that customer, whatever status or customer id the body carries.
4. A second review of the same product by the same customer is refused.
5. With the store's public key, the approved reviews of a product can be read and a pending or rejected one cannot, as a list or by id.
6. In the dashboard, the reviews list filters by status; approve works on one record and on a selection; reject asks for a reason and stores it.
7. After approvals, the product's average and count are correct and readable with the store's public key.
8. Approval produces the email to the reviewer's address; with the setting off it does not.
9. Type checks pass, and so do the tests the builder wrote.

## Carrier callback

An `integration` app with no extension slot and no frontend. For this case the builder is also told that the development tunnel is in use by someone else, so `swell app dev` is unavailable.

Request: "Build a Swell integration app with the id `wfcarrier` that connects our store to a delivery provider called ShipFast, and deliver it working in the store's test environment.

- The merchant enters three things in the app's settings: the ShipFast API base URL, their ShipFast API key, and their ShipFast webhook signing secret.
- When an order is paid, the app registers a delivery: `POST <base URL>/deliveries` with the header `X-Api-Key: <API key>` and a JSON body `{ "reference": <a unique value the app generates for the order>, "order_number": <the order number> }`. Any 2xx answer means accepted. Keep the reference and a delivery status on the order.
- ShipFast later reports progress by POSTing JSON `{ "reference": "...", "status": "in_transit" | "delivered" | "failed", "tracking_url": "..." }` to one callback URL that the merchant registers in ShipFast's panel. ShipFast signs each callback: the header `X-ShipFast-Signature` holds the hex HMAC-SHA256 of the exact request body, keyed with the signing secret. ShipFast cannot be configured to send any other header. A callback must change the order only when its signature is valid.
- Staff see the delivery status and the tracking link on the order in the dashboard.
- We prefer everything hosted by Swell. ShipFast has no sandbox: for testing, use `https://httpbin.org/anything` as the base URL (it answers 200 to any path) and play ShipFast's part yourself for the callback.
- Tell me the exact callback URL the merchant registers."

Checks:

1. The push output has no skipped or failed file, and `swell inspect` shows every resource deployed and enabled. The app is an `integration` app with no `extensions[]` and no frontend.
2. `permissions` is declared and holds no scope the code does not use.
3. The three settings exist and the two credentials are hidden in the dashboard.
4. Paying an order in the test environment leads to the outbound request and to a reference and status on that order.
5. The callback URL is a route of the app with the installed app's public key in the address. A POST there with a valid signature over the bytes sent updates the matching order, and the dashboard's order screen shows the status and the tracking link.
6. A POST with a wrong or missing signature changes nothing and is answered with an error. A signed callback with an unknown reference changes nothing.
7. The signature is computed over the body as received, not over a re-serialized object.
8. No credential appears in code or in `assets/`.
9. Type checks pass, and so do the tests the builder wrote.

## Returns desk

An `admin` app with a dashboard frontend, a scheduled function and a workflow.

Request: "Build a Swell app with the id `wfreturns`: a return-requests desk for our store's staff. Deliver it working in the store's test environment.

- A return request has the order it is for, the customer's email, a reason, a refund amount and a status: requested, approved, received, refunded, rejected or expired. Staff create, edit and list return requests in the dashboard and filter the list by status.
- On a return request staff have two buttons: Approve, and Mark received, which asks for a note on the condition of the goods.
- Staff need an Overview page in the dashboard: the number of requests per status, the total refund amount of the last 30 days, a chart of requests per day, and the ten oldest open requests, each linking to its record. On that page a staff member can add an internal note to one of those ten requests without leaving the page; the note records who wrote it.
- Nobody outside the store's staff may see the Overview page's data or add notes.
- Every night, approved requests that have waited more than 14 days to be received become expired, and each one is reported to our warehouse system with a POST to a URL the merchant sets in the app's settings. There can be thousands of them and the warehouse answers slowly, 2 to 5 seconds per call. For testing, use `https://httpbin.org/anything` as the warehouse URL."

Checks:

1. The push output has no skipped or failed file, the managed frontend deploys, and `swell inspect` shows every resource deployed and enabled.
2. The collection does not extend or collide with the standard `returns` collection.
3. The frontend is the Swell Vinext template with its helpers and `@swell/apps-sdk`, on managed hosting.
4. In the dashboard, the sidebar leads to the list and to the Overview page; the page shows the counts, the total, the chart and the ten oldest requests with working links for the signed-in store user.
5. At the app's public address a visitor gets no store data and cannot add a note.
6. Adding a note from the page works and records the store user who wrote it.
7. Approve and Mark received work from the record, and Mark received stores the note from its dialog.
8. The nightly function has a schedule; run on demand, it starts a workflow that expires the right records page by page, reports each to the warehouse URL and finishes.
9. `permissions` is declared and holds no scope the code does not use.
10. Type checks and the frontend build pass.

## Storefront with a wishlist

A `storefront` app. The Frontend API skill is part of this case; note separately which failures are app knowledge and which are API knowledge.

Request: "Build our store's storefront as a Swell app with the id `wfshop`, and deliver it working in the store's test environment.

- A home page with the first 12 active products, and a product page by slug with an add-to-cart button. A product that does not exist gives a 404.
- A cart page: change quantities, remove items, and a checkout button.
- Customers can log in and log out.
- A wishlist: a logged-in customer adds and removes products from the product page and sees their own wishlist on a My wishlist page. Nobody can see or change another customer's wishlist, and a visitor who is not logged in is asked to log in.
- The merchant can see wishlist entries in the dashboard.
- Tell me the address of the storefront."

Checks:

1. The push output has no skipped or failed file, the managed frontend deploys, and the address the builder reports serves the storefront.
2. The frontend is the Swell Vinext template with its helpers and `@swell/apps-sdk`, on managed hosting.
3. The home page lists products; a product page loads by slug; an unknown slug answers 404.
4. Adding to the cart in a browser shows on the cart page; quantities and removal work; the checkout button leads to Swell's checkout for that cart.
5. A test customer can log in and out. Logged in, they add and remove wishlist entries and the page lists only their own.
6. A visitor can neither read nor write wishlist entries: through the page, through the app's own endpoints, or by calling the Frontend API directly with the key the storefront uses. One customer cannot read or change another's entries by any of those routes.
7. Wishlist entries are listed in the dashboard.
8. Customer data is never served from the app's Backend client without a check of the session's customer.
9. Type checks and the frontend build pass.

Record what `permissions` the builder declared; the case does not pass or fail on it while the no-scope declaration is undecided.

## Follow-up tasks on a built app

Two short tasks for fresh agents on the source of the reviews app after it passes. They test the development cycle's scoping of work, not a new build. Tell both that `swell app dev` is unavailable, and run them one after the other: a push from one working copy removes resources the other added.

### Debugging

Before the run, add a function that should set a `first_approved_at` field of a review when it is approved, subscribed to `after:review.approved`, with the field in the model, and push. Confirm that an approval leaves the field empty.

Request: "Our product reviews app `wfreviews` is deployed in the store's test environment. Last week a colleague added a function that should record the moment a review is first approved, in the review's `first_approved_at` field. It has never worked: reviews get approved, the email goes out, the rating updates, but `first_approved_at` stays empty. No errors anywhere that we can see. Find out why and fix it, and show me it works on a newly approved review."

Checks: the cause is named as the hook prefix on a custom event; the fix subscribes to the event without the prefix and changes nothing else; a review approved through the dashboard action gets the field, and the email and the rating still work.

### Narrow edit

Request: "In our product reviews app `wfreviews` (deployed in the store's test environment), make two small changes to the reviews list in the dashboard: add the Moderated date as a column after Status, and rename the 'Rejected' tab to 'Declined'. Nothing else should change. Deploy it to the test environment."

Checks: only the content file changes; the tab's id and query, the filter and the actions are untouched; the file is validated and the deployed view is compared with the change; no other resource is redeployed, removed or retested.
