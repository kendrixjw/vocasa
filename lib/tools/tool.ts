// Tool state machine. One tool is active at a time; ESC cancels back to the
// select tool. Tools receive the Editor and drive it through commands — they
// never mutate the model directly.

import type { Point } from "../viewport.ts";
import type { Editor } from "../editor.ts";

export type PointerInfo = {
  world: Point;
  screen: Point;
  button: number;
  shiftKey: boolean;
};

export interface Tool {
  readonly name: string;
  onPointerDown?(e: PointerInfo, ed: Editor): void;
  onPointerMove?(e: PointerInfo, ed: Editor): void;
  onPointerUp?(e: PointerInfo, ed: Editor): void;
  onKeyDown?(key: string, ed: Editor): void;
  /** Reset any in-progress state (called on ESC and on tool switch). */
  cancel?(ed: Editor): void;
  /** Draw the tool's in-progress preview / snap markers, in screen space. */
  drawOverlay?(ctx: CanvasRenderingContext2D, ed: Editor): void;
  /** CSS cursor for the canvas while this tool is active. */
  cursor(ed: Editor): string;
}
