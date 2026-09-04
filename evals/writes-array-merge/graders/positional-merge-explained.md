---
type: llm
criteria: |
  The response must state that a plain PUT of an array MERGES rather than replaces, and specifically
  that a scalar array merges BY POSITION: sending ["sale"] over ["new","summer","clearance"] leaves
  ["sale","summer","clearance"] — the first element is overwritten and the rest survive.
  It must give a correct way to replace the array outright, using the $set operator (either
  { tags: { $set: [...] } } or a top-level $set).
  FAIL if it claims the plain PUT replaces the whole array, that it appends "sale" to the end, that
  arrays behave like a normal REST overwrite, or if it offers no operator-based replacement.
---
Positional array merge is the single most damaging Swell write behaviour: it silently rewrites
existing elements and never shrinks the array. Models default to assuming PUT replaces.
