/**
 * Production CSS minify writes Tailwind's one-backslash selector escapes
 * (`hover\:bg-accent`) as three backslashes. The browser then looks for a
 * class that contains a backslash, so hover, focus, and selected-state
 * utilities never match. Collapse those runs back to a single escape.
 */
function fixTailwindSelectorEscapes(css) {
  return css.replace(/\\{2,}(?=[:[\]=.#!()/%,>+~*])/g, "\\")
}

module.exports = { fixTailwindSelectorEscapes }
