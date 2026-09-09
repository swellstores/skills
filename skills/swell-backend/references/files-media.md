# Files & Media

Binary assets live in one meta collection, `/:files`. Every `"type": "file"` field on every model — product images, option swatches, category images, shipment labels — holds a reference to one of those records.

## Uploading

```js
const file = await swell.post('/:files', {
  data: { $base64: buf.toString('base64') },
  content_type: 'image/jpeg',   // optional
  filename: 'shirt-front.jpg',  // optional
});
// → { id, url, filename, content_type, length, md5, date_uploaded }
```

**The `$base64` wrapper is mandatory for binary, and omitting it corrupts silently.** A bare string in `data` is stored as UTF-8 text: hand it a base64 string and the platform writes the base64 *characters* to a text file, returns 200, sets no `errors`, and gives you a working `url` that serves garbage. `md5` and `length` are the only tells — they describe the text, not your bytes. `{ $binary: '...' }` decodes to the same bytes at the storage layer but is **not** a safe substitute: it skips SVG screening entirely (see below). Any other wrapper key fails loudly with `Invalid file data`. Only the bare-string case is quiet. There is no multipart or raw-body upload.

`content_type` and `filename` resolve in this order, and only for values you omit:

1. `content_type` from the **filename extension** when you send a `filename` — the extension beats the bytes, so `filename: 'logo.png'` on JPEG data yields `image/png`.
2. `content_type` from magic bytes (`file-type` library).
3. `filename` as `file-{id}.{ext}` — but only when steps 1–2 produced a content type. If the content type ends up null the record gets **no filename at all**, and the url stops at `/{md5}`. A content type with no known extension yields a bare `file-{id}`.

The magic-byte library has no signature for SVG or any text format, so an SVG posted with neither field lands as `content_type: null`, no filename, and a url ending at the md5. Always pass `content_type: 'image/svg+xml'` explicitly.

**Size:** the API rejects any request body of 10,240,000 bytes or more with `Exceeded max request length (10240000)`. Base64 inflates payloads ~33%, so the practical ceiling is roughly 7.5 MB of binary per upload — chunking is not an option, so resize or compress instead. A `Swell-Upload-Exceptional: true` request header raises the cap to 25,600,000 bytes. `maxsize` exists as a per-field option (error code `MAX_FILE_LENGTH`) but no core commerce model declares one.

## The stored record

`id`, `length`, `md5`, `date_uploaded`, and `url` are computed — never write them. `width`/`height` exist on the file shape but the API never measures an image; they hold whatever you send, or nothing. Every other key you send is kept as custom metadata.

The CDN url is `https://cdn.swell.store/{store}/{fileId}/{md5}/{filename}` — content-addressed. Replacing a file's bytes keeps the file id but recomputes `md5`, so the `url` changes: re-read `url` from the record after any data update and treat every cached copy as stale. `{ private: true }` suppresses url generation entirely; those bytes are then reachable only through the API.

**`PUT /:files/{id}` carrying `data` drops every custom field on the record.** A data update is treated as a fresh file, so `alt_text`, `tags`, and anything else you had set are gone. A PUT *without* `data` merges and preserves them. Send new bytes and custom fields in the same request.

## SVG screening

Content declared `image/svg+xml` is XSS-screened, and a hit **throws** `Invalid SVG file` — one of the few write failures that does not come back as a `result.errors` object. The denylist is wider than the obvious: `<script>`, any `on*=` attribute, `javascript:`/`vbscript:`/`data:text/html` in `href`/`xlink:href`, `<foreignObject>`, `<!ENTITY>`, and also `<use>`, `<animate>`, `<animateMotion>`, `<animateTransform>`, `<set>`. Ordinary icon sprite sheets trip the `<use>` rule — inline the referenced symbols or rasterize.

Three conditions must all hold before a single pattern is tested: `content_type` is exactly `image/svg+xml`, `data` is present, and the decoded payload contains the substring `<svg`. The validator decodes `$base64` and reads bare strings, but it never decodes `{ $binary: '...' }` — that value stays an object, fails the string check, and passes unconditionally while storing identical bytes. `$binary` is a screening hole, not just an alias. And even when it runs this is a denylist against known vectors, not sanitization; do not lean on it for untrusted uploads.

## Attaching files to records

A `file` field takes either an inline upload or a reference to a file that already exists:

```js
await swell.post('/products', {
  name: 'Shirt',
  images: [
    { file: { data: { $base64: '...' } }, caption: 'Front' },  // uploads, creates the /:files record
    { file: { id: existingFileId } },                          // reuse, no re-upload
  ],
});
```

**Replacing a file reference deletes the file.** Any existing file whose id disappears from the write's merged result has its `/:files` record deleted, not orphaned. `{ images: { $set: [...] } }`, `$unset`, and writing a `file: { id }` over a different stored id all destroy the bytes. A plain merge PUT never deletes — the merge re-supplies the stored `file` objects — but it is not therefore safe: it can overwrite a kept file's bytes in place (next paragraph). That makes the `{ id }` reuse pattern fragile: a `$set` on product A's gallery deletes files product B still points at. Reuse an id only when you control every writer; otherwise upload per record.

**A plain PUT of `images` entries without `id`s overwrites existing slots, it does not append.** Id-less array elements merge **positionally by index**: your first entry merges into the stored `images[0]` — clobbering its caption and uploading your bytes into *that entry's existing file id* — your second into `images[1]`, and only entries past the end of the stored array append. A gallery re-sync therefore silently rewrites the list in place, and a plain PUT never shrinks it. `images[].id` is `auto`, but the id is assigned after the merge, so entries you post carry none and get no id-matching.

Address the three intents explicitly:

```js
// Append — $push (alias $post); leaves existing entries untouched
await swell.put(`/products/${id}`, {
  images: { $push: [{ file: { data: { $base64: '...' } }, caption: 'Back' }] },
});

// Edit one entry — send its stored id; id-bearing elements match anywhere in the array
await swell.put(`/products/${id}`, { images: [{ id: imageId, caption: 'New' }] });

// Replace wholesale — $set, and every file that falls out is deleted
await swell.put(`/products/${id}`, {
  images: { $set: [{ file: { id: keepFileId } }, { file: { data: { $base64: '...' } } }] },
});
```

Re-send `file: { id }` in a `$set` for every image you intend to keep — omit one and its bytes are gone. `variants[].images` and `options[].values[].images` merge by the same positional rule.

Known file fields: products `images[].file` and `variants[].images[].file` (both localized), `options[].values[].image`, `options[].values[].images[].file`; categories `images[].file` (and the deprecated `image.file`); shipments `label.image`. Elsewhere, read `GET /:models/<collection>` for `"type": "file"` rather than guessing.

## Reading bytes back

`GET /:files/{id}` returns metadata; `GET /:files/{id}/data` returns content. For a binary file that content arrives **base64-encoded inside a JSON string** — swell-node hands you a base64 string, not a Buffer. Send `X-Swell-Raw-Data: true` to get raw bytes with the file's own `Content-Type` instead. Text files come back as their text either way and the response carries no marker distinguishing the two, so branch on the record's `content_type`, never on the payload. Pulling file data through `expand`/`include` or `/:batch` base64-encodes **binary** content only — text comes back as text — and refuses any file over 25,600,000 bytes. For public files the CDN `url` is the cheap path — fetching bytes from the API that the CDN would serve burns rate limit for nothing.
