/** Clamp the chat pane width (px) so it keeps a sane minimum and always leaves
 *  room for the plan pane on the right. Pure — used by the draggable splitter. */
export function clampChatWidth(
  desiredPx: number,
  containerWidth: number,
  opts: { min?: number; reserveRight?: number } = {},
): number {
  const min = opts.min ?? 320;
  const reserveRight = opts.reserveRight ?? 360;
  const max = Math.max(min, containerWidth - reserveRight);
  return Math.min(Math.max(desiredPx, min), max);
}
