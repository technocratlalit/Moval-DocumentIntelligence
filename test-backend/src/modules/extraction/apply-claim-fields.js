/** Persist CLAIM-specific fields from aimodule extraction result onto ExtractionJob. */
export function applyClaimFields(job, result) {
  if (!result || job.documentType !== 'CLAIM') return;
  const meta = result.meta ?? {};
  job.claimMeta = {
    insurer: meta.source_insurer,
    templateVersion: meta.source_template_version,
    formLanguage: meta.form_language,
  };
  job.pipelineStatus = result.extractionMeta?.pipelineStatus ?? result.status;
  job.rawExtractions = result.extractionMeta?.rawExtractions ?? [];
  job.fieldConfidence = result.extractionMeta?.fieldConfidence ?? [];
  job.flaggedFields = result.extractionMeta?.flaggedFields ?? result.flaggedFields ?? [];
  if (result.status === 'needs_review' || result.requiresHumanReview) {
    job.status = 'needs_review';
  }
}
