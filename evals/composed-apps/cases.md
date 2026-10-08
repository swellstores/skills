# Composed app builds

Manual end-to-end checks for the three revised skills used together: a fresh agent builds and deploys an app whose work is mostly commerce operations, so it needs `swell-app` for the app and an API skill for what the app does. Someone else verifies the result. First run on 2026-10-07. They are not run by the eval scripts.

## Method

As in [app-workflows/cases.md](../app-workflows/cases.md), with these differences:

- The builder gets a frozen copy of the three revised skill folders and starts at `swell-app/SKILL.md`. Record which files of which skill it read.
- The brief names what the builder may write to the store: the app, pushed to the test environment, and records with a prefix of its own (`cps1` to `cps3` below) — customers `<P>-…@example.com`, products, carts, orders, payments, refunds, credits, shipments and subscriptions. It changes nothing it did not create, and prints no part of a key.
- The verifier has a public key of the store from the owner, for Frontend API reads as a logged-in customer, and a browser that is signed in to the dashboard. It types no password into a deployed page: a customer's logged-in state in the browser comes from the session cookie of a Frontend API login.
- `swell app dev` sessions on one CLI login share a preview slot. Tell the builder of case 1 that the development tunnel is in use by someone else, and do not run cases 2 and 3 at the same time.

A check passes on what the store holds and what the deployed app does when the verifier uses it, twice in a row for the reads: the storefront gateway keeps some answers for five seconds. A wrong result that looks right is the failure these cases look for, so read the store, not the page.

Classify each failed check as in the app workflow builds, and add which skill owns the gap: the app skill (the block, the runtime client, who is calling), an API skill (what the operation takes and answers), or the seam between them (the right rule exists in an API skill and the builder did not get there from the app skill, or applied a standalone client's contract to an app client).

## Fixtures

In the test environment, the catalog of [frontend-standalone/cases.md](../frontend-standalone/cases.md), switched on: the category `sfb-shop` with `sfb tee` (30, on sale at 24, Size and Color variants with tracked stock, M / Black at zero), `sfb mug`, `sfb poster`, `sfb beans`, `sfb club` (a membership with a Monthly plan at 18 and a Yearly plan at 180), `sfb pen`, `sfb vase` (tracked stock at zero) and `sfb retired` (inactive), and the coupons `SFB10` (10%) and `SFBOLD` (expired). The store has the card method on Swell's `test` gateway, the manual method `cash`, the `account` method and one pickup shipping service.

For case 2, three customers with passwords: `cps2-member@example.com` and `cps2-other@example.com`, each with a running Monthly `sfb club` subscription and one unpaid order, and `cps2-plain@example.com` with one unpaid order and no subscription. The builder's `fixtures.json` names the category, the coupons and the first and the third customer with their passwords; the second is the verifier's.

## 1. Loyalty points

An `admin` app with functions and no frontend. Its operations are the Backend API's: what makes an order paid, canceled and refunded, account credit, and what a storefront can read.

Request: "Build a Swell app with the id `cpsloyal` that gives our customers loyalty points, and deliver it working in the store's test environment.

- A customer earns one point for every whole unit of currency they pay for products: the order's items after discounts, without shipping and tax. Points are earned when the order is paid, however it is paid, and an order earns once, whatever happens to it later.
- When an order is canceled, or refunded in full, its points are taken back, once. A partial refund takes nothing back.
- Staff see a customer's point balance on the customer's record in the dashboard, and a list of every movement of points — customer, order, points, reason, date — that they can filter by customer.
- On a customer's record staff have a button 'Convert points'. It asks for a number of points, in hundreds, and turns every 100 points into 5.00 of store credit on the customer's account. It refuses more points than the customer has.
- Our storefront is a separate site that already exists and talks to Swell with the store's public key; it is not part of this task. It shows a logged-in customer their points, their last ten movements and their store credit. Tell me exactly how it reads them. A customer must never read another's.
- No custom dashboard pages."

Checks:

1. The push output has no skipped or failed file, and `swell inspect` shows every resource deployed and enabled. `permissions` is declared and holds no scope the code does not use.
2. An order of two `sfb tee` and one `sfb pen` with `SFB10`, paid afterwards with a `cash` payment, earns 51 points: one movement, and the balance on the customer.
3. An order that is paid from account credit when it is created earns too.
4. A paid order that gets another item and a payment for the difference still has one earning movement. On the first run `paid` stayed true through the change and no second `order.paid` was recorded, so this check did not put the app's guard to the test.
5. Canceling an order that earned takes its points back in one movement. So does a refund of everything that was paid; a refund of part of it takes nothing back, and a second full-refund event takes nothing more.
6. After all of the above the balance on the customer equals the sum of that customer's movements.
7. The dashboard shows the balance on the customer's record and lists the movements with a filter by customer.
8. 'Convert points' with 200 adds one credit of 10.00 to the account, takes 200 points and records the movement. More points than the balance, and a number that is not in hundreds, are refused with a message and change nothing.
9. As a logged-in customer, the storefront read returns their points, their last ten movements and the credit the store holds for them, not `0`. A visitor is refused. One customer cannot read another's points, movements or credit, through the app's endpoint or with a Frontend API read.
10. Type checks pass, and so do the tests the builder wrote.

## 2. Storefront with an account area

A `storefront` app. Its operations are the Frontend API's, through the scaffold's clients.

The working directory holds `fixtures.json`.

Request: "Build our store's storefront as a Swell app with the id `cpsshop`, and deliver it working in the store's test environment. `fixtures.json` in your working directory names the category, the coupon codes and two test customers with their passwords.

- The home page lists the products of the category `sfb-shop` with name and price. A product on sale shows its old price struck through beside the price.
- A product page by slug. On a product with Size and Color the shopper chooses both and sees that combination's price and whether it is in stock; a combination that is out of stock cannot be added. A product that does not exist, or that we no longer sell, gives a 404.
- A cart page: change quantities, remove lines and enter a coupon code. A code that is refused shows the reason. The page shows subtotal, discount and total, and a checkout button. The header of every page shows the number of items in the cart.
- Customers log in and log out, and a wrong password is told to them. `/account` shows the logged-in customer's name, their orders — number, date, total, paid or not — and their subscriptions — product, plan, price, next billing date, status. A visitor is sent to the login page.
- On a subscription the customer has a button 'Cancel at the end of the period' and, once that is set, 'Keep my subscription'. Neither may charge them, and neither may end their access at once.
- `/members` is for members only. A customer with a running `sfb club` subscription sees the members' text; one who set it to cancel at the end of the period still gets in until then. Any other customer sees an invitation to join, and a visitor is sent to the login page.
- One shopper never sees another's cart, account or subscriptions.
- Tell me the address of the storefront."

Checks:

1. The push output has no skipped or failed file, the managed frontend deploys, the push prints the storefront's address (with `--preview` after the storefront id), and the address the builder reports serves the storefront.
2. The frontend is the Swell Vinext template with its helpers and `@swell/apps-sdk`, on managed hosting.
3. The home page lists the seven active products with the Frontend API's prices, the tee at 24 beside a struck 30, and not the retired one.
4. A product page's HTML from the server holds the name and price. L / White shows that variant's price and stock from the Frontend API; M / Black cannot be added. An unknown slug and the retired product answer 404.
5. In a browser, a product added shows in the header count and on the cart page; quantities and removal work. `SFBOLD` shows the store's refusal, `SFB10` shows a discount of 10%, and the totals are the cart's. The checkout button leads to Swell's checkout for that cart.
6. A login with a wrong password shows a message. Logged in as the member, `/account` shows the name, the order as unpaid, and the subscription with the Monthly plan, 18, and the store's `date_period_end`. A visitor is sent to the login page.
7. After 'Cancel at the end of the period' the store holds the subscription canceled, set to stop at the end and still active. After 'Keep my subscription' it is not canceled and still active. The store holds no new invoice or payment from either.
8. `/members` shows the text to the member, also after the scheduled cancel, the invitation to the customer without a subscription, and the login page to a visitor. The decision is made on the server from the session's customer.
9. Logged in as one customer, no page holds anything of the other, twice in a row; a change sent with the other's subscription id changes nothing; a write handler of the app, if it has one, refuses another origin.
10. Customer data is never read through the app's Backend client without a check of the session's customer. Type checks and the frontend build pass.

## 3. Sales desk

An `admin` app with a dashboard page. Its operations are the Backend API's, through the frontend's Backend client.

Request: "Build a Swell app with the id `cpsdesk`: a sales desk for our store's staff, as a page in the dashboard. Deliver it working in the store's test environment.

- A Sales report: for a range of UTC dates, from the first day up to but not including the last, it shows the number of orders and their revenue as the sum of `grand_total`; the same for each calendar month; the ten products with the most units sold, with their names; and the number of different customers. An order counts when it was created in the range, is paid and is not canceled. The default range is the last twelve months. The store has several thousand orders, and the report must open in a few seconds.
- Fulfilment: staff enter an order number and see the order's lines, each with the quantity ordered, shipped so far and left to ship. They enter a quantity per line, a carrier and a tracking number and press Ship. That records the shipment in Swell, so the order shows as delivered once everything has gone out. It must never ship more than is left on a line.
- Each shipment made here records which staff member made it.
- Nobody outside the store's staff may see any of this or ship anything.
- Create test orders of your own to try the fulfilment on."

Checks:

1. The push output has no skipped or failed file, the managed frontend deploys, and `swell inspect` shows every resource deployed and enabled.
2. The frontend is the Swell Vinext template with its helpers and `@swell/apps-sdk`, on managed hosting.
3. For 2022-01-01 to 2026-10-01 the number of orders, the revenue and the number of customers equal an independent read of the same orders with bounds sent as full UTC timestamps, twice in a row. There are more than 2,880, so more than two pages.
4. Every month's count and revenue match, and so do the ten products and their units for items that have a product.
5. The orders are aggregated or read page by page, not one request per order and not a first page taken for the whole, and the report answers in a few seconds.
6. An order looked up by its number shows each line's ordered, shipped and remaining quantities as the store holds them.
7. Shipping part of an order stores one shipment whose lines carry the order's item ids, with the carrier and the tracking number, and the order is not delivered. Shipping the rest makes it delivered. A quantity above what is left is refused and stores nothing.
8. The shipment carries the staff member, read from the signed-in store user and not from the form.
9. At the app's public address, the one with the installation's id, a visitor gets no store data, and a Ship request without a store user, or from another origin, is refused and stores nothing.
10. `permissions` is declared and holds no scope the code does not use. Type checks and the frontend build pass.
