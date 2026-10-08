# Backend standalone builds

Manual end-to-end checks for the `swell-backend-api` skill outside an app: a fresh agent builds a small integration against a store from a user-style request, and someone else verifies the result. They were first run on 2026-10-07 to compare the revised skill with the older `swell-backend`, each task built once from each skill. They are not run by the eval scripts.

## Method

For each case, start a fresh agent with no review history, on the model a typical user would run. Give it:

- the request below, word for word, with `<P>` replaced by a prefix of its own (`cmpa3`, `cmpb3`);
- the path to a frozen copy of one skill folder, starting at its `SKILL.md`, as the only Swell documentation it may use (the packages it installs are allowed; other Swell repositories and skills, the public documentation site and the web are not);
- a working directory that holds the input files a case names, and a test secret key in the environment;
- the limits: create only records that start with its prefix, `@example.com` addresses for people, no change to records it did not create, no `swell` CLI. Trying requests against the store is allowed.

Ask it to finish with a report: what it built, the checks it ran with their output, the skill files it read, every place the skill was missing, wrong or unclear and what it guessed or found by trying there, and what it could not verify.

Do not supply this file, the checks, planning notes, or the fact that two skills are compared.

The builder's report is not evidence. A verifier runs the checks below against the store and the delivered files, and reads the code only for the decisions a check names. Classify each failed check before changing anything: the skill was wrong or silent (fix the owning reference, then rerun the case once with a fresh agent); the platform misbehaved (report it); or the agent erred against clear text. A request a builder got right by trying it against the store is not a failure; record what it had to find out.

The input files for cases 2 and 3 come from `make-inputs.py <prefix> <directory>` beside this file: 300 customer rows with two that the store refuses and three repeated emails, and a second file with three changed phones, one changed address and one new row; a feed of ten products, six of them with a size and a colour option, and a second feed with an option value removed, one added, a product gone and a product new.

## 1. Sales report

swell-node, reads only.

Request: "Write a Node.js script with swell-node, `report.js <from> <to>`, for our finance team. Dates are `YYYY-MM-DD` in UTC, and an order counts when it was created on or after `<from>` and before `<to>`, is paid and is not canceled. The script prints one JSON object:

- `orders`: how many such orders there are, and `revenue`: the sum of their `grand_total`;
- `months`: for each calendar month, the number of orders and the revenue;
- `top_products`: the ten products with the most units sold, each with the product's name and its units;
- `customers`: how many different customers placed these orders.

It also writes `orders.csv` with one line per order: order number, creation date, customer email, number of units, grand total.

Run it for 2022-01-01 to 2026-10-01 and leave the JSON in `report.json`. This script only reads; it creates nothing in the store."

Checks:

1. The order count, the revenue and the number of customers equal an independent read of the same orders with bounds sent as full UTC timestamps. On the first run: 2,880 orders, more than one page.
2. Every month's count and revenue match.
3. The ten products and their units match for items that have a product; items without one are left out or shown apart, not dropped silently into another product.
4. `orders.csv` has one line per order, with the email filled in.
5. The orders are read page by page or aggregated, without one request per order.

## 2. Customer import

Python, direct HTTP.

Request: "Write `import_customers.py` (Python 3, direct HTTP to the Swell API, no Swell package) that loads a CSV file of customers into the store. `customers.csv` in your working directory is the file: email, first name, last name, phone and one postal address per row.

- Each row becomes a customer account with that address as the customer's saved address.
- The email identifies the customer. When an email is repeated in the file, it is the same customer and the later row wins.
- Running the script again, on the same file or on a newer export, must create no duplicate customers and no duplicate addresses, and must update the customers whose row changed.
- Customers must get no email because of this import, and the store's webhooks and apps must not react to it.
- Rows that the store refuses go to `rejected.csv` with the row number and the reason. The script ends with a summary line: created, updated, unchanged, rejected.
- The real file has about 50,000 rows, so the script must not take one request after another per row.

Run it on `customers.csv`, then on `customers-2.csv`, which is the same export a day later with a few changes. Keep the output of both runs in `run-1.txt` and `run-2.txt`."

Checks:

1. After both runs the store has one account for each distinct valid email of the second file, each with exactly one address, and names, phones and addresses equal the file's last row for that email.
2. The two refused rows are in `rejected.csv` with the store's reason, and are not counted as written.
3. The second run reports one created and four updated, and a third run of the same file reports nothing to do.
4. The event log holds no event for the imported accounts.
5. Writes go through `/:batch` or run several at a time, and each entry of a batch answer is checked for a refusal.

## 3. Catalog sync

swell-node.

Request: "Write `sync.js <feed.json>` with swell-node that makes our store's catalog match a supplier feed. `feed-1.json` and `feed-2.json` in your working directory are two consecutive feeds; the format is plain to read.

- A product is matched by its `sku`. A product in the feed is created or updated: name, price, description, options.
- A product with options has one variant for each entry of `variants` in the feed, with that entry's `sku`, `price` and stock. Variants and option values that are no longer in the feed must be gone from the store.
- Stock: the store must show the feed's quantity for every variant, and for every product without variants. Stock must be tracked, so that later orders reduce it.
- A product of ours (its `sku` starts with `<P>`) that is no longer in the feed is deactivated, not deleted.
- Running the same feed a second time changes nothing.

Run it with `feed-1.json`, then with `feed-2.json`, and keep the output of both runs in `run-1.txt` and `run-2.txt`."

Checks, against the second feed:

1. One product per `sku`; the one that left the feed is inactive and the rest are active, with the feed's name, price and description.
2. Option values equal the feed's: the removed value is gone and the added one is there.
3. The variants that a list of the product returns are the feed's, each with its `sku` and price, and none is archived.
4. `stock_tracking` is on, and each variant's and each plain product's `stock_level` equals the feed's quantity, zero included.
5. Running the second feed again changes no stock level and no variant id.

## 4. Order desk

Node `fetch`, no package.

Request: "Write `order_flow.mjs` (Node 22, the built-in `fetch`, no Swell package) that plays one phone order through from start to end. After every step it prints the order's `status`, `paid`, `delivered`, `payment_balance` and refunded total.

1. Set up, creating only what is missing: the customer `<P>-phone@example.com`, and two products, `<P> mug` at 20.00 and `<P> poster` at 35.00, each with tracked stock and 10 in stock.
2. The customer orders two mugs and one poster. No shipping charge, no tax.
3. They pay 50.00 in cash now.
4. We ship the two mugs with the tracking code `TRACK-<P>-1`. The poster waits.
5. They pay the remaining 25.00 in cash.
6. They no longer want the poster: take it off the order and give them 35.00 back.
7. Print the final state of the order, the list of its payments and refunds, and the stock of both products.

Each run of the script plays a new order. Run it once and keep the output in `run-1.txt`."

Checks:

1. One customer and two products exist after any number of runs, with tracked stock.
2. The order has both items, a total of 75, no shipping charge and no tax.
3. Two cash payments of 50 and 25 succeed, and `paid` turns true after the second, not the first.
4. One shipment holds the two mugs and the tracking code.
5. At the end the poster no longer counts on the order, one refund of 35 exists, `payment_balance` is 0 and the stock of the poster is back.
6. The printed state after each step is what the store holds, and no write is taken for a success without reading the answer.

## 5. Subscription lifecycle

swell-node.

Request: "Write `subscription_flow.js` with swell-node that plays our membership through. After every step it prints, for the subscription it touched: `status`, `active`, `canceled`, `cancel_at_end`, the plan, the price, and the dates of the trial end and the period end.

1. Set up, creating only what is missing: the product `<P> coffee club`, which is a membership and ships nothing, with a monthly plan at 18.00 and a yearly plan at 180.00; and the customers `<P>-sub1@example.com` and `<P>-sub2@example.com`. Neither customer has a card.
2. Start the first customer on the monthly plan with a 14-day free trial.
3. They ask to cancel. They keep the membership until the end of what they have; do not cut them off now. Print whether they have access at this moment.
4. They change their mind: withdraw the cancellation.
5. Move them to the yearly plan.
6. Give the second customer 200.00 of store credit and start them on the monthly plan with no trial, paid from that credit. Print the invoice that was paid and the credit they have left.
7. The first customer cancels for good: stop their membership right now. Print whether they have access.
8. Stop the second customer's membership right now as well. Print whether anything was refunded and the credit they have.

Each run of the script starts new subscriptions. Run it once and keep the output in `run-1.txt`."

Checks:

1. The product has the two plans, monthly at 18 and yearly at 180, and creates no shipment.
2. The first subscription starts in trial with no invoice and no payment.
3. After step 3 it is canceled, set to stop at the end and still active, and the script prints access from `active`.
4. After step 4 it is no longer canceled; after step 5 it is on the yearly plan at 180.
5. The second subscription is active with one paid invoice of 18, and the customer's credit is 182.
6. After step 7 the first subscription is not active — it stopped at once, not at the end of the trial.
7. After step 8 the second is not active, nothing was refunded and the credit is still 182, and the script says so.

## 6. Webhook receiver

Node, no framework; the verifier drives it through a tunnel.

Request: "Our fulfilment service must learn about every order that is paid and every order that is canceled in the store. Build it in Node 22, without a web framework:

- `receiver.mjs`: an HTTP server on the port in `PORT` that receives the store's webhooks. For each paid or canceled order it appends one line to `ledger.jsonl`: the event's id and type, and the order's number, grand total and customer email. The same event is never written twice, however often the store sends it. A request that does not come from our store is refused and writes nothing.
- `setup.mjs <public url>`: makes the store send those events to the receiver at that address. Run again, with the same or a new address, it leaves one working webhook, not two.
- `catchup.mjs`: our server is sometimes down for hours. This script adds to the ledger every paid-order and canceled-order event the ledger does not have yet, reading them from the store, and can be run at any time without producing duplicates.

Test it end to end. `cloudflared tunnel --url http://localhost:<port>` gives the receiver a public address; start the receiver and the tunnel in the background and stop both when you are done. Make your own test orders for the customer `<P>-wh@example.com` and a product `<P> thing`, and pay them in cash. Include the case where the receiver was down while an order was paid. Describe in `README.md` how to run the three scripts."

Checks:

1. `setup.mjs` leaves one enabled webhook for the receiver's address that lists the paid and the canceled order events; a second run leaves one.
2. Paying an order writes one ledger line with the right number, total and email, and canceling it writes one more.
3. The same request sent again writes nothing. A request without the credential the setup put in the address or the headers is refused and writes nothing.
4. With the receiver stopped, one order is paid; with the receiver back, another. `catchup.mjs`, run before the store retries, adds the first; a second run adds nothing, and so does the store's late delivery of the same event.
5. The ledger's values come from a read of the order.

## 7. Coupon campaign

swell-node.

Request: "Write `campaign.js` with swell-node for a win-back campaign. It prints what it did at every step.

1. Create the coupon `<P> winback`, unless it exists: 15% off the whole order, valid until the end of 2026. Give it 40 unique codes, each usable once, and write them to `codes.csv`.
2. Prove that it works. Set up, creating only what is missing, the customer `<P>-promo@example.com` and the product `<P> tee` at 40.00. Place an order for one tee for that customer with one of the codes, paid in cash. Print the order's discount and grand total.
3. Place a second order for one tee for the same customer with the same code, and print what the store did with the code.
4. Print how many times the coupon has been used.
5. Give the customer 25.00 of store credit as goodwill, with the reason `winback`. Print their credit balance before and after.

Run it once and keep the output in `run-1.txt`."

Checks:

1. The coupon takes 15% off the order total and ends with 2026; it has 40 codes, each limited to one use, and `codes.csv` lists them.
2. The first order has a discount of 6.00, a total of 34.00 and a cash payment, and records the coupon.
3. The second order is not discounted or is refused, and the script prints which.
4. The printed use count is what the store holds: one.
5. The customer's credit is 25.00 with the reason, and the two printed balances are the true ones.

## 8. App data from outside an app

Python, direct HTTP. The store needs two installed apps to read: one with a collection, one with fields on orders.

Request: "Two apps are installed in our store. The reviews app, whose id in its `swell.json` is `wfreviews`, keeps product reviews in its collection `reviews`. The delivery app, `wfcarrier`, keeps a delivery status and a delivery reference on each order, in fields of its own. Write `app_report.py` (Python 3, direct HTTP to the Swell API, no Swell package) that does four things:

1. `reviews.csv`: every approved review, with the product's name, the rating, the title, the reviewer's email and the date.
2. `deliveries.csv`: every order that has a delivery status from the delivery app, with the order number, the status and the reference. Then print the number of orders per status.
3. `fields.md`: a field dictionary for three kinds of record — a review, a blog post of the store's content (`content/blogs`), and a customer's saved address. For each field: name, type, whether it is required, and the allowed values where the field has a fixed list.
4. Two writes, for a test: add a review with the status `pending` and a rating of 5 for any product, by the customer `<P>-rev@example.com` (create the customer if missing); and create an order for that customer for the same product, then set its delivery status to `failed` in the delivery app's field. Read both back and print them.

Run it once and keep the output in `run-1.txt`."

Checks:

1. `reviews.csv` has every approved review, with the product's name and the reviewer's email.
2. `deliveries.csv` has every order with a status, and the counts per status are right.
3. `fields.md` describes the app's own `reviews` model, the `content/blogs` model and not the standard `blogs` model, and the address fields from the `addresses` field of `accounts`.
4. The review exists in the app's collection as `pending` with the customer linked, and a direct read of the order shows the status under `$app.wfcarrier`.
