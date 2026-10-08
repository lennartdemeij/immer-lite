import type { HyphenationFunctionSync } from 'hyphen';

const engines = new Map<string, HyphenationFunctionSync>();
const loading = new Map<string, Promise<void>>();
const words = new Map<string, string>();

function languageKey(language = 'en'): string {
  const tag = language.toLowerCase().replace(/_/g, '-');
  if (tag === 'nl' || tag.startsWith('nl-')) return 'nl';
  if (tag === 'en-gb') return 'en-gb';
  if (tag === 'en' || tag.startsWith('en-')) return 'en-us';
  return tag;
}

export function prepareHyphenation(language?: string): Promise<void> {
  const key = languageKey(language);
  let pending = loading.get(key);
  if (!pending) {
    const module = key === 'nl' ? import('hyphen/nl')
      : key === 'en-gb' ? import('hyphen/en-gb')
      : key === 'en-us' ? import('hyphen/en-us') : null;
    pending = module ? module.then((engine) => { engines.set(key, engine.hyphenateSync); }) : Promise.resolve();
    loading.set(key, pending);
    // A failed download can be retried on the next settings change.
    void pending.catch(() => { loading.delete(key); });
  }
  return pending;
}

export function hyphenateText(text: string, language?: string): string {
  const key = languageKey(language);
  const engine = engines.get(key);
  if (!engine) return text;
  return text.replace(/[\p{L}\p{M}\u00ad]{7,}/gu, (word) => {
    if (word.includes('\u00ad')) return word;
    const cacheKey = `${key}:${word}`;
    let result = words.get(cacheKey);
    if (result === undefined) {
      result = engine(word, { minWordLength: 7 });
      if (words.size >= 4000) words.delete(words.keys().next().value!);
      words.set(cacheKey, result);
    }
    return result;
  });
}
