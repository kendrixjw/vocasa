// Whole-home PDF booklet: a cover page plus one page per floor.
//
// The single-floor PDF in exportPlan.ts answers "print what I'm looking at".
// This answers "hand someone the whole house" — every floor in reading order,
// each labelled and measured, with a cover carrying the totals.
//
// Rendering goes through editor.renderFloorThumbnail, which draws a floor
// WITHOUT switching to it: switchFloor resets the undo history by design, and
// exporting must never cost the user their history.
"use client";

import type { Editor } from "../editor.ts";
import { estimate, floorAreaSqFt, usd, type FloorEntities } from "../cost/estimate.ts";

const MARGIN = 40; // pt (~0.55in)
const TARGET_LONG_EDGE = 1800; // px of the rendered plan bitmap

export type BookletPage = {
  floorId: string;
  name: string;
  areaSqFt: number;
  /** A floor with no geometry still gets a page, marked empty. */
  empty: boolean;
};

/** Page plan, ground floor first. Pure — the unit-testable half of the export. */
export function bookletPages(floors: FloorEntities[]): BookletPage[] {
  return floors.map((f) => ({
    floorId: f.id,
    name: f.name,
    areaSqFt: Math.round(floorAreaSqFt(f.entities)),
    empty: f.entities.length === 0,
  }));
}

/** Scale (w,h) to fit inside (availW,availH) without distortion or upscaling. */
export function fitBox(
  w: number,
  h: number,
  availW: number,
  availH: number,
): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: 0, height: 0 };
  const scale = Math.min(availW / w, availH / h);
  return { width: w * scale, height: h * scale };
}

/** File-safe name, matching exportPlan.ts's convention. */
export function bookletFilename(name: string): string {
  const base =
    name.trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-").toLowerCase() || "plan";
  return `${base}-booklet.pdf`;
}

/** Bitmap size for a floor, aspect-matched and clamped like the PNG export. */
function floorImageSize(
  editor: Editor,
  floorId: string,
): { width: number; height: number } {
  const b = editor.floorBounds(floorId);
  const w = b ? Math.max(b.maxX - b.minX, 1) : 4;
  const h = b ? Math.max(b.maxY - b.minY, 1) : 3;
  const aspect = Math.min(1.7, Math.max(0.6, w / h));
  return aspect >= 1
    ? { width: TARGET_LONG_EDGE, height: Math.round(TARGET_LONG_EDGE / aspect) }
    : { width: Math.round(TARGET_LONG_EDGE * aspect), height: TARGET_LONG_EDGE };
}

function renderFloor(editor: Editor, floorId: string): HTMLCanvasElement | null {
  const { width, height } = floorImageSize(editor, floorId);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  editor.renderFloorThumbnail(ctx, floorId, width, height, 1, {
    grid: false,
    background: "#ffffff",
  });
  return canvas;
}

/**
 * Build and download the booklet. Returns false when there's nothing to export
 * or the browser can't rasterize.
 */
export async function exportBooklet(editor: Editor, name: string): Promise<boolean> {
  if (typeof document === "undefined") return false;

  const floors = editor.allFloorEntities();
  const pages = bookletPages(floors);
  if (pages.length === 0) return false;

  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  const planName = name.trim() || "Untitled plan";
  const totalArea = pages.reduce((s, p) => s + p.areaSqFt, 0);
  const est = estimate(floors, editor.costSettings);

  // --- Cover ---------------------------------------------------------------
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(30);
  pdf.setTextColor(28, 25, 23); // stone-900
  pdf.text(planName, MARGIN, pageH / 2 - 46, { maxWidth: pageW - MARGIN * 2 });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  pdf.setTextColor(120, 113, 108); // stone-500
  const plural = pages.length === 1 ? "floor" : "floors";
  const summary =
    totalArea > 0
      ? `${pages.length} ${plural} · ${totalArea.toLocaleString("en-US")} sq ft`
      : `${pages.length} ${plural}`;
  pdf.text(summary, MARGIN, pageH / 2 - 22);

  if (est.total > 0) {
    pdf.text(
      `Estimated ${usd(est.total)} — rough order of magnitude, not a bid`,
      MARGIN,
      pageH / 2 - 4,
    );
  }

  pdf.setFontSize(10);
  pdf.setTextColor(168, 162, 158); // stone-400
  pdf.text(
    new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    MARGIN,
    pageH - MARGIN,
  );
  pdf.text("Made with Vocasa", pageW - MARGIN, pageH - MARGIN, { align: "right" });

  // --- One page per floor --------------------------------------------------
  pages.forEach((page, i) => {
    pdf.addPage();

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.setTextColor(28, 25, 23);
    pdf.text(page.name, MARGIN, MARGIN + 4);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(120, 113, 108);
    if (page.areaSqFt > 0) {
      pdf.text(`${page.areaSqFt.toLocaleString("en-US")} sq ft`, pageW - MARGIN, MARGIN + 4, {
        align: "right",
      });
    }

    const top = MARGIN + 20;
    const bottom = pageH - MARGIN - 14;
    const availW = pageW - MARGIN * 2;
    const availH = bottom - top;

    if (page.empty) {
      pdf.setTextColor(168, 162, 158);
      pdf.text("This floor is empty.", pageW / 2, top + availH / 2, { align: "center" });
    } else {
      const canvas = renderFloor(editor, page.floorId);
      if (canvas) {
        const box = fitBox(canvas.width, canvas.height, availW, availH);
        pdf.addImage(
          canvas.toDataURL("image/png"),
          "PNG",
          MARGIN + (availW - box.width) / 2,
          top + (availH - box.height) / 2,
          box.width,
          box.height,
        );
      }
    }

    pdf.setFontSize(9);
    pdf.setTextColor(168, 162, 158);
    pdf.text(planName, MARGIN, pageH - MARGIN + 6);
    pdf.text(`${i + 1} / ${pages.length}`, pageW - MARGIN, pageH - MARGIN + 6, { align: "right" });
  });

  pdf.save(bookletFilename(planName));
  return true;
}
