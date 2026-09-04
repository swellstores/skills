A product in our Swell store currently has `tags: ["new", "summer", "clearance"]`.

Using swell-node, write the call that leaves it with exactly `["sale"]` and nothing else. Also tell me what would happen if I instead sent a plain `swell.put('/products/{id}', { id, tags: ['sale'] })`.
