# Accounts

Customer accounts: checking a password, importing passwords, logging a customer in from another system, deleting an account, and account credit. Field shapes are in `GET /:models/accounts`.

`email` is required and unique, compared without case: a second account with the same address is refused with code `UNIQUE`.

## Passwords

- **Checking a password is a read.** `GET /accounts/:login` with `{ email, password }` answers with the account on a match and with an empty body otherwise. A wrong password and an unknown email get the same answer, and neither is an error, so test the result for a value.
- **A bcrypt hash is stored as it is.** `password` is hashed on write, unless the value is already a bcrypt hash (`$2a$`, `$2b$`, `$2x$` or `$2y$`). Accounts imported from a platform that used bcrypt keep their passwords. A hash of any other scheme cannot be imported: those customers need a password reset.

## A one-time login token

To log a customer into the storefront from another system without the password, ask for a token by writing `null`. `PUT /accounts/<id>` with:

```js
{ password_token: null }
// the answer carries password_token, a new 32-character string
```

The storefront then logs in with `swell.account.login(email, { password_token })`, which clears the token, so it works once.

- **Nothing expires an unused token.** Create it at the moment of the redirect, never in advance or in bulk.
- **Every such write creates a new token and cancels the one before it.** A request that is sent again breaks a redirect that is already on its way.

## Deleting an account

`DELETE /accounts/<id>` is refused while the account has carts, orders, invoices, subscriptions or contacts. The error is on the name of the linked collection: `errors.carts` reads `Unable to delete account when 'carts' are linked`. A customer who ever filled a cart cannot be deleted this way.

For an erasure request, overwrite the personal data in place: `first_name`, `last_name`, `name`, `phone`, `notes`, `metadata`, and the addresses and cards. `email` is required and unique, so give each account its own placeholder address.

## Credit

`balance` is read-only: it is the sum of the account's `/accounts:credits` records. `POST /accounts:credits` with `{ parent_id, amount }` adds credit, and a negative `amount` takes it away. A record that would take the balance below zero is refused with an error on `balance`.

**Name `currency` beside `balance` in a `fields` list.** A read with `fields: 'balance'` alone answers `0`, whatever the balance is.

An order spends the customer's credit by itself when it is created. `references/orders-payments.md` has that rule and the field that overrides it, and the payments and refunds with `method: 'account'`.
