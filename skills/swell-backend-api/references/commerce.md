# Commerce Lifecycles

Accounts. Orders, payments, refunds, returns, invoices and subscriptions are in `references/orders-payments.md`, and products, variants and inventory in `references/products-inventory.md`. Verify shapes against `GET /:models/<collection>` for the exact store.

## Accounts, Auth & Credit

Accounts carry child collections `addresses`, `cards`, `credits`. `email` is required and unique; `balance` is read-only and follows the credit ledger.

### Verifying a password

`GET /accounts/:login` with `{ email, password }` returns the full account record on a match and **`null` on a miss** — no error, no 401, no distinction between a wrong password and a nonexistent email, so a truthiness check is the only way to tell. The comparison is bcrypt against the stored hash, and a match stamps `date_last_login`. (This is exactly what the storefront gateway calls behind `swell.account.login`.)

### Passwords on import

`password` is `format: 'password'`, which bcrypt-hashes it on write (cost 6). A value that already matches `$2a$`/`$2b$`/`$2x$`/`$2y$` plus a cost prefix is detected and stored **verbatim, not re-hashed** — a migration from any other bcrypt-based platform can carry hashes across directly and customers keep their passwords. Hashes in any other scheme (argon2, scrypt, PBKDF2, MD5) cannot be imported; those accounts need a reset flow.

### One-time login tokens (SSO handoff)

To log a customer into the storefront from your own system without their password, ask the platform for a token by writing **null**:

```js
const acct = await swell.put('/accounts/{id}', { id, password_token: null });
// → acct.password_token, a fresh 32-character alphanumeric string
```

The storefront then calls `swell.account.login(email, { password_token })`. The gateway looks the account up by that token, establishes the session, and `$unset`s the token — **strictly single use**. Nothing expires it, so treat an unredeemed token as a live credential: mint it at the moment of redirect, never in advance or in bulk. The mint guard reads **the value you send, not the value stored** — so every PUT carrying `password_token: null` mints a fresh token and overwrites any outstanding one, invalidating an unredeemed link and breaking an in-flight redirect. The call is not idempotent: mint exactly once per redirect and never retry it blindly.

### Deleting an account

`DELETE /accounts/{id}` **refuses** while the account has any linked `contacts`, `carts`, `orders`, `invoices`, or `subscriptions`, returning `{ errors: { orders: { message: "Unable to delete account when 'orders' are linked" } } }`. Any customer who ever built a cart is undeletable this way — the plain delete only works on genuinely untouched records.

The override is a `$force_delete: true` body on the DELETE, and it is bigger than it looks: it skips the guard **and** cascades, issuing real deletes for the account's carts, orders, invoices, and subscriptions. That destroys the store's financial history for that customer, irreversibly. Use it for test-data cleanup only. For a real erasure request, anonymize in place instead — overwrite `name`, `first_name`, `last_name`, `phone`, `email`, `notes`, `metadata`, and the `addresses`/`cards` children — remembering `email` is unique and required, so each account needs a distinct placeholder address rather than a shared one.

### Credit

Account credit accrues via `/accounts:credits` records (positive or negative `amount`) and pays orders through payments with `method: 'account'`. Refund-to-credit is a refund with `method: 'account'`.

An order spends the customer's credit by itself when it is created: `references/orders-payments.md` has the rule and the field that overrides it.
