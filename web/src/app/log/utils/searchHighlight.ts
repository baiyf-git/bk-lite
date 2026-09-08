import { escapeRegExp } from 'lodash';

const TERM_SEPARATORS = [' ', ':', '|', '(', ')', '{', '}'];
const FILTER_PIPE = /^filter(\s|$)/i;
const FIELD_FILTER = /^[^\s:|(){}]+:/;
const ALLOWED_START_FILTER_PIPE_QUOTES = ['"', "'", '`'];
const MESSAGE_FIELDS = new Set(['_msg', 'message']);

const skipBalanced = (
  value: string,
  openIdx: number,
  open: string,
  close: string
): number => {
  let depth = 0;
  let quote: string | null = null;
  let index = openIdx;
  for (; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return index;
};

const stripComments = (value: string): string => {
  let out = '';
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      const raw = char === '`';
      out += char;
      index += 1;
      while (index < value.length) {
        if (!raw && value[index] === '\\' && index + 1 < value.length) {
          out += value[index] + value[index + 1];
          index += 2;
          continue;
        }
        out += value[index];
        if (value[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (char === '#') {
      while (index < value.length && value[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
};

const splitByPipes = (expr: string): string[] => {
  if (!expr) {
    return [''];
  }
  const segments: string[] = [];
  let depth = 0;
  let quoteChar: string | null = null;
  let segmentStart = 0;
  for (let index = 0; index < expr.length; index += 1) {
    const char = expr[index];
    if (quoteChar && char === '\\') {
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      if (quoteChar === char) {
        quoteChar = null;
      } else if (!quoteChar) {
        quoteChar = char;
      }
      continue;
    }
    if (quoteChar) {
      continue;
    }
    if (char === '(' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === '|' && depth === 0) {
      segments.push(expr.slice(segmentStart, index).trim());
      segmentStart = index + 1;
    }
  }
  segments.push(expr.slice(segmentStart).trim());
  return segments;
};

const readQuoted = (
  value: string,
  openIdx: number
): { value: string; next: number } => {
  const quote = value[openIdx];
  let quoted = '';
  let index = openIdx + 1;
  for (; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\\' && index + 1 < value.length) {
      quoted += value[index + 1];
      index += 1;
      continue;
    }
    if (char === quote) {
      return { value: quoted, next: index + 1 };
    }
    quoted += char;
  }
  return { value: quoted, next: index };
};

const readRawQuoted = (
  value: string,
  openIdx: number
): { value: string; next: number } => {
  const quote = value[openIdx];
  let index = openIdx + 1;
  for (; index < value.length; index += 1) {
    if (value[index] === '\\') {
      index += 1;
      continue;
    }
    if (value[index] === quote) {
      return { value: value.slice(openIdx + 1, index), next: index + 1 };
    }
  }
  return { value: value.slice(openIdx + 1), next: index };
};

const readValueTermInner = (
  value: string,
  start: number
): { term: string | null; next: number } => {
  if (value[start] === '~') {
    let index = start + 1;
    while (index < value.length && value[index] === ' ') {
      index += 1;
    }
    if (value[index] === '"' || value[index] === "'" || value[index] === '`') {
      const backticked = value[index] === '`';
      const quoted = readRawQuoted(value, index);
      const term = backticked
        ? quoted.value
        : quoted.value.replace(/\\\\/g, '\\');
      return { term: term || null, next: quoted.next };
    }
    return { term: null, next: index };
  }

  let index = start;
  if (value[index] === '=') {
    index += 1;
  }
  if (value[index] === '"' || value[index] === "'" || value[index] === '`') {
    const quoted = readQuoted(value, index);
    return {
      term: quoted.value ? escapeRegExp(quoted.value) : null,
      next: quoted.next
    };
  }

  const wordStart = index;
  while (index < value.length && !TERM_SEPARATORS.includes(value[index])) {
    index += 1;
  }
  let word = value.slice(wordStart, index);
  if (word.endsWith('*')) {
    word = word.slice(0, -1);
  }
  return { term: word ? escapeRegExp(word) : null, next: index };
};

const readValueTerm = (
  value: string,
  start: number
): { term: string | null; next: number } => {
  let index = start;
  let negated = false;
  if (value[index] === '-' || value[index] === '!') {
    negated = true;
    index += 1;
  }
  const result = readValueTermInner(value, index);
  return negated ? { ...result, term: null } : result;
};

const skipSpaces = (value: string, start: number): number => {
  let index = start;
  while (value[index] === ' ') {
    index += 1;
  }
  return index;
};

const consumeFieldValue = (
  segment: string,
  fieldName: string,
  start: number,
  emit: (term: string | null) => void
): number => {
  let index = skipSpaces(segment, start);
  if (segment[index] === '(') {
    if (!MESSAGE_FIELDS.has(fieldName)) {
      return skipBalanced(segment, index, '(', ')');
    }
    return index;
  }
  const { term, next } = readValueTerm(segment, index);
  index = next;
  if (segment[index] === '(') {
    if (!MESSAGE_FIELDS.has(fieldName)) {
      return skipBalanced(segment, index, '(', ')');
    }
    return index;
  }
  emit(MESSAGE_FIELDS.has(fieldName) ? term : null);
  return index;
};

const scanFilterSegment = (segment: string): string[] => {
  const results: string[] = [];
  let index = 0;
  let negateNext = false;

  const emit = (term: string | null) => {
    if (term && !negateNext) {
      results.push(term);
    }
    negateNext = false;
  };

  while (index < segment.length) {
    const char = segment[index];
    if (char === ' ') {
      index += 1;
      continue;
    }
    if (char === '{') {
      index = skipBalanced(segment, index, '{', '}');
      negateNext = false;
      continue;
    }
    if (char === '(') {
      if (negateNext) {
        index = skipBalanced(segment, index, '(', ')');
        negateNext = false;
      } else {
        index += 1;
      }
      continue;
    }
    if (char === ')') {
      index += 1;
      continue;
    }
    if (char === '-' || char === '!') {
      negateNext = true;
      index += 1;
      continue;
    }
    if (char === '*') {
      index += 1;
      negateNext = false;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const quoted = readQuoted(segment, index);
      const afterQuote = skipSpaces(segment, quoted.next);
      if (segment[afterQuote] === ':') {
        index = consumeFieldValue(segment, quoted.value, afterQuote + 1, emit);
        continue;
      }
      index = quoted.next;
      emit(quoted.value ? escapeRegExp(quoted.value) : null);
      continue;
    }
    if (char === '~' || char === '=') {
      const { term, next } = readValueTerm(segment, index);
      index = next;
      emit(term);
      continue;
    }

    const start = index;
    while (
      index < segment.length &&
      !TERM_SEPARATORS.includes(segment[index])
    ) {
      index += 1;
    }
    let word = segment.slice(start, index);
    const upper = word.toUpperCase();
    if (upper === 'AND' || upper === 'OR') {
      continue;
    }
    if (upper === 'NOT') {
      negateNext = true;
      continue;
    }
    if (segment[index] === ':') {
      index = consumeFieldValue(segment, word, index + 1, emit);
      continue;
    }
    if (segment[index] === '(') {
      continue;
    }
    if (word.endsWith('*')) {
      word = word.slice(0, -1);
    }
    emit(word ? escapeRegExp(word) : null);
  }

  return results;
};

const filterBodyOfPipe = (segment: string): string | null => {
  if (FILTER_PIPE.test(segment)) {
    return segment.slice('filter'.length);
  }
  if (ALLOWED_START_FILTER_PIPE_QUOTES.includes(segment[0])) {
    return segment;
  }
  if (FIELD_FILTER.test(segment)) {
    return segment;
  }
  return null;
};

export function extractHighlightTerms(query?: string): string[] {
  if (!query) {
    return [];
  }
  const normalized = stripComments(query)
    .replace(/[\t\n\r]/g, ' ')
    .trim();
  if (!normalized || normalized === '*') {
    return [];
  }

  const terms: string[] = [];
  splitByPipes(normalized).forEach((segment, index) => {
    if (index === 0) {
      terms.push(...scanFilterSegment(segment));
      return;
    }
    const body = filterBodyOfPipe(segment);
    if (body !== null) {
      terms.push(...scanFilterSegment(body));
    }
  });

  return [...new Set(terms.filter(Boolean))];
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

export function splitHighlightedText(
  text: string,
  terms: string[]
): HighlightPart[] {
  if (!text || !terms.length) {
    return [{ text, match: false }];
  }

  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    if (!term) {
      continue;
    }
    let regexp: RegExp;
    try {
      regexp = new RegExp(term, 'g');
    } catch {
      continue;
    }
    regexp.lastIndex = 0;
    let match = regexp.exec(text);
    while (match) {
      if (!match[0]) {
        regexp.lastIndex += 1;
        match = regexp.exec(text);
        continue;
      }
      ranges.push([match.index, match.index + match[0].length]);
      match = regexp.exec(text);
    }
  }
  if (!ranges.length) {
    return [{ text, match: false }];
  }

  ranges.sort((left, right) => left[0] - right[0] || right[1] - left[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }

  const parts: HighlightPart[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      parts.push({ text: text.slice(cursor, start), match: false });
    }
    parts.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), match: false });
  }
  return parts;
}
