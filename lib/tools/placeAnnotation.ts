// Annotation tool: click anywhere to drop a text note. The click asks the host
// to open an inline text editor at that point (the host commits the note via
// editor.addAnnotation). The tool stays armed so several notes can be added.

import type { Editor } from "../editor.ts";
import type { PointerInfo, Tool } from "./tool.ts";

export class AnnotationTool implements Tool {
  readonly name = "annotation";

  cursor(): string {
    return "text";
  }

  onPointerDown(e: PointerInfo, ed: Editor): void {
    if (e.button !== 0) return;
    ed.requestAnnotation(e.world);
  }

  onPointerMove(_e: PointerInfo, ed: Editor): void {
    ed.setStatus("Click to place a note");
  }

  onKeyDown(key: string, ed: Editor): void {
    if (key === "Escape") ed.setStatus("");
  }

  cancel(ed: Editor): void {
    ed.setStatus("");
  }
}
