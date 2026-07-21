export interface ClaimOcrPair {
  page: number;
  section: string;
  label: string;
  value: string;
}

const NULLISH_VALUE = /^(no|n\/a|na|nil|none|not\s+applicable|-+|\.+)$/i;

function isNullishValue(v: string): boolean {
  return !v.trim() || NULLISH_VALUE.test(v.trim());
}

function normalizeLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim();
}

function cleanValue(value: string): string {
  return stripTags(value).replace(/\s+/g, ' ').trim();
}

export function pushClaimPair(
  pairs: ClaimOcrPair[],
  page: number,
  section: string,
  label: string,
  value: string,
): void {
  const l = normalizeLabel(cleanValue(label));
  const v = cleanValue(value);
  if (!l || isNullishValue(v)) return;
  if (/^<\/?\w+>?$/i.test(v) || v === '</td>' || v === '</tr>') return;
  pairs.push({ page, section: section.trim(), label: l, value: v });
}

/** Parse HTML table rows into label:value pairs. */
export function parseHtmlToPairs(html: string, pageNumber: number): ClaimOcrPair[] {
  const pairs: ClaimOcrPair[] = [];
  let section = 'GENERAL';

  const tokenRe =
    /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>|<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>|<tr[^>]*>([\s\S]*?)<\/tr>/gi;

  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(html)) !== null) {
    if (match[1] != null) {
      const text = cleanValue(match[1]);
      if (text.length > 2) section = text.toUpperCase();
      continue;
    }

    if (match[2] != null) {
      const text = cleanValue(match[2]);
      if (
        text.length > 4 &&
        /^\d+\.|INSURED|DRIVER|ACCIDENT|VEHICLE|THIRD|WITNESS|THEFT|DECLARATION|WORKSHOP/i.test(text)
      ) {
        section = text.toUpperCase();
      }
      continue;
    }

    if (match[3] != null) {
      const cells = [...match[3].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((c) => cleanValue(c[1]))
        .filter(Boolean);
      if (cells.length >= 2) {
        pushClaimPair(pairs, pageNumber, section, cells[0], cells.slice(1).join(' '));
      } else if (cells.length === 1 && cells[0].includes(':')) {
        const idx = cells[0].indexOf(':');
        pushClaimPair(pairs, pageNumber, section, cells[0].slice(0, idx), cells[0].slice(idx + 1));
      }
    }
  }

  parsePlainLinesToPairs(stripTags(html).split('\n'), pageNumber, section, pairs);
  return dedupePairs(pairs);
}

/** Parse Markdown tables and lines into label:value pairs. */
export function parseMarkdownToPairs(md: string, pageNumber: number): ClaimOcrPair[] {
  const pairs: ClaimOcrPair[] = [];
  let section = 'GENERAL';

  const lines = md.split('\n');
  for (const line of lines) {
    const header = line.match(/^#{1,6}\s+(.+)$/);
    if (header) {
      section = header[1].trim().toUpperCase();
      continue;
    }

    if (/^\|.+\|$/.test(line) && !/^\|[\s\-:|]+\|$/.test(line)) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2) {
        pushClaimPair(pairs, pageNumber, section, cells[0], cells.slice(1).join(' '));
      }
      continue;
    }

    const boldSection = line.match(/^\*\*(.+)\*\*$/);
    if (boldSection && boldSection[1].length > 4) {
      section = boldSection[1].trim().toUpperCase();
      continue;
    }

    if (line.includes(':')) {
      const idx = line.indexOf(':');
      const label = line.slice(0, idx).replace(/^\*\*|\*\*$/g, '').trim();
      const value = line.slice(idx + 1).replace(/^\*\*|\*\*$/g, '').trim();
      if (label && value) pushClaimPair(pairs, pageNumber, section, label, value);
    }
  }

  parsePlainLinesToPairs(lines, pageNumber, section, pairs);
  return dedupePairs(pairs);
}

export function parsePlainLinesToPairs(
  lines: string[],
  pageNumber: number,
  initialSection: string,
  pairs: ClaimOcrPair[],
): void {
  let section = initialSection;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (/^\d+\.\s+[A-Z]/i.test(line) && line.length < 80) {
      section = line.toUpperCase();
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx > 0 && colonIdx < 60) {
      const label = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (label && value && !/^(http|www)/i.test(value)) {
        pushClaimPair(pairs, pageNumber, section, label, value);
      }
    }

    const letterItem = line.match(/^\(([a-z])\)\s*(.+)$/i);
    if (letterItem) {
      const rest = letterItem[2];
      const ci = rest.indexOf(':');
      if (ci > 0) {
        pushClaimPair(
          pairs,
          pageNumber,
          section,
          `(${letterItem[1]}) ${rest.slice(0, ci).trim()}`,
          rest.slice(ci + 1),
        );
      } else if (rest.length > 1) {
        pushClaimPair(pairs, pageNumber, section, `(${letterItem[1]})`, rest);
      }
    }
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function dedupePairs(pairs: ClaimOcrPair[]): ClaimOcrPair[] {
  const seen = new Set<string>();
  return pairs.filter((p) => {
    const key = `${p.page}|${p.section}|${p.label}|${p.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parsePageContent(content: string, pageNumber: number): ClaimOcrPair[] {
  if (/<\/?(?:table|tr|td|th|div|p|h[1-6]|b|strong)\b/i.test(content)) {
    return parseHtmlToPairs(content, pageNumber);
  }
  return parseMarkdownToPairs(content, pageNumber);
}

export function hasDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

export function devanagariRatio(text: string): number {
  if (!text) return 0;
  const chars = [...text.replace(/\s/g, '')];
  if (chars.length === 0) return 0;
  const devanagari = chars.filter((c) => /[\u0900-\u097F]/.test(c)).length;
  return devanagari / chars.length;
}

const DATE_IN_TEXT = /(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/;
const TIME_IN_TEXT = /(\d{1,2}[.:]\d{2}\s*(?:A\.?M\.?|P\.?M\.?))/i;
const SPEED_IN_TEXT = /(\d+)\s*(?:K\.?M\.?P\.?H\.?|KHPM|kmph)/i;

/** True when value is a vehicle table header row, not actual data. */
export function isVehicleTableHeaderRow(label: string, value: string): boolean {
  const combined = `${label} ${value}`;
  return (
    /engine\s*no/i.test(combined) &&
    /chassis\s*no/i.test(combined) &&
    /registration\s*no/i.test(combined)
  );
}

/** Strip UIIC bilingual value prefixes like "Name ", "Telephone No. ". */
export function stripUiicValuePrefix(
  label: string,
  value: string,
): { label: string; value: string } {
  const prefixes: Array<{ pattern: RegExp; newLabel: string }> = [
    { pattern: /^name\s+/i, newLabel: 'Name' },
    { pattern: /^address\s+for\s+correspondence\s+/i, newLabel: 'Address for Correspondence' },
    { pattern: /^telephone\s*no\.?\s*/i, newLabel: 'Telephone No.' },
    { pattern: /^age\s+/i, newLabel: 'Age' },
    { pattern: /^address\s+/i, newLabel: 'Address' },
  ];

  for (const { pattern, newLabel } of prefixes) {
    if (pattern.test(value)) {
      return { label: newLabel, value: value.replace(pattern, '').trim() };
    }
  }

  if (/^\([a-z]\)$/i.test(label.trim())) {
    const letter = label.trim();
    if (/^name\b/i.test(value)) return { label: 'Name', value: value.replace(/^name\s+/i, '').trim() };
    if (/^address/i.test(value)) {
      return {
        label: 'Address for Correspondence',
        value: value.replace(/^address\s+(?:for\s+correspondence\s+)?/i, '').trim(),
      };
    }
    if (/^telephone/i.test(value)) {
      return { label: 'Telephone No.', value: value.replace(/^telephone\s*no\.?\s*/i, '').trim() };
    }
    if (/^driving\s*licen/i.test(value)) {
      return {
        label: 'Driving License No.',
        value: value.replace(/^driving\s*licen[cs]e\s*(?:no\.?|number)?\s*/i, '').trim(),
      };
    }
    if (/^issuing\s*authority/i.test(value)) {
      return {
        label: 'Issuing Authority',
        value: value.replace(/^issuing\s*authority\s*/i, '').trim(),
      };
    }
    return { label: letter, value };
  }

  return { label, value };
}

/** Split a 3–4 token vehicle data row into engine/chassis/registration values. */
export function splitVehicleDataRow(value: string): {
  engineNo?: string;
  chassisNo?: string;
  registrationNo?: string;
} | null {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return null;
  if (tokens.length === 3) {
    return { engineNo: tokens[0], chassisNo: tokens[1], registrationNo: tokens[2] };
  }
  return {
    engineNo: tokens[0],
    chassisNo: tokens[1],
    registrationNo: tokens.slice(2).join(' '),
  };
}

/** Split UIIC section blobs (accident/damage/witness) into sub-field pairs. */
export function splitUiicSectionBlob(
  sectionTitle: string,
  blob: string,
  pageNumber: number,
): ClaimOcrPair[] {
  const pairs: ClaimOcrPair[] = [];
  const section = sectionTitle.toUpperCase();

  const segments = blob.split(
    /(?=\([कखगघङचछजझटठडढतथदधनपफबभमयरलवशषसह]\)|\([a-z]\))/i,
  );

  for (const seg of segments) {
    const text = seg.trim();
    if (!text || text.length < 4) continue;

    if (/date\s*(?:&|and)\s*time/i.test(text)) {
      const dateM = text.match(DATE_IN_TEXT);
      const timeM = text.match(TIME_IN_TEXT);
      if (dateM) {
        pushClaimPair(
          pairs,
          pageNumber,
          section,
          'Date and Time',
          timeM ? `${dateM[1]} ${timeM[1]}` : dateM[1],
        );
      }
      continue;
    }

    if (/\bplace\b/i.test(text) && !/inspection|inspected/i.test(text)) {
      const afterPlace = text.split(/\bplace\b/i).pop() ?? '';
      const placeVal = afterPlace
        .replace(/^[.\s:…\-]+/i, '')
        .replace(/\([कखगघङचछजझ].*$/i, '')
        .trim();
      if (placeVal && placeVal.length < 80 && !/^\(/.test(placeVal)) {
        pushClaimPair(pairs, pageNumber, section, 'Place', placeVal);
      }
      continue;
    }

    if (/speed\s*of\s*your\s*vehicle/i.test(text)) {
      const speedM = text.match(SPEED_IN_TEXT);
      if (speedM) {
        pushClaimPair(pairs, pageNumber, section, 'Speed of vehicle', `${speedM[1]} K.M.P.H.`);
      }
      continue;
    }

    if (/short\s*description\s*of\s*the\s*accident|दुर्घटना\s*का\s*संक्षिप्त/i.test(text)) {
      const afterDesc = text.split(/accident/i).pop() ?? text;
      const desc = afterDesc.replace(/^[\s.:…\-]+/i, '').slice(0, 500).trim();
      if (desc.length > 3 && !/^give\s+a/i.test(desc)) {
        pushClaimPair(pairs, pageNumber, section, 'Short description of the accident', desc);
      }
      continue;
    }

    if (/full\s*details\s*of\s*damage|क्षति\s*का\s*पूरा/i.test(text)) {
      const m = text.match(/(?:damage|ब्यौरा)[\s.:…\-]*(.{2,200})/i);
      const val = m?.[1]?.replace(/\([कखग].*$/i, '').trim();
      if (val && !/^full\s*details/i.test(val)) {
        pushClaimPair(pairs, pageNumber, section, 'Full details of damage', val);
      }
      continue;
    }

    if (/estimated\s*cost\s*of\s*repairs|मरम्मत\s*का\s*अनुमानित/i.test(text)) {
      const m = text.match(/repairs[\s.:…\-]*(.{2,100})/i);
      const val = m?.[1]?.replace(/\([कखग].*$/i, '').trim();
      if (val) pushClaimPair(pairs, pageNumber, section, 'Estimated cost of repairs', val);
      continue;
    }

    if (/when\s*and\s*where.*inspected|निरीक्षण/i.test(text)) {
      const m = text.match(/inspected[\s.:…\-]*(.{5,200})/i);
      const val = m?.[1]?.replace(/\([कखग].*$/i, '').trim();
      if (val) {
        pushClaimPair(
          pairs,
          pageNumber,
          section,
          'When and where can damaged vehicle be inspected',
          val,
        );
      }
      continue;
    }

    if (/driving\s*licen/i.test(text)) {
      const m = text.match(/([A-Z]{2}\d{10,}[A-Z0-9]*)/i);
      if (m) pushClaimPair(pairs, pageNumber, section, 'Driving License No.', m[1]);
      continue;
    }

    if (/issuing\s*authority/i.test(text)) {
      const m = text.match(/authority[\s.:…\-]*([A-Z][A-Z\s]{2,40})/i);
      if (m) pushClaimPair(pairs, pageNumber, section, 'Issuing Authority', m[1].trim());
      continue;
    }

    const letterItem = text.match(/^\(([a-z])\)\s*(.+)$/is);
    if (letterItem) {
      const rest = letterItem[2].trim();
      const ci = rest.indexOf(':');
      if (ci > 0 && ci < 80) {
        pushClaimPair(
          pairs,
          pageNumber,
          section,
          `(${letterItem[1]}) ${rest.slice(0, ci).trim()}`,
          rest.slice(ci + 1).trim(),
        );
      } else {
        const stripped = stripUiicValuePrefix(`(${letterItem[1]})`, rest);
        pushClaimPair(pairs, pageNumber, section, stripped.label, stripped.value);
      }
    }
  }

  return pairs;
}

/** Parse Certificate/Policy No. and Period of Insurance from page 1 markdown. */
export function parseUiicHeaderFromMarkdown(
  md: string,
  pageNumber: number,
  pairs: ClaimOcrPair[],
): void {
  const section = 'HEADER';

  const policyM = md.match(
    /(?:Certificate\/Policy\s*No\.?|बीमा\s*पत्र\s*संख्या)[\s.:…\-]*([A-Z0-9/]{8,})/i,
  );
  if (policyM) {
    pushClaimPair(pairs, pageNumber, section, 'Certificate/Policy No.', policyM[1]);
  }

  const periodM = md.match(
    /(?:Period\s*of\s*Insurance|बीमा\s*अवधि)[\s.:…\-]*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})\s*(?:to|-)\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/i,
  );
  if (periodM) {
    pushClaimPair(
      pairs,
      pageNumber,
      section,
      'Period of Insurance',
      `${periodM[1]} to ${periodM[2]}`,
    );
  }

  const claimM = md.match(/(?:Claim\s*No\.?)[\s.:…\-]*([A-Z0-9/-]{4,})/i);
  if (claimM && !/period|policy/i.test(claimM[0])) {
    pushClaimPair(pairs, pageNumber, section, 'Claim No.', claimM[1]);
  }
}
