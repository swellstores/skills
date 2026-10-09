# Writes

Creating, updating and deleting records on the Backend API: how an update merges, the update operators, child records, what a write sets off, imports, batch requests and transactions. This reference says what the API does with a request. How a refused write or an error reaches the code differs by client and is in `SKILL.md`, "Errors, Rate Limits, Retries".

## What a write does

- **`POST /<collection>` creates a record** and answers with it.
- **`PUT /<collection>/<id>` updates a record by merging** the body into what is stored, and answers with the whole record as it is afterwards.
- **A `PUT` to an id that does not exist creates a record with that id.** It is validated as a new record, so required fields are asked for. Read the record first when the code must not create one.
- **`DELETE /<collection>/<id>` removes the record for good** and answers with what it removed. Orders and subscriptions are no exception. Canceling one is an update, not a delete: `references/orders-payments.md`.
- **A write that fails field validation writes nothing** and answers with `{ errors }`.
- **Nothing can be undone.** There is no history and no rollback outside a transaction. Run operator writes and writes over many records against test records first.

## An update merges

Fields the body does not send are kept, at every depth of nested objects. Arrays merge as well, in one of two ways:

- **Elements with an `id` merge by id.** An element whose id is stored merges into that element, wherever it sits. An element with an unknown id is added at the end.
- **Elements without an `id` merge by position.** This covers every array of plain values, such as `tags`. Element 0 of the body lands on stored element 0, element 1 on element 1: a value replaces what is in the slot, an object merges into it.

An array never gets shorter on a plain update, and sending `[]` changes nothing.

With `tags` stored as `['new', 'summer', 'x']`, `PUT /products/<id>` with `{ tags: ['sale'] }` gives `['sale', 'summer', 'x']`: not `['sale']`, and not `['new', 'summer', 'x', 'sale']`.

Merging by id is the way to change one element and leave the rest: `{ options: [{ id: optionId, name: 'New label' }] }`. The same body without the `id` renames whichever option is first.

## Replacing and editing

Operators say what the merge cannot. They come in two forms, and both can share a body with plain fields that merge.

**On the field itself**, for arrays. `PUT /products/<id>` with:

```js
{ tags: { $set: ['a', 'b'] } }    // replace the array
{ tags: { $push: 'c' } }          // add at the end
{ options: { $unset: [0, 2] } }   // remove the elements at these indexes
```

`$unset` takes indexes, and `':last'` for the last element.

**At the top level of the body**, MongoDB-style, with dotted paths and numeric array indexes:

| Operator | Does |
| --- | --- |
| `$set` | Sets or replaces the value at a path: `{ $set: { 'attributes.materials': ['cotton'] } }` |
| `$unset` | Removes a field: `{ $unset: { cost: true } }`. On an array element it leaves `null` in the slot; use the form on the field to remove elements |
| `$inc` | Adds to a number, a negative amount included, and sets it when the field is absent |
| `$push` | Adds to an array; `{ $push: { tags: { $each: ['a', 'b'] } } }` adds several |
| `$addToSet` | Adds to an array unless the value is already there |
| `$pull` | Removes every element that matches a value or a condition: `{ $pull: { tags: { $in: ['a', 'b'] } } }` |
| `$rename` | Renames a field, and removes a field that already has the new name |

`$[]` in a path applies an operator to every element of an array: `{ $pull: { 'options.$[].values': { name: 'XL' } } }`.

Where an id is supplied instead of generated, in a `$set` or on a new nested element, it must be a 24-character hexadecimal ObjectID.

## App fields on a standard record

An app's fields live under `$app.<app_id>` and merge like the rest of the record. The operators take different forms there. `PUT /products/<id>` with:

```js
// Replace one field: $set directly inside the app's object
{ $app: { my_app: { $set: { badges: ['new'] } } } }
// Replace everything the app stores on the record; other apps' data is untouched
{ $app: { $set: { my_app: { badges: ['new'] } } } }
// Remove a field: a dotted path starting with the app id
{ $app: { $unset: ['my_app.badges'] } }
```

- **The form on the field does not replace inside `$app`.** `{ $app: { my_app: { badges: { $set: ['new'] } } } }` does not leave `['new']`. Use the first form above.
- **`$unset` with only the app id is ignored.** An app's whole object is replaced, not removed.
- **The top-level operators reach an app field by its path:** `{ $inc: { '$app.my_app.points': -5 } }`.

## Child records through the parent

Records of a child collection can be written through their parent by putting them in the parent's body:

- **With an `id` the child is updated:** `PUT /accounts/<id>` with `addresses: [{ id, phone }]` changes that address.
- **Without an `id` a child is created**: `addresses: [{ address1, city }]` adds an address and never edits one. Only an address equal in every field to a stored one is not added again.
- **A linked record is written the same way:** `PUT /orders/<id>` with `account: { … }` writes those fields to the order's account.

Each child is its own write, made one after another. When one fails, those before it stay written. Child collections also have paths of their own (`/accounts:addresses`, `/products:variants`) for reading and writing them directly.

## What a write sets off

Every write is recorded as an event, and the store's webhooks, app functions and notification emails react to it exactly as they do to a change made in the dashboard. Before an import or a backfill, work out what each write will trigger.

Two flags in the body of a write switch that off, each for its own part:

| Flag | Stops | Does not stop |
| --- | --- | --- |
| `$events: false` | The event record, and with it webhooks and app functions | Notification emails |
| `$notify: false` | Notification emails | The event, webhooks and app functions |

An import that must be silent sends both: `POST /orders` with `{ ...order, $events: false, $notify: false }`.

- **Neither flag stops the store's own logic.** An order still takes stock and a payment still updates its order.
- **In a batch the flags go inside each operation's `data`.**
- **`swell api` cannot switch events off.** A write made with it is always recorded. `$notify: false` works there.
- **Emails to real addresses are limited.** Swell deactivates a store that sends many emails for its size, a new store soonest, and sends from the test environment count. Seed and import with `$notify: false`. Where a test needs the notification itself, address the customer at `example.com`: the email is rendered and logged, but never delivered or counted.

Operations inside a transaction fire no events of their own in any case: see "Transactions".

## Keeping ids and dates on import

A value in the body is used in place of the one the platform would generate. `id` and `date_created` can be supplied on a `POST`, and so can `number` on an order, invoice or return. Keeping ids keeps every reference between imported records valid, so collections can be imported in any order. `POST /products` with:

```js
{
  id: '5f8a1c2e3d4b5a6c7d8e9f01', // 24 hexadecimal characters
  date_created: '2025-11-03T14:22:00Z',
  name: 'Imported product',
  price: 20,
}
```

- **An `id` in any other format is dropped without an error**, and the record gets a generated one.
- **A `POST` with an `id` that already exists writes over that record.** It does not fail and it does not add a second one: the body is merged into the stored record, and `date_created` and fields with defaults are set again. An import that runs twice therefore rewrites what the first run created.
- **`number` can be set when the record is created and not changed afterwards.**

## Localized and per-currency values

- **`$locale: { fr: { name: 'Chaise' } }`** beside the regular fields sets values for a language. For a nested field, put `$locale` on the object that holds the field.
- **`$currency: { EUR: { price: 14 } }`** sets a price in a currency, wherever price fields are: the product, its purchase options, options and variants.
- **Selling in a currency is the `currency` field of the cart or order**, not `$currency`. With a currency the store prices in, the items are priced in it and each needs a price there. With a display currency, the order records `display_currency` and is charged in the base currency. The currency cannot change once a payment exists.

## Batch

Several requests in one call. They run 10 at a time and independently: one failing does not stop or undo the others. `POST /:batch` with an array of operations:

```js
[
  { method: 'post', url: '/products', data: { name: 'A', price: 10 } },
  { method: 'put', url: '/products/<id>', data: { active: true } },
  { method: 'get', url: '/products/:count' },
]
```

- **Up to 1,000 operations**, reads included. An operation without a `method` takes the method of the batch request.
- **The answer is an array in the order sent**, each entry being what that request would have answered alone, so a read or a delete of a missing id is `null`.
- **A failed entry has one of two shapes.** `{ errors: { <field>: { code, message } } }` for a write that failed validation, and `{ $error: '<message>' }` for a path that does not exist or a request that is not permitted. Check every entry for both keys: code that looks only for `$error` takes a refused write for a success.
- **Sent as an object instead of an array**, the answer comes back under the same keys.
- **`/:batch/<collection>`** resolves each `url` inside that collection, so an operation's `url` can be a bare id.

## Transactions

A short set of writes that are committed together. `POST /:transaction` with an array of operations:

```js
[
  { method: 'post', url: '/orders', data: { /* … */ } },
  { method: 'put', url: '/accounts/<id>', data: { /* … */ } },
]
```

A function's `req.swell` and the Apps SDK Backend client have `transaction(ops, { retry })` for the same call; a workflow cannot make it.

- **1 to 10 operations, writes only.** Each is a `post`, `put` or `delete`; one without a `method` is a `post`. A `get`, an empty array or an eleventh operation is refused with status 400 before anything runs. Read what the writes need before the transaction.
- **The answer is an array in the order sent**, each entry being the record that operation wrote. A `delete` of an id that does not exist is `null`, not an error, and a `put` to one creates the record, as outside a transaction.

**Not every failure rolls the set back.**

| An operation | The set | The caller gets |
| --- | --- | --- |
| is refused or cannot run: a path that does not exist, a permission it lacks, a write conflict, a timeout | **Rolled back.** Nothing is written | An error with a code from the table below |
| fails field validation | **Not rolled back.** That operation writes nothing and every other one is committed | The array, with `{ errors }` in that operation's place |

So a successful answer does not mean every operation was written. Check each entry for `errors`.

**An app's fields are not written in a transaction.** A value under `$app.<app_id>` in an operation's body is dropped without an error, and the rest of that body is stored. Write an app's fields in a direct request or a batch.

Errors carry a code in their body, `{ error: { code, message, status } }`:

| Code | Status | Retry | When |
| --- | --- | --- | --- |
| `transaction_op_failed` | The operation's own, such as 403 or 404 | No | An operation was refused. The only code with `op_index`, the position of that operation |
| `transaction_error` | 400 | No | The request itself was refused: a `get`, an empty array, too many operations |
| `transaction_error` | 503 | No | The database could not run the transaction |
| `transaction_conflict` | 409 | Yes | Another write touched the same records, and about two seconds of retrying inside the platform did not clear it |
| `transaction_throttled` | 429 | Yes | The store has too many transactions in progress |
| `transaction_timeout` | 408 | No | An operation or the commit ran out of time |

**The operations fire nothing of their own.** No event is recorded for them, so no webhook, app function or notification runs, and model hooks do not run either: an app's `before:` hook that fills in or rejects a record is skipped for a write made inside a transaction. A committed transaction records one `transaction.committed` event, with every operation's method, collection and resulting record in `data.ops`. A transaction that is rolled back records nothing.

**Keep a transaction short.** Its operations run one after another within a budget of seconds. Use a transaction where the writes must agree with each other, such as an order with its stock and credit, and a batch where the aim is volume.
