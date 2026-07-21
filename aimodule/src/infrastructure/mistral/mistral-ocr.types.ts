export type MistralBlockType =
  | 'text'
  | 'title'
  | 'list'
  | 'table'
  | 'signature'
  | 'header'
  | 'footer'
  | 'image'
  | 'caption'
  | 'equation'
  | 'code'
  | 'references'
  | 'aside_text';

export interface MistralOcrBlock {
  type: MistralBlockType | string;
  content: string;
  top_left_x?: number;
  top_left_y?: number;
  bottom_right_x?: number;
  bottom_right_y?: number;
  table_id?: string;
}

export interface MistralOcrTable {
  id: string;
  content: string;
  format?: 'html' | 'markdown';
}

export interface MistralConfidenceScores {
  average_page_confidence_score?: number;
  minimum_page_confidence_score?: number;
  word_confidence_scores?: Array<{ word: string; confidence: number }>;
}

export interface MistralOcrPage {
  index: number;
  markdown: string;
  tables?: MistralOcrTable[];
  blocks?: MistralOcrBlock[];
  header?: string | null;
  footer?: string | null;
  confidence_scores?: MistralConfidenceScores;
}

export interface MistralOcrResult {
  pages: MistralOcrPage[];
  model: string;
  pageCount: number;
  latencyMs: number;
  signaturePresent: boolean;
  averageConfidence: number | null;
  lowConfidenceWordCount: number;
}

export interface MistralOcrInput {
  sourceUrl?: string;
  localFilePath?: string;
  mimeType?: string;
}
