import type { MistralOcrPage } from '../../../../infrastructure/mistral/mistral-ocr.types.js';
import {
  type ClaimOcrPair,
  isVehicleTableHeaderRow,
  parseHtmlToPairs,
  parseMarkdownToPairs,
  parsePlainLinesToPairs,
  parseUiicHeaderFromMarkdown,
  pushClaimPair,
  splitUiicSectionBlob,
  splitVehicleDataRow,
  stripUiicValuePrefix,
} from './claim-ocr-parse.util.js';

const SKIP_BLOCK_TYPES = new Set(['header', 'footer']);
const MIN_PAIRS_PER_PAGE = 5;

const SECTION_BLOB_RE =
  /(?:दुर्घटना\s*का\s*ब्यौरा|DETAILS\s*OF\s*ACCIDENT|बीमाकृत\s*गाड़ी\s*की\s*क्षति|DAMAGE\s*TO\s*INSURED|चालक|DRIVER\s*AT|साक्षी|WITNESS|चोरी|THEFT|पिछले\s*दावे|PAST\s*CLAIMS)/i;

function pageNumber(page: MistralOcrPage): number {
  return (page.index ?? 0) + 1;
}

function normalizeSection(content: string): string {
  return content.replace(/\s+/g, ' ').trim().toUpperCase();
}

function isInsuredSection(section: string): boolean {
  return /INSURED|बीमाधारी/i.test(section) && !/VEHICLE|वाहन/i.test(section);
}

function isDriverSection(section: string): boolean {
  return /DRIVER|चालक/i.test(section);
}

function isVehicleSection(section: string): boolean {
  return /INSURED\s*VEHICLE|बीमाकृत\s*वाहन/i.test(section);
}

function processLetterPair(
  pairs: ClaimOcrPair[],
  pn: number,
  section: string,
  label: string,
  value: string,
): void {
  const stripped = stripUiicValuePrefix(label, value);
  if (!stripped.value || stripped.value === '...') return;
  pushClaimPair(pairs, pn, section, stripped.label, stripped.value);
}

function processVehicleTablePair(
  pairs: ClaimOcrPair[],
  pn: number,
  section: string,
  label: string,
  value: string,
): void {
  if (isVehicleTableHeaderRow(label, value)) return;

  if (/make\s*and\s*year|MVL\/\d{4}/i.test(label) || /^MVL\/\d{4}$/i.test(value.trim())) {
    const makeYear = /^MVL\/\d{4}$/i.test(label.trim()) ? label.trim() : value.trim();
    pushClaimPair(pairs, pn, section, 'Make and Year', makeYear);
    return;
  }

  if (/^MVL\/\d{4}$/i.test(label.trim())) {
    pushClaimPair(pairs, pn, section, 'Make and Year', label.trim());
    const split = splitVehicleDataRow(value);
    if (split) {
      if (split.engineNo) pushClaimPair(pairs, pn, section, 'Engine No.', split.engineNo);
      if (split.chassisNo) pushClaimPair(pairs, pn, section, 'Chassis No.', split.chassisNo);
      if (split.registrationNo) {
        pushClaimPair(pairs, pn, section, 'Registration No.', split.registrationNo);
      }
    }
    return;
  }

  const split = splitVehicleDataRow(value);
  if (split && /^\d/.test(value.trim())) {
    if (split.engineNo) pushClaimPair(pairs, pn, section, 'Engine No.', split.engineNo);
    if (split.chassisNo) pushClaimPair(pairs, pn, section, 'Chassis No.', split.chassisNo);
    if (split.registrationNo) {
      pushClaimPair(pairs, pn, section, 'Registration No.', split.registrationNo);
    }
    return;
  }

  pushClaimPair(pairs, pn, section, label, value);
}

function processSectionBlob(
  pairs: ClaimOcrPair[],
  pn: number,
  sectionKey: string,
  blob: string,
): void {
  if (SECTION_BLOB_RE.test(sectionKey) || SECTION_BLOB_RE.test(blob)) {
    pairs.push(...splitUiicSectionBlob(sectionKey, blob, pn));
  }
}

function parseUiicDriverFromMarkdown(md: string, pn: number, pairs: ClaimOcrPair[]): void {
  const section = '3. DRIVER AT THE TIME OF ACCIDENT';
  const driverBlock = md.match(
    /(?:३\.?\s*चालक|3\.?\s*DRIVER)[\s\S]*?(?=(?:४\.|4\.|५\.|5\.|$))/i,
  );
  const text = driverBlock?.[0] ?? md;
  const lines = text.split('\n');

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const letterMatch = line.match(/^\(([a-z])\)\s*(.+)$/i);
    if (letterMatch) {
      processLetterPair(pairs, pn, section, `(${letterMatch[1]})`, letterMatch[2]);
      continue;
    }

    if (/driving\s*licen/i.test(line)) {
      const m = line.match(/([A-Z]{2}\d{10,}[A-Z0-9]*)/i);
      if (m) pushClaimPair(pairs, pn, section, 'Driving License No.', m[1]);
    }
    if (/issuing\s*authority/i.test(line)) {
      const m = line.match(/(?:authority|RTO)\s*[:\s]*([A-Z][A-Z\s]{2,30})/i);
      if (m) pushClaimPair(pairs, pn, section, 'Issuing Authority', m[1].trim());
    }
    if (/under\s*the\s*influence/i.test(line)) {
      const m = line.match(/\b(yes|no)\b/i);
      if (m) pushClaimPair(pairs, pn, section, 'Alcohol influence', m[1]);
    }
  }

  parsePlainLinesToPairs(lines, pn, section, pairs);
}

/** Template-specific parser for UIIC 4-page bilingual claim forms. */
export function parseUiicBilingualPage(page: MistralOcrPage, pairs: ClaimOcrPair[]): void {
  const pn = pageNumber(page);
  const countBefore = pairs.filter((p) => p.page === pn).length;
  let section = 'GENERAL';

  if (pn === 1 && page.markdown) {
    parseUiicHeaderFromMarkdown(page.markdown, pn, pairs);
  }

  for (const block of page.blocks ?? []) {
    if (SKIP_BLOCK_TYPES.has(block.type)) continue;

    const content = block.content?.trim() ?? '';
    if (!content) continue;

    if (block.type === 'title') {
      section = normalizeSection(content);
      continue;
    }

    if (block.type === 'table' && content) {
      const tablePairs = parseHtmlToPairs(content, pn);
      for (const tp of tablePairs) {
        if (isVehicleTableHeaderRow(tp.label, tp.value)) continue;
        processVehicleTablePair(pairs, pn, section, tp.label, tp.value);
      }
      continue;
    }

    if (block.type === 'list' || block.type === 'text') {
      const lines = content.split('\n');
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        if (/^\d+\.\s/.test(line) && line.length < 100) {
          section = normalizeSection(line);
          continue;
        }

        const colonIdx = line.indexOf(':');
        if (colonIdx > 0 && colonIdx < 80) {
          const label = line.slice(0, colonIdx).trim();
          const value = line.slice(colonIdx + 1).trim();
          if (isInsuredSection(section) || isDriverSection(section)) {
            processLetterPair(pairs, pn, section, label, value);
          } else if (isVehicleSection(section)) {
            processVehicleTablePair(pairs, pn, section, label, value);
          } else {
            pushClaimPair(pairs, pn, section, label, value);
          }
          continue;
        }

        const letterMatch = line.match(/^\(([a-z])\)\s*(.+)$/i);
        if (letterMatch) {
          processLetterPair(pairs, pn, section, `(${letterMatch[1]})`, letterMatch[2]);
          continue;
        }

        if (SECTION_BLOB_RE.test(line)) {
          section = normalizeSection(line);
          continue;
        }
      }

      if (SECTION_BLOB_RE.test(section) && content.length > 80) {
        processSectionBlob(pairs, pn, section, content);
      }
      continue;
    }
  }

  const countAfterBlocks = pairs.filter((p) => p.page === pn).length;

  if (page.markdown) {
    if (pn === 2 || countAfterBlocks - countBefore < MIN_PAIRS_PER_PAGE) {
      if (pn === 2) {
        parseUiicDriverFromMarkdown(page.markdown, pn, pairs);
      } else {
        const mdPairs = parseMarkdownToPairs(page.markdown, pn);
        for (const mp of mdPairs) {
          if (isVehicleTableHeaderRow(mp.label, mp.value)) continue;
          if (/MVL\/\d{4}/i.test(mp.label) || /^\d{5,}\s+\d/.test(mp.value)) {
            processVehicleTablePair(pairs, pn, mp.section, mp.label, mp.value);
          } else if (SECTION_BLOB_RE.test(mp.label) || mp.value.length > 120) {
            processSectionBlob(pairs, pn, mp.label, mp.value);
          } else if (isInsuredSection(mp.section) || isDriverSection(mp.section)) {
            processLetterPair(pairs, pn, mp.section, mp.label, mp.value);
          } else {
            pushClaimPair(pairs, pn, mp.section, mp.label, mp.value);
          }
        }
      }
    }

    if (pn === 1) {
      parseUiicHeaderFromMarkdown(page.markdown, pn, pairs);
    }

    if (pn >= 3) {
      const accidentM = page.markdown.match(
        /(?:५\.?\s*दुर्घटना|5\.?\s*DETAILS\s*OF\s*ACCIDENT)([\s\S]*?)(?=६\.|6\.|$)/i,
      );
      if (accidentM) {
        processSectionBlob(pairs, pn, '5. DETAILS OF ACCIDENT', accidentM[1]);
      }
      const damageM = page.markdown.match(
        /(?:६\.?\s*बीमाकृत|6\.?\s*DAMAGE\s*TO\s*INSURED)([\s\S]*?)(?=७\.|7\.|$)/i,
      );
      if (damageM) {
        processSectionBlob(pairs, pn, '6. DAMAGE TO INSURED VEHICLE', damageM[1]);
      }
    }
  }
}
