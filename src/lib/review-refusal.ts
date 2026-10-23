/**
 * A refusal a site raises from its own checks (`reverify`, `assertWriteState`, `beforeWallet`):
 * its line is shown as it is. Core shows its own lines and hides any other error's text, so a
 * site's line says what happened and what to do next.
 */
export class ReviewRefusal extends Error {
  readonly name = "ReviewRefusal";
}
