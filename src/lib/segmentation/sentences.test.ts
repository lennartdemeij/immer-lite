import { describe, expect, it } from 'vitest';
import { segmentSentences } from './sentences';

describe('segmentSentences', () => {
  it('keeps common abbreviations with the surrounding sentence', () => {
    const sentences = segmentSentences(
      'Mr. Bennet arrived at 9 a.m. He stayed for dinner.'
    );

    expect(sentences.map((sentence) => sentence.text)).toEqual([
      'Mr. Bennet arrived at 9 a.m.',
      'He stayed for dinner.'
    ]);
  });

  it('handles dotted abbreviations without splitting early', () => {
    const sentences = segmentSentences(
      'She moved to the U.S. in 2010. It changed her life.'
    );

    expect(sentences.map((sentence) => sentence.text)).toEqual([
      'She moved to the U.S. in 2010.',
      'It changed her life.'
    ]);
  });
});
