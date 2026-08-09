import { createHash } from 'crypto';

export interface ContentJobOptions {
  // reserved for future cache key variants
}

/** Stable id for dedup, result cache, and BullMQ jobId — sha256(type:sorted-urls)[0:16] */
export function deriveContentJobId(
  type: string,
  urls: string[],
  _options: ContentJobOptions = {},
): string {
  return createHash('sha256')
    .update(`${type}:${urls.slice().sort().join(',')}`)
    .digest('hex')
    .slice(0, 16);
}
