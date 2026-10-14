/** The split of a wide screen: a list on the left, what is open on the right. */

export const TABLET_MIN_WIDTH = 768

/** A window this wide shows the list and the open chat side by side. */
export function isWide(width: number): boolean {
  return width >= TABLET_MIN_WIDTH
}

/** The width of the list beside an open chat: about a third, never narrower than a phone row needs. */
export function listPaneWidth(width: number): number {
  return Math.round(Math.min(420, Math.max(320, width * 0.36)))
}
