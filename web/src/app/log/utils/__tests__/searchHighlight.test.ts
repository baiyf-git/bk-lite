import { describe, expect, it } from 'vitest';
import {
  extractHighlightTerms,
  splitHighlightedText
} from '../searchHighlight';

describe('extractHighlightTerms', () => {
  it('returns nothing for empty or wildcard queries', () => {
    expect(extractHighlightTerms('')).toEqual([]);
    expect(extractHighlightTerms(' * ')).toEqual([]);
    expect(extractHighlightTerms('*')).toEqual([]);
  });

  it('keeps only _msg / message terms, matching Grafana VictoriaLogs rules', () => {
    expect(extractHighlightTerms('error AND host.name:"api server" OR timeout')).toEqual([
      'error',
      'timeout'
    ]);
    expect(extractHighlightTerms('host.name:web01')).toEqual([]);
    expect(extractHighlightTerms('_msg:error')).toEqual(['error']);
    expect(extractHighlightTerms('message:"io timeout"')).toEqual(['io timeout']);
  });

  it('does not highlight field-filter values or the field-value colon', () => {
    expect(extractHighlightTerms('udp AND "@metadata.beat":"packetbeat"')).toEqual([
      'udp'
    ]);
    expect(extractHighlightTerms('"@timestamp":"2026-09-08T07:39:45.563Z"')).toEqual([]);
    expect(extractHighlightTerms('level:error host:foo')).toEqual([]);
  });

  it('keeps quoted phrases and skips operators, negation and non-filter pipes', () => {
    expect(extractHighlightTerms('"error: cannot find file"')).toEqual([
      'error: cannot find file'
    ]);
    expect(extractHighlightTerms('error NOT debug')).toEqual(['error']);
    expect(extractHighlightTerms('-debug warn')).toEqual(['warn']);
    expect(extractHighlightTerms('* | stats count()')).toEqual([]);
    expect(extractHighlightTerms('* | filter warn')).toEqual(['warn']);
    expect(extractHighlightTerms('* | filter level:error')).toEqual([]);
    expect(extractHighlightTerms('_msg:(a OR b)')).toEqual(['a', 'b']);
    expect(extractHighlightTerms('error | fields foo')).toEqual(['error']);
  });

  it('escapes literals and keeps regexp filters raw', () => {
    expect(extractHighlightTerms('a.b+c')).toEqual(['a\\.b\\+c']);
    expect(extractHighlightTerms('_msg:~"err.*"')).toEqual(['err.*']);
    expect(extractHighlightTerms('i(error)')).toEqual(['error']);
  });
});

describe('splitHighlightedText', () => {
  it('highlights regexp-ready terms and merges overlaps', () => {
    expect(splitHighlightedText('Connection timeout in timeout handler', ['timeout'])).toEqual([
      { text: 'Connection ', match: false },
      { text: 'timeout', match: true },
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

  it('only highlights message words from field-filter queries', () => {
    const terms = extractHighlightTerms('udp AND "@metadata.beat":"packetbeat"');
    expect(splitHighlightedText('udp 127.0.0.1:53 -> 127.0.0.1:43165', terms)).toEqual([
      { text: 'udp', match: true },
      { text: ' 127.0.0.1:53 -> 127.0.0.1:43165', match: false }
    ]);
    expect(splitHighlightedText('packetbeat', terms)).toEqual([
      { text: 'packetbeat', match: false }
    ]);
    expect(splitHighlightedText('2026-09-08T07:39:45.563Z', terms)).toEqual([
      { text: '2026-09-08T07:39:45.563Z', match: false }
    ]);
  });
});
