/** Persist CLAIM-specific fields from aimodule extraction result onto ExtractionJob. */
export function applyClaimFields(job, result) {
  if (!result || job.documentType !== 'CLAIM') return;
  const meta = result.additionalData ?? {};

  job.claimMeta = {
    insurer: result.insurerName ?? null,
    policyNumber: result.policyNumber ?? null,
    claimNumber: result.claimNumber ?? null,
  };
  job.flaggedFields = (meta.humanReviewFields ?? result.humanReviewFields ?? []).map((path) => ({
    path,
    reason: 'human review',
  }));
  if (meta.requiresHumanReview ?? result.requiresHumanReview) {
    job.status = 'needs_review';
  }

  const rawGemini = result.extractedPdfData?.rawGemini;
  if (rawGemini != null) {
    job.rawExtractions = job.rawExtractions ?? [];
    job.rawExtractions.push({
      sourceModel: meta.model ?? 'gemini',
      rawJson: rawGemini,
      createdAt: new Date(),
    });
  }
}
