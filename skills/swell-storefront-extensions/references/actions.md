# Actions — `storefront.actions`

An action is a form a theme posts to one of the app's functions. The storefront checks the form, calls the function and applies the answer itself: it adds cart lines through Swell's own cart, so Swell prices them; it shows a message on the next page; or it redirects. The function changes neither the cart nor the session: it answers with effects.

There is no effect that applies a discount or a coupon to the cart. A redeem or promo form creates a coupon code (or store credit) and shows it in the message or on a page that lists it. There is no date field type: use `text` with `max: 10` and check the format in the function.

```json
{
  "storefront": {
    "actions": [
      {
        "id": "price_match",
        "label": "Ask for a price match",
        "description": "A shopper asks us to match a lower price they found",
        "function": "storefront-price-match",
        "fields": [
          { "id": "product_id", "type": "hidden", "required": true, "max": 24 },
          { "id": "competitor", "type": "text", "required": true, "max": 100 },
          { "id": "competitor_price", "type": "number", "required": true },
          { "id": "email", "type": "email", "required": true }
        ],
        "effects": ["message"]
      }
    ]
  }
}
```

| Key | Description |
| --- | --- |
| `id`, `label` | 1–40 of `a-z`, `0-9`, `_`; 1–80 characters. `description` optional, 1–300 |
| `function` | The app function the storefront calls, 1–60 of `a-z`, `0-9`, `-` |
| `requires` | `none` (default) or `account`: a guest is sent to sign in, then back to the form's page |
| `fields` | 1–30 `{id, type, required?, max?, options?}`. Every other submitted field is dropped |
| `effects` | One or more of `cart_add`, `message`, `redirect`, `reload`. Only listed effects are applied |

| Field type | Default `max` | Highest `max` | The function gets |
| --- | --- | --- | --- |
| `text` | 500 | 5,000 | a trimmed string |
| `textarea` | 5,000 | 50,000 | a trimmed string, line breaks kept |
| `email` | 254 | 254 | a string with an `@` and a domain |
| `number` | 30 | 30 | a number |
| `boolean` | – | – | `true` or `false` (a checked box is `true`) |
| `select` | 100 | 100 | one of `options` (1–100 strings of 1–100 characters) |
| `hidden` | 500 | 500 | a string |

A field `id` is a lowercase letter and up to 39 of `a-z`, `0-9`, `_`. `max` is allowed only on `text`, `textarea` and `hidden`. An app can declare up to 20 actions.

## The form in a theme

In themes built with ui-kit, only `AppAction` may post to the action route (Wave's is `/__site/actions/<app>/<action>`); the storefront refuses any other form, button or link pointing there.

```typescript
import { AppAction } from 'ui-kit';

const flash = site?.app_flash?.app === 'deals' && site.app_flash.action === 'price_match' ? site.app_flash : null;

<AppAction app="deals" action="price_match" returnTo={site?.page?.path} flash={flash}>
  {({ values, errors }) => (
    <>
      <input type="hidden" name="product_id" value={product.id} />
      <label>{t('deals.competitor')}<input name="competitor" required defaultValue={values.competitor} /></label>
      {errors.competitor ? <p role="alert">{errors.competitor}</p> : null}
      <label>{t('deals.price')}<input name="competitor_price" type="number" step="0.01" defaultValue={values.competitor_price} /></label>
      <label>{t('common.email')}<input name="email" type="email" required defaultValue={values.email} /></label>
      <button type="submit">{t('deals.ask')}</button>
    </>
  )}
</AppAction>
```

`AppAction` renders a form posting to the action, with a hidden `_return` holding `returnTo`. Name each input after a declared field's `id`. It shows the form error above the fields; children given as a function get the shopper's `values` and per-field `errors`. `flash` is the page's `site.app_flash` when it names this app and action. Labels and button words are Store text in the theme.

## What the storefront checks

Before calling the function, the storefront refuses a post that comes from another origin or a frame, isn't a URL-encoded form of at most 64 KB, names an action the app doesn't declare, comes from a guest when the action `requires` an account, or goes over 20 posts a minute from one shopper to one app. It then checks each declared field's type, `max`, `options` and `required`, and drops undeclared fields. A field that fails comes back on the form with the shopper's values and an error, and the function isn't called.

These checks, the origin checks and the rate limit happen in the storefront, not on the route: the function is a public route that anyone can call directly with any body, skipping all of them. Re-check the type and length of every input field you use, and limit writes per account or per email inside the function.

## The request

The function is a public POST route (`route: { public: true, methods: ['post'] }`) called with the shopper's session, so `req.session.account_id` is the signed-in customer, or empty for a guest:

```json
{
  "bridge": 1,
  "kind": "action",
  "id": "price_match",
  "input": { "product_id": "…", "competitor": "Another shop", "competitor_price": 199, "email": "shopper@example.com" },
  "cart_id": "…",
  "locale": "en-US",
  "currency": "USD",
  "storefront_id": "…"
}
```

On a call from the storefront, `input` holds only the declared fields, already checked; a direct call can send anything. `cart_id` is the shopper's cart as the storefront knows it, or `null`: act on it only when it belongs to `req.session.account_id`, never for a guest, and prefer answering with `cart_add`, which the storefront applies to the shopper's own cart. Look records up again in the function (`req.swell.get('/products/<id>')`) rather than trusting names or prices in the input.

## The answer

A JSON object with the effects to apply; the storefront waits at most 10 seconds.

```json
{
  "cart_add": [{ "product_id": "…", "variant_id": "…", "quantity": 1 }],
  "message": { "text": "Thanks! We'll email you a deal.", "tone": "success" },
  "redirect": "/account",
  "reload": true
}
```

| Key | Description |
| --- | --- |
| `cart_add` | At most 100 lines of `{product_id, variant_id?, quantity}`, quantity 1–9999. Swell prices them, group prices and tiers included: never send a price. If Swell refuses a line, the shopper sees an error instead of your message. |
| `message` | `{text, tone}`: 1–300 characters, tone `info` (default), `success` or `error`. Shown once, at the start of the next page's content. The text comes from the function, not the theme's Store text: write it in the request's `locale`. |
| `redirect` | A storefront path, at most 500 characters, starting with `/` and not `//` or `/\`. Without one, the shopper goes back to the form's page. |
| `reload` | `true` shows the form's page again with fresh data. A data source with a `cache` above 0 may show its kept value until the cache expires: keep sources that a form changes at `cache: 0` (the default for an `account` collection source). |
| `errors` | Field ids, or `_form`, mapped to messages of 1–300 characters. The form comes back with the shopper's values and these errors, and no other effect applies. |

Keys the action doesn't list in `effects` are ignored. An answer that isn't a JSON object, has invalid `cart_add` lines, has a non-2xx status or times out shows a generic error on the form, so **a function that refuses returns `errors` with a 2xx status**. The storefront carries the message, errors and values to the next page in a one-time cookie; values of `hidden` fields are never carried back.
