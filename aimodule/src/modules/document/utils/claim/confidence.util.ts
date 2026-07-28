import type { MistralOcrPage, MistralWordConfidence } from '../../../../infrastructure/mistral/mistral-ocr.types.js';

const FIELD_KEYWORDS: Array<{ path: string; patterns: RegExp[] }> = [
  { path: 'policy_details.policy_no', patterns: [/policy\s*no/i] },
  { path: 'insured_details.name', patterns: [/^(नाम|name)$/i, /\bname\b/i] },
  { path: 'vehicle_details.registration_no', patterns: [/vehicle\s*no/i, /registration/i, /regn/i] },
  { path: 'vehicle_details.engine_no', patterns: [/engine\s*no/i] },
  { path: 'vehicle_details.chassis_no', patterns: [/chassis\s*no/i] },
  { path: 'loss_details.date_of_loss', patterns: [/date.*accident/i, /date.*loss/i] },
  { path: 'driver_details.driving_license_no', patterns: [/driving\s*licen/i, /\bdl\s*no/i] },
];

function wordToken(w: MistralWordConfidence): string {
  return (w.text ?? w.word ?? '').trim();
}

/** ponytail: coarse keyword→field map; upgrade path = per-template bbox config */
export function computeFieldConfidence(
  pages: MistralOcrPage[],
): Array<{ path: string; confidence: number; flaggedForReview: boolean }> {
  const results: Array<{ path: string; confidence: number; flaggedForReview: boolean }> = [];
  const threshold = 0.6;

  for (const { path, patterns } of FIELD_KEYWORDS) {
    const scores: number[] = [];

    for (const page of pages) {
      for (const block of page.blocks ?? []) {
        const text = block.content ?? '';
        if (!patterns.some((p) => p.test(text))) continue;

        const words = page.confidence_scores?.word_confidence_scores ?? [];
        if (words.length) {
          const blockScores = words
            .filter((w) => {
              const token = wordToken(w);
              return token.length > 0 && text.toLowerCase().includes(token.toLowerCase());
            })
            .map((w) => w.confidence);
          if (blockScores.length) scores.push(Math.min(...blockScores));
        }
      }
    }

    const confidence = scores.length ? Math.min(...scores) : 0.85;
    results.push({
      path,
      confidence,
      flaggedForReview: confidence < threshold,
    });
  }

  return results;
}
