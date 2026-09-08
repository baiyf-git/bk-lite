import { describe, expect, it } from 'vitest';
import {
  extractHighlightTerms,
  splitHighlightedText
} from '../searchHighlight';

describe('extractHighlightTerms', () => {
  it('returns nothing for empty or wildcard queries', () => {
    expect(extractHighlightTerms('')).toEqual([]);
    expect(extractHighlightTerms(' * ')).toEqual([]);
  });

  it('keeps quoted phrases and unquoted tokens, skipping operators and field names', () => {
    expect(extractHighlightTerms('error AND host.name:"api server" OR timeout')).toEqual([
      'api server',
      'timeout',
      'error'
    ]);
    expect(extractHighlightTerms('host.name:web01')).toEqual(['web01']);
  });

  it('does not treat the field-value colon as a highlight term', () => {
    expect(extractHighlightTerms('udp AND "@metadata.beat":"packetbeat"')).toEqual([
      'packetbeat',
      'udp'
    ]);
    expect(extractHighlightTerms('"@timestamp":"2026-09-08T07:39:45.563Z"')).toEqual([
      '2026-09-08T07:39:45.563Z'
    ]);
  });

  it('keeps colons that belong to a quoted phrase', () => {
    expect(extractHighlightTerms('"error: cannot find file"')).toEqual([
      'error: cannot find file'
    ]);
  });
});

describe('splitHighlightedText', () => {
  it('highlights matches case-insensitively and merges overlaps', () => {
    expect(splitHighlightedText('Connection Timeout in timeout handler', ['timeout'])).toEqual([
      { text: 'Connection ', match: false },
      { text: 'Timeout', match: true },
      { text: ' in ', match: false },
      { text: 'timeout', match: true },
      { text: ' handler', match: false }
    ]);
    expect(splitHighlightedText('aaa', ['a', 'aa'])).toEqual([
      { text: 'aaa', match: true }
    ]);
  });

  it('returns the original text when nothing matches', () => {
    expect(splitHighlightedText('access granted', ['error'])).toEqual([
      { text: 'access granted', match: false }
    ]);
  });

  it('does not highlight colons from field filters in timestamps or host:port', () => {
    const terms = extractHighlightTerms('udp AND "@metadata.beat":"packetbeat"');
    expect(splitHighlightedText('udp 127.0.0.1:53 -> 127.0.0.1:43165', terms)).toEqual([
      { text: 'udp', match: true },
      { text: ' 127.0.0.1:53 -> 127.0.0.1:43165', match: false }
    ]);
    expect(splitHighlightedText('2026-09-08T07:39:45.563Z', terms)).toEqual([
      { text: '2026-09-08T07:39:45.563Z', match: false }
    ]);
  });
});
