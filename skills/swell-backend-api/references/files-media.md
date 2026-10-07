# Files and media

Files are records of one collection, `/:files`. Every field of type `file` on any model — product images, option swatches, category images, shipment labels — holds a reference to one of them. Merge rules and operators are in `references/writes.md`.

## Uploading

`POST /:files` with:

```js
{
  data: { $base64: buffer.toString('base64') },
  content_type: 'image/jpeg', // optional
  filename: 'shirt-front.jpg', // optional
}
// answers { id, url, filename, content_type, length, md5, date_uploaded }
```

- **The bytes go in a `$base64` wrapper.** A bare string in `data` is stored as text. Send base64 without the wrapper and the platform stores the base64 characters, answers with a record and a working `url`, and serves garbage. `length` and `md5` are the only signs: they describe the text, not the bytes. There is no multipart or raw-body upload.
- **`content_type` comes from the filename's extension when it is not sent**, and from the bytes only when there is no filename. `filename: 'logo.jpg'` on PNG data gives `image/jpeg`.
- **`filename` defaults to `file-<id>.<ext>`**, and only when a content type was found. Otherwise the record has no filename and its `url` ends at the md5.
- **An SVG is not recognised from its bytes.** Posted with neither field it gets no content type and no filename. Send `content_type: 'image/svg+xml'`.
- **A request body is limited to 10,240,000 bytes**, and a larger one is refused with `Exceeded max request length`. Base64 adds a third, so about 7.5 MB of binary fits. An upload cannot be sent in parts: resize or compress the file.

## The stored record

- **`id`, `length`, `md5`, `date_uploaded` and `url` are computed.** `width` and `height` are not measured: they hold what was sent. Any other key sent is kept on the record.
- **`url` is `https://cdn.swell.store/<store>/<file id>/<md5>/<filename>`**, so new bytes under the same id change it. Read `url` again after an update of `data`, and treat stored copies of the old one as stale.
- **`private: true` gives a record without a `url`.** Its bytes are reachable only through the API.
- **`PUT /:files/<id>` with `data` is treated as a new file under the same id.** The filename, `width`, `height` and every custom field are dropped unless the same request sends them again. A `PUT` without `data` merges and keeps them.

## SVG screening

An upload sent with `content_type: 'image/svg+xml'` is screened for scripting. A hit is refused as an HTTP error with the message `Invalid SVG file`, not as an `errors` map. Beyond `<script>`, `on…=` attributes and `javascript:` links, the screen refuses `<foreignObject>`, `<use>` and the animation elements, so an ordinary icon sprite sheet fails on `<use>`: inline the symbols or rasterise the image. The screen is a list of known patterns, not sanitisation. Do not rely on it for files from untrusted users.

## Attaching files to records

A `file` field takes an upload in place, or the id of a file that exists. `POST /products` with:

```js
{
  name: 'Shirt',
  images: [
    { file: { data: { $base64: '…' } }, caption: 'Front' }, // uploads and creates the /:files record
    { file: { id: existingFileId } }, // points at an existing file
  ],
}
```

**A file that leaves a record is deleted.** When a write removes or replaces a file reference, the `/:files` record it pointed to is deleted with its bytes, whether or not another record uses it. That covers a `$set` on `images`, an `$unset`, a different `file: { id }` written over a stored one, and deleting the record itself. A `$set` on product A's gallery deletes a file that product B still shows. Share a file id between records only when every writer is yours. Otherwise upload per record.

**A plain `PUT` of `images` does not append.** Entries without an `id` merge by position, as `references/writes.md` describes. The first entry lands on the stored first image: it replaces the caption and uploads the new bytes into that image's existing file. A gallery sync by plain `PUT` therefore rewrites images in place and never removes one. State the intent instead, with `PUT /products/<id>` and one of:

```js
// Append
{ images: { $push: [{ file: { data: { $base64: '…' } }, caption: 'Back' }] } }
// Edit one entry, by its stored id
{ images: [{ id: imageId, caption: 'New' }] }
// Replace the list; every file left out is deleted
{ images: { $set: [{ file: { id: keepFileId } }, { file: { data: { $base64: '…' } } }] } }
```

In a `$set`, send `file: { id }` for each image to keep. `variants[].images` and `options[].values[].images` follow the same rules.

File fields on the standard models: `images[].file` on products, variants and categories, `options[].values[].image` and `options[].values[].images[].file` on products, and `label.image` on shipments. For any other model, read `GET /:models/<collection>` for fields of type `file`.

## Reading bytes back

`GET /:files/<id>` answers with the record, and `GET /:files/<id>/data` with the content. Binary content arrives as a base64 string and text as the text itself. Nothing in the answer says which, so decide from the record's `content_type`. For a public file, fetch the `url`: the CDN serves it without using the store's rate limit.
