// PNG / PDF export. Homeowners want to share a picture, not a CAD file — so we
// render the plan cleanly (no overlays, no selection) at high resolution, fit to
// the drawing's aspect ratio, and download it.
"use client";

import type { Editor } from "../editor.ts";

const TARGET_LONG_EDGE = 2000; // px on the longer side
const ASPECT_MIN = 0.6;
const ASPECT_MAX = 1.7;

function exportSize(editor: Editor): { width: number; height: number } {
  const b = editor.contentBounds;
  const w = Math.max(b.maxX - b.minX, 1);
  const h = Math.max(b.maxY - b.minY, 1);
  // Clamp the aspect so very long/thin plans still export to a sensible page.
  const aspect = Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, w / h));
  if (aspect >= 1) return { width: TARGET_LONG_EDGE, height: Math.round(TARGET_LONG_EDGE / aspect) };
  return { width: Math.round(TARGET_LONG_EDGE * aspect), height: TARGET_LONG_EDGE };
}

function renderToCanvas(editor: Editor): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const { width, height } = exportSize(editor);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  editor.renderThumbnail(ctx, width, height, 1);
  return canvas;
}

function safeName(name: string, ext: string): string {
  const base = name.trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-").toLowerCase() || "plan";
  return `${base}.${ext}`;
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function exportPng(editor: Editor, name: string): boolean {
  const canvas = renderToCanvas(editor);
  if (!canvas) return false;
  downloadDataUrl(canvas.toDataURL("image/png"), safeName(name, "png"));
  return true;
}

export async function exportPdf(editor: Editor, name: string): Promise<boolean> {
  const canvas = renderToCanvas(editor);
  if (!canvas) return false;
  // Lazy-load jsPDF so it isn't in the main bundle.
  const { jsPDF } = await import("jspdf");

  const imgW = canvas.width;
  const imgH = canvas.height;
  const landscape = imgW >= imgH;
  const pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "pt", format: "a4" });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 36; // 0.5in
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2;
  const scale = Math.min(availW / imgW, availH / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2;

  pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, y, drawW, drawH);
  pdf.save(safeName(name, "pdf"));
  return true;
}
