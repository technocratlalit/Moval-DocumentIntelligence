import type { MistralOcrPage, MistralOcrTable } from '../../../../infrastructure/mistral/mistral-ocr.types.js';

const TBL_PLACEHOLDER_RE = /\[tbl-(\d+)\.(?:html|md)\]/gi;

/** Resolve [tbl-N.html] placeholders in markdown using tables[] from the same page. */
export function resolveTablePlaceholders(md: string, tables: MistralOcrTable[]): string {
  return md.replace(TBL_PLACEHOLDER_RE, (_match, idxStr) => {
    const idx = parseInt(idxStr, 10);
    const table = tables[idx];
    if (!table?.content) return '';
    return table.format === 'markdown' ? table.content : htmlTableToMarkdown(table.content);
  });
}

/** Deterministic HTML table → markdown (preserves multi-line cell content joined). */
export function htmlTableToMarkdown(html: string): string {
  if (!html?.trim()) return '';

  const rows: string[][] = [];
  const rowMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const rowMatch of rowMatches) {
    const cells: string[] = [];
    const cellMatches = rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
    for (const cellMatch of cellMatches) {
      const text = stripHtml(cellMatch[1]).replace(/\s+/g, ' ').trim();
      cells.push(text);
    }
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return stripHtml(html).trim();

  const colCount = Math.max(...rows.map((r) => r.length));
  const pad = (row: string[]) => {
    const out = [...row];
    while (out.length < colCount) out.push('');
    return out;
  };

  const lines = rows.map((row, i) => {
    const padded = pad(row);
    const line = `| ${padded.join(' | ')} |`;
    if (i === 0 && rows.length > 1) {
      return `${line}\n| ${padded.map(() => '---').join(' | ')} |`;
    }
    return line;
  });

  return lines.join('\n');
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/~~([^~]+)~~/g, '') // strikethrough → drop content
    .trim();
}

/** Build cleaned markdown for Gemini from Mistral pages. */
export function pagesToCleanedMarkdown(pages: MistralOcrPage[]): string {
  const parts: string[] = [];

  for (const page of pages) {
    const pageNum = (page.index ?? 0) + 1;
    parts.push(`\n--- Page ${pageNum} ---\n`);

    let md = page.markdown ?? '';
    if (page.tables?.length) {
      md = resolveTablePlaceholders(md, page.tables);
    }

    // Append block text not already in markdown (section titles, etc.)
    if (page.blocks?.length) {
      const blockText = page.blocks
        .filter((b) => b.type === 'title' || b.type === 'text' || b.type === 'list')
        .map((b) => {
          const type = b.type === 'title' ? `## ${b.content}` : b.content;
          return type;
        })
        .join('\n');
      if (blockText.trim()) {
        md = md.trim() ? `${md}\n\n${blockText}` : blockText;
      }
    }

    parts.push(md.trim());
  }

  return parts.join('\n').trim();
}

/** Summarize Mistral pages for debug console (no huge payloads). */
export function summarizeMistralPages(pages: MistralOcrPage[]): Record<string, unknown> {
  const blockCounts: Record<string, number> = {};
  let tableCount = 0;
  for (const p of pages) {
    tableCount += p.tables?.length ?? 0;
    for (const b of p.blocks ?? []) {
      const t = String(b.type ?? 'unknown');
      blockCounts[t] = (blockCounts[t] ?? 0) + 1;
    }
  }
  return { pages: pages.length, blocks: blockCounts, tables: tableCount };
}
