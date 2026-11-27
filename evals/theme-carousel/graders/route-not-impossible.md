---
type: llm
criteria: |
  The response must say that carousels with arrows, dots and swiping can be built in a Wave theme
  section without script (for example a CSS scroll-snap strip, with arrows and dots as links to the
  slides), and that slides advancing on a timer can't run in theme section code because sections
  render on the server and can't use timers or scripts. It must name a route for the timed part or
  say plainly that it isn't available in a theme section: an app's embed block can run a script in
  the page. FAIL if it says carousels are not possible in Wave, or if it proposes `onClick`,
  `setInterval`, `useEffect` or a `script` element in section code.
---
Theme sections can't run code in the browser, so a model either declares carousels impossible or
writes event handlers and timers that `swell theme check` refuses. Both are wrong.
