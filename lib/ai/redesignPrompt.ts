// Prompts for the premium redesign modules (image-to-image restyling).
//
// Unlike the core text-op prompts, these drive a multimodal image model: the
// user uploads a photo of a REAL room or yard and we ask the model to return a
// restyled, photorealistic concept image. The output is inspirational, NOT to
// scale and NOT editable geometry — the wording keeps the model honest about
// that and anchored to the actual photo (same room, same bones, restyled).

export type RedesignModule = "design" | "landscaping";

const MODULE_INTENT: Record<RedesignModule, string> = {
  design:
    "Restyle the interior room in the photo: paint, furniture, decor, lighting, and materials. " +
    "Keep the room's architecture, windows, doors, and proportions intact — restyle, do not rebuild.",
  landscaping:
    "Restyle the yard or exterior in the photo: plants, hardscape, paths, and outdoor furniture. " +
    "Keep the structure, property lines, and permanent features intact — restyle, do not rebuild. " +
    "Favor plants that are realistic for a typical temperate climate unless the style says otherwise.",
};

// Text instruction paired with the input image in the multimodal request.
export function buildRedesignPrompt(module: RedesignModule, style: string): string {
  const dir = style.trim()
    ? `Style direction from the homeowner: "${style.trim()}".`
    : "No specific style was given — choose a tasteful, broadly appealing update.";

  return [
    "You are an interior/exterior redesign visualizer.",
    MODULE_INTENT[module],
    dir,
    "Produce a single photorealistic image showing the same space, restyled.",
    "Preserve the camera angle and the room's real geometry; change only surfaces, furnishings, and decor.",
    "Do not add text, watermarks, labels, or measurements to the image.",
  ].join(" ");
}
