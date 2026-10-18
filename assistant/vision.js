// On-device image recognition with a small CLIP zero-shot vision model.
// The model runs in this browser; attached images are never uploaded.
export const VISION_MODEL = "Xenova/clip-vit-base-patch32";

// Relative-match scores from CLIP rank the supported categories against each
// other; they are not calibrated probabilities of being correct.
export const MATCH_THRESHOLD = 0.35;

export const CANDIDATES = [
  {text: "a photograph taken with a camera", craft: "photocraft", craftName: "PhotoCraft", hint: "photo editing"},
  {text: "an unedited raw photo that needs exposure fixes", craft: "lightcraft", craftName: "LightCraft", hint: "RAW workflow"},
  {text: "a vector logo or flat illustration", craft: "vectorcraft", craftName: "VectorCraft", hint: "vector illustration"},
  {text: "a poster or page layout design", craft: "designcraft", craftName: "DesignCraft", hint: "page design"},
  {text: "a screenshot of an application interface", craft: "figcraft", craftName: "FigCraft", hint: "interface design"},
  {text: "a frame from a video or film", craft: "filmcraft", craftName: "FilmCraft", hint: "video editing"},
  {text: "a presentation slide", craft: "deckcraft", craftName: "DeckCraft", hint: "presentations"},
  {text: "a spreadsheet or data table", craft: "gridcraft", craftName: "GridCraft", hint: "spreadsheets"},
  {text: "a scanned document or PDF page", craft: "pdfcraft", craftName: "PdfCraft", hint: "PDF review"},
  {text: "a written text document", craft: "wordcraft", craftName: "WordCraft", hint: "word processing"},
  {text: "a technical drawing or floor plan", craft: "cadcraft", craftName: "CADCraft", hint: "CAD drafting"},
  {text: "an audio waveform or spectrogram", craft: "soundcraft", craftName: "SoundCraft", hint: "audio work"},
  {text: "a motion graphics or visual effects render", craft: "effectcraft", craftName: "EffectCraft", hint: "motion graphics"}
];

let pipelinePromise = null;

function getPipeline(onStatus) {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const {pipeline, env} = await import("./vendor/transformers.min.js");
      env.allowLocalModels = false;
      // Serve the ONNX runtime's WASM files from this site instead of a CDN.
      env.backends.onnx.wasm.wasmPaths = "./vendor/ort/";
      return await pipeline("zero-shot-image-classification", VISION_MODEL, {
        dtype: "q8",
        progress_callback: data => {
          if (data.status === "progress" && data.total)
            onStatus?.(`Downloading the local vision model (${Math.round(data.loaded / data.total * 100)}%)… the browser caches it afterwards.`);
        }
      });
    })().catch(error => {
      pipelinePromise = null;
      throw error;
    });
  }
  return pipelinePromise;
}

export function formatVision(results) {
  if (!results.length) return "No recognition result was produced.";
  const top = results[0];
  if (top.confidence < MATCH_THRESHOLD)
    return "No close match among the supported categories. Attach a clearer image, or name the craft you need help with.";
  const rest = results.slice(1, 3).filter(r => r.confidence >= 0.05)
    .map(r => `${r.hint} (${Math.round(r.confidence * 100)}%)`).join(", ");
  return `Closest supported category: ${top.text} (relative match ${Math.round(top.confidence * 100)}%). `
    + `Best handled in ${top.craftName} (${top.hint}).`
    + (rest ? ` Also plausible: ${rest}.` : "")
    + " Recognition ran entirely on this device; the image was not uploaded.";
}

export async function recognizeImage(blob, onStatus) {
  const classifier = await getPipeline(onStatus);
  onStatus?.("Analysing image contents locally…");
  const url = URL.createObjectURL(blob);
  try {
    const output = await classifier(url, CANDIDATES.map(candidate => candidate.text));
    const scores = new Map(output.map(item => [item.label, item.score]));
    const ranked = CANDIDATES.map(candidate => ({
      ...candidate, confidence: scores.get(candidate.text) || 0
    })).sort((a, b) => b.confidence - a.confidence);
    return ranked;
  } finally {
    URL.revokeObjectURL(url);
  }
}
