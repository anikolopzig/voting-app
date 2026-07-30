// Firebase Realtime Database forbids these characters in a key, and keys can't be
// empty. We use option labels and lowercase names directly as keys
// (optionAuthors[label], scores[label], votes/{name}, status/{name}), so a value
// containing one of these would make the write throw. Validate at input time.
const FORBIDDEN_RE = /[.#$[\]/]/;

export const FORBIDDEN_KEY_HINT = '. # $ [ ] /';

export function isValidKey(str) {
  return typeof str === 'string' && str.length > 0 && !FORBIDDEN_RE.test(str);
}
