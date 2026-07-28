import fs from 'fs/promises';
import path from 'path';
import { _config } from '../../../../config/config.js';
import { logger } from '../../../../utils/logger.js';

export type ClaimPipelineStage =
  | 'classify_in'
  | 'classify_out'
  | 'mistral_raw'
  | 'mistral_pairs'
  | 'cleaned_markdown'
  | 'gemini_prompt_preview'
  | 'gemini_raw_json'
  | 'gemini_validated'
  | 'postprocess_diff'
  | 'final';

const STAGE_LABELS: Record<ClaimPipelineStage, string> = {
  classify_in: '[CLAIM] 1-classify-in',
  classify_out: '[CLAIM] 1-classify',
  mistral_raw: '[CLAIM] 2-mistral-raw',
  mistral_pairs: '[CLAIM] 2b-raw-pairs',
  cleaned_markdown: '[CLAIM] 3-gemini-input',
  gemini_prompt_preview: '[CLAIM] 3-prompt-head',
  gemini_raw_json: '[CLAIM] 4-gemini-raw',
  gemini_validated: '[CLAIM] 4-gemini-validated',
  postprocess_diff: '[CLAIM] 5-postprocess',
  final: '[CLAIM] 6-final',
};

const STAGE_FILES: Partial<Record<ClaimPipelineStage, string>> = {
  classify_out: '01-classify.json',
  mistral_raw: '02-mistral-raw.json',
  mistral_pairs: '03-raw-pairs.json',
  cleaned_markdown: '04-cleaned-markdown.md',
  gemini_raw_json: '05-gemini-raw.json',
  gemini_validated: '06-gemini-validated.json',
  postprocess_diff: '07-postprocess-diff.json',
  final: '08-final.json',
};

let dumpDir: string | null = null;
const stageFiles: Array<{ stage: string; file?: string }> = [];

export function isClaimDebugEnabled(): boolean {
  return _config.CLAIM_DEBUG_DUMP === true;
}

export function initClaimDebugDump(jobId?: string): void {
  stageFiles.length = 0;
  if (!_config.CLAIM_DEBUG_DUMP) {
    dumpDir = null;
    return;
  }
  const base = _config.CLAIM_DEBUG_DUMP_DIR ?? './tmp/claim-debug';
  const id = jobId ?? `run-${Date.now()}`;
  dumpDir = path.join(base, id);
}

export function getClaimDebugStages(): Array<{ stage: string; file?: string }> {
  return [...stageFiles];
}

function truncateForConsole(data: unknown): unknown {
  const max = _config.CLAIM_DEBUG_MAX_CHARS ?? 12_000;
  if (typeof data === 'string') {
    return data.length > max ? `${data.slice(0, max)}… [${data.length} chars total]` : data;
  }
  const json = JSON.stringify(data);
  if (json.length <= max) return data;
  return { _truncated: true, preview: json.slice(0, max), totalChars: json.length };
}

async function writeStageFile(stage: ClaimPipelineStage, data: unknown): Promise<string | undefined> {
  if (!dumpDir) return undefined;
  const filename = STAGE_FILES[stage];
  if (!filename) return undefined;

  await fs.mkdir(dumpDir, { recursive: true });
  const filePath = path.join(dumpDir, filename);
  const content = stage === 'cleaned_markdown'
    ? String(data)
    : JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

export async function dumpStage(
  stage: ClaimPipelineStage,
  data: unknown,
  meta?: { jobId?: string },
): Promise<void> {
  if (!_config.CLAIM_DEBUG_DUMP) return;

  if (!dumpDir && meta?.jobId) initClaimDebugDump(meta.jobId);

  const label = STAGE_LABELS[stage] ?? stage;
  const preview = truncateForConsole(data);

  console.log(`${label} →`, typeof preview === 'string' ? preview : JSON.stringify(preview, null, 2));
  logger.debug({ stage, data: preview }, label);

  const filePath = await writeStageFile(stage, data);
  stageFiles.push({ stage, file: filePath });
}
