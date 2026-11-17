# OAuth connections

Providers (TikTok, Google, Meta…) allow a fixed list of redirect URLs, but every store has its own domain. Swell gives each app **one callback URL** for every store and routes the provider's redirect to the app's callback function in the right store and environment. The developer's client secret stays in app secrets (`references/settings.md`); the merchant's token goes into the app's settings.

## 1. Register the callback URL with the provider

`swell app info` prints it as `OAuth callback`:

```
https://swell.store/integration/api/apps/<app record id>/oauth/callback
```

- The id is the app record's id (`.swellrc`), not the slug in `swell.json`. Each app record has its own URL: a copy of the app pushed from another store is another app with another URL.
- Register the URL of every platform you test on (a development environment has its own base URL). Providers usually allow several.

## 2. Keep the developer's credentials in app secrets

```bash
swell app secret set TIKTOK_APP_ID
swell app secret set TIKTOK_APP_SECRET
```

## 3. Declare where the token goes

A settings field the merchant sees but can't edit, in a group of its own (the group's name is the file name):

```json
// settings/connection.json
{
  "label": "TikTok connection",
  "fields": [
    { "id": "access_token", "type": "secret", "label": "Access token", "readonly": true },
    { "id": "advertiser_ids", "type": "short_text", "label": "Advertiser accounts", "readonly": true }
  ]
}
```

`readonly` limits only the dashboard: the callback writes the field with `PUT /settings/<app_id>`, and a dashboard save never writes a read-only field back.

## 4. Start the flow

From a route the merchant calls, such as one the app's dashboard UI calls:

```ts
// functions/tiktok-connect.ts
export const config: SwellConfig = { route: { methods: ['post'] } };

export default async function (req: SwellRequest) {
  if (!req.swellContext?.storeUser) {
    throw new SwellError('Forbidden', { status: 403 });
  }

  const { state, redirectUri } = await req.oauth.start({
    callback: 'tiktok-callback', // the route function that receives the redirect
    // data: { codeVerifier },   // optional, returned to the callback, never sent to the browser
  });

  const url = new URL('https://business-api.tiktok.com/portal/auth');
  url.searchParams.set('app_id', req.appSecrets.TIKTOK_APP_ID!);
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', redirectUri);
  return { url: url.toString() };
}
```

- `state` is an opaque random id. Swell keeps what it stands for: the store, environment, install, callback and `data`. It expires in 10 minutes and works once.
- `callback` must name a route function of the app that answers GET (no `route.methods`, or one that includes `get`). `start()` refuses any other with `oauth_callback_invalid`.
- `data` is JSON up to 2 KB for values the callback needs and the browser must not see, such as a PKCE `code_verifier` (`oauth_data_too_large` over it).
- The UI opens a window on the click (`const w = window.open('about:blank')`) and sets `w.location = url` after the call returns: a window opened after an awaited call is blocked as a popup. The provider page can't run inside the app frame.

## 5. Handle the callback

```ts
// functions/tiktok-callback.ts
export const config: SwellConfig = { route: { methods: ['get'] } };

export default async function (req: SwellRequest) {
  const callback = req.oauth.callback;
  if (!callback) {
    throw new SwellError('Not an OAuth callback', { status: 400 });
  }

  if (callback.params.error) {
    return { redirect: req.app.admin_url }; // the merchant cancelled
  }

  const res = await fetch(
    'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: req.appSecrets.TIKTOK_APP_ID,
        secret: req.appSecrets.TIKTOK_APP_SECRET,
        auth_code: callback.params.auth_code,
      }),
    },
  );
  const { data } = await res.json();

  await req.swell.put(`/settings/${req.appId}`, {
    connection: {
      access_token: data.access_token,
      advertiser_ids: data.advertiser_ids.join(', '),
    },
  });

  return { redirect: req.app.admin_url };
}
```

- Swell checks the state (known, not expired, not used, this app's) and that the install is still installed before calling the function. `req.oauth.callback` is `{ params, data, name }` on that call only, and `null` on any other call: a caller can't fake it.
  - `params`: every parameter the provider sent, as raw strings, from the query string or from the form body when the provider posts the response (`response_mode=form_post`). Swell doesn't interpret them.
  - `data`: what was passed to `start()`.
- The callback is always called with GET, whatever method the provider used. It can be non-public: Swell calls it internally, not through the storefront gateway. It always runs on Swell's workers, never on a `swell app dev` machine, so it has `req.appSecrets`.
- Return `{ redirect }` to send the merchant's window to the app's page in the dashboard (`req.app.admin_url`, or a path under it) or to the app's frontend in that store. Any other target is replaced by the app's dashboard page, which is also the default. A callback that fails shows the merchant a page with a link back to the app.
- The relay's page answers an expired or reused state with "connect again".

## 6. Use the token

In any function, or in a workflow through its `settings` operation:

```ts
const { connection } = await req.swell.settings();
if (!connection?.access_token) {
  return; // not connected yet
}
```

## Local development and tests

- `swell app dev` runs hooks and actions locally with an empty `req.appSecrets`. Settings, the token among them, read the same way locally, so a connected store works end to end. Connect once through the deployed flow (`swell app push`, then Connect): the callback runs on Swell either way.
- Unit tests pass a fake `req` with `appSecrets`, `oauth.start` and `oauth.callback`.
- A `secret` settings field is still readable by store staff and by other apps with access to settings (`references/settings.md`).
