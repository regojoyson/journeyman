import { ConnectionMode } from "@xyflow/react";

/**
 * Connection mode for the workflow canvas.
 *
 * Strict (not Loose): while dragging a wire from an output (source) handle,
 * the preview may only snap to input (target) handles. Every node's target
 * handle is on the left, so the in-drag preview snaps to the left input dot —
 * exactly where the dropped edge is routed. Loose mode let the preview latch
 * onto a node's right-side source handle mid-drag, then jump to the left on
 * drop, which looked broken. Strict mode also rejects invalid same-type
 * connections (output->output, input->input).
 */
export const CANVAS_CONNECTION_MODE = ConnectionMode.Strict;
