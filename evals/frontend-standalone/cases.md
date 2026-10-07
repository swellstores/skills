# Frontend standalone builds

Manual end-to-end checks for the `swell-frontend-api` skill outside an app: a fresh agent builds part of an independently hosted storefront from a user-style request, and someone else verifies the result. First run on 2026-10-07. They are not run by the eval scripts.

## Method

As in [backend-standalone/cases.md](../backend-standalone/cases.md), with these differences:

- The builder gets a frozen copy of the three revised skill folders and starts at `swell-frontend-api/SKILL.md`.
- Its working directory holds `.env` with the store id and a public key, and `fixtures.json` with the names of the records below. It has no secret key and no `swell` CLI, and prints no part of the key.
- The brief names what the builder may write to the store: carts, test orders, customers `<P>-…@example.com` with a prefix of its own (`sfb1` to `sfb4` below), and for case 4 reviews in the app.

A check passes on what the store holds and what the delivered code does when the verifier runs it, with fresh inputs where a case takes them, and twice in a row for the reads: the storefront gateway keeps some answers for five seconds, and a read can pass once and fail on the repeat. A wrong result that looks right is the failure these cases look for: read the store, not the printed line.

## Fixtures

In the test environment, all in the category `sfb-shop`: `sfb tee` (30, on sale at 24, Size and Color variants with tracked stock, M / Black at zero), `sfb mug` (12, one in stock), `sfb poster` (35, stock tracking never set), `sfb beans` (one-time and a monthly plan), `sfb club` (a membership with a Monthly plan at 18 and a Yearly plan at 180), `sfb pen` (9, an add-on option `Gift wrap`, `Wrapped` at 5), `sfb vase` (tracked stock at zero) and `sfb retired` (inactive). The coupons `SFB10` (10%) and `SFBOLD` (expired), gift cards of 5.00, the `content/pages` records `sfb-about` (published) and `sfb-draft` (not published), two customers for the verifier, and in the installed reviews app `wfreviews` two approved reviews of the tee and one of the poster. The store has the card method on Swell's `test` gateway, the manual method `cash` and one pickup shipping service.

## 1. Next.js storefront

Request: "Build a small storefront for our Swell store as a Next.js app (App Router, current release). We host it ourselves; it is not a Swell app. The store id and a public key are in `.env`. It must run with `npm run build` and then `npm start`, on the port in `PORT`.

- `/` lists the products of the category `sfb-shop` with name and price. A product on sale shows its old price struck through beside the price. A switch 'Available only' hides the products that cannot be bought right now.
- `/products/<slug>` shows one product, rendered on the server. On a product with Size and Color the shopper chooses both and sees the price of that combination and whether it is in stock; a combination that is out of stock cannot be added. The address of a product that does not exist, or that we no longer sell, shows the 404 page.
- 'Add to cart' adds the chosen product. The header of every page shows the number of items in the cart. `/cart` lists the lines with quantity controls, a remove button and the subtotal. A shopper who comes back tomorrow in the same browser finds their cart.
- `/pages/<slug>` shows one of the store's content pages by its slug, for example `/pages/sfb-about`. Our marketing team prepares pages ahead of time: shoppers must not see a page before it is published.
- `/login` logs a customer in with email and password and tells the shopper when the credentials are wrong. When a customer is logged in, the header shows their first name and a 'Log out' button. Create the customer `<P>-shopper@example.com` to try it.
- Prices on the pages may be up to a minute old. The cart and the customer are never stale, and one shopper never sees another's.

No styling beyond what makes it usable. Leave the server stopped when you finish."

Checks:

1. The build passes. `/` lists the seven active products with the Frontend API's prices, the tee at 24 beside a struck 30, and not the retired one.
2. 'Available only' hides the vase and keeps the six others, the ones without stock tracking included.
3. A product page's HTML from the server holds the name and price. L / White shows the variant's price and stock; M / Black cannot be added. An unknown slug and the retired product answer with status 404.
4. A product added in a browser shows in the header count and on `/cart`, and is the cart of that browser's `swell-session` token when read from the Frontend API. A second visitor sees an empty cart and no customer.
5. The session cookie has an expiry, and browser code that uses it can read it.
6. `/pages/sfb-about` shows the page; `/pages/sfb-draft` and an unknown slug answer 404 and show nothing of the draft.
7. With a logged-in session the header shows the customer's first name; a wrong login is told apart by the `null` answer.
8. The code makes one client per request with a cookie adapter on the server, changes the cart outside rendering, and caches no cart or account read.

## 2. Guest checkout

Request: "We are building our own storefront for our Swell store with swell-js; it is not a Swell app. Write the checkout as a module our pages will call, `checkout.mjs`, and `play.mjs`, a Node 22 script that plays it against the store and prints what the shopper sees. The store id and a public key are in `.env`; `fixtures.json` names the products, coupon codes, gift cards and payment methods of the store.

`play.mjs <gift card code>` plays three guest shoppers, each in a browser session of their own. After every step it prints the totals the shopper sees: subtotal, discount, shipping, tax, total and the amount still to pay.

1. Shopper one puts two `sfb tee` in L / Black and one `sfb pen` with gift wrap in the cart. They enter the coupon `SFBOLD` — print what they are told — and then `SFB10`. They check out as a guest, `<P>-one-<time>@example.com`, with a US address, choose pickup, redeem the gift card and pay the rest with the test card. Print the lines with their unit prices, the discount, the gift card amount, the amount charged to the card and the order number.
2. They reload the confirmation page: print the order again, read from the store. Then they press 'Place order' a second time: no second order may come of it.
3. Shopper two buys one `sfb poster` as a guest, `<P>-two-<time>@example.com`, and pays cash on pickup. Print the order number and whether the order is paid.
4. Shopper three, `<P>-three-<time>@example.com`, puts two `sfb mug` in the cart and goes through the checkout with cash. We have one mug. Print what the shopper is told, and at which step.

Each run places new orders. Run it once with the first gift card of `fixtures.json` and keep the output in `run-1.txt`."

Checks, on a run by the verifier with an unused gift card:

1. Order one holds two tees with the L / Black variant and the pen with `Wrapped` at 14. The refusal of `SFBOLD` is printed from the store's answer, and the discount is 10% of the subtotal.
2. The gift card pays 5, a card payment on the `test` gateway pays the rest, the order is paid, and the printed card amount is the payment's.
3. The reload prints the same order, and the second submit leaves one order for that email.
4. Order two has the method `cash` and is not paid, and the script says so.
5. Shopper three is refused at the submit for stock, the message is printed, and no order exists for that email.
6. The totals printed after each step are the store's, with the amount to pay net of the gift card.
7. Each shopper has a client and session of their own.

## 3. Account and subscriptions

Request: "We are building our own storefront for our Swell store with swell-js; it is not a Swell app. Write the customer account area as a module our pages will call, `account.mjs`, and `play.mjs`, a Node 22 script that plays it against the store and prints what the customer sees. The store id and a public key are in `.env`; `fixtures.json` names the products of the store and the test card.

`play.mjs` plays one new customer, `<P>-<time>@example.com`, through these steps and prints the result of each:

1. Sign up with a name, the email and a password. Print who is logged in.
2. Log out. Log in with a wrong password: print what the customer is told. Log in with the right one.
3. Add a US shipping address and save the test card as the default card. Print the addresses and the saved cards (brand, last four digits).
4. Subscribe to the membership `sfb club` on the Monthly plan, paid with the saved card. Print the subscription — status, plan, price, next billing date — and what was charged.
5. Switch it to the Yearly plan. Print the subscription again and what was charged for the change.
6. They ask to cancel, but keep the membership until the end of the period they paid for. Print the subscription and whether they have access now.
7. They change their mind: withdraw the cancellation. This must not charge them. Print the subscription and what was charged.
8. Cancel the membership right now. Print the subscription and whether they have access.
9. Print their order history, and look up the order `000000000000000000000000`, which is not theirs: print 'Order not found'.
10. They forgot the password: start the recovery so that the link in the email opens `https://shop.example.com/reset`. Print what the customer is told.

`play.mjs reset <key> <new password>` is what that reset page runs with the key from the link: it sets the password, and the customer ends up logged in. Print who is logged in. (You cannot read the email; I will take a key from the store and try it.)

Each run plays a new customer. Run it once and keep the output in `run-1.txt`."

Checks, on a run by the verifier:

1. The account exists with its name, and the wrong password prints a message without an exception.
2. The account has one address and one card ending 4242.
3. The subscription starts on the Monthly plan at 18, active, with a paid invoice of 18 on the saved card.
4. After the switch it holds the Yearly plan at 180, the printed plan is Yearly, and the printed charge is what the store charged.
5. After step 6 it is canceled, set to stop at the end and still active, and access is printed as kept.
6. After step 7 it is not canceled and still active, and the store holds no payment from that step.
7. After step 8 it is canceled and not active.
8. The missing order prints 'Order not found'.
9. The recovery leaves a reset key on the account; `play.mjs reset` with it sets the password and prints the customer as logged in, and the new password logs in.

## 4. Reviews from an installed app

The working directory also holds `reviews-app.md`: the app's two collections with their fields and public declarations, and its public route `submit-review` (`POST` creates the logged-in customer's pending review, `GET` returns their own).

Request: "We are building our own storefront for our Swell store with swell-js; it is not a Swell app. Our store has a product reviews app installed; `reviews-app.md` is what its author gave us. Write the reviews part of our storefront as a module our pages will call, `reviews.mjs`, and `play.mjs`, a Node 22 script that plays it against the store and prints what the shopper sees. The store id and a public key are in `.env`; `fixtures.json` names the products of the store.

1. The listing: print every product of the category `sfb-shop` with its average rating and number of reviews, or 'no reviews yet'. The listing page must not send one request per product.
2. The product page of `sfb tee`: print its average, the number of reviews and the two newest reviews with author, rating, title and text. Then the same list with only the reviews of four stars and more.
3. A visitor who is not logged in submits a review of `sfb mug`: print what they are told.
4. A new customer, `<P>-<time>@example.com`, signs up and submits a review of `sfb mug`: five stars, a title and a text. Print what they are told. On the product page they see their own review marked 'awaiting approval': print that.
5. They submit a second review of `sfb mug`: print what they are told.
6. Print the reviews of `sfb mug` as another shopper sees them now.
7. Our designer asks whether the page can also show the reviews that are waiting for approval, greyed out, to everyone. Answer in `NOTES.md` in two or three sentences, from what you tried.

Each run plays a new customer. Run it once and keep the output in `run-1.txt`."

Checks, on a run by the verifier:

1. The listing takes one or two requests, shows the tee at 3 over 2 reviews and the poster at 5 over 1, and 'no reviews yet' for the rest, on a second run straight after the first too.
2. The tee's two reviews are printed newest first, and the four-star list holds the one review of 4.
3. The visitor is told to log in, from the route's 401.
4. The store holds one pending review of the mug for the new customer, and the script prints it from the route's `GET`.
5. The second submission prints a message from the route's refusal, and the store still holds one review.
6. Another shopper sees no review of the mug.
7. `NOTES.md` says a storefront cannot read pending reviews through the collection, and that it would take a change in the app.
