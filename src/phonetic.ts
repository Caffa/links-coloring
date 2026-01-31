/**
 * Phonetic (IPA-inspired) hashing for link coloring.
 *
 * From a linguist/conlang perspective: words are mapped to a compact
 * phonetic representation (IPA-like feature string). Similar sounds
 * produce similar strings, so "see" and "sea", "cat" and "kat", or
 * conlang cognates get similar colors.
 *
 * Uses a rule-based grapheme-to-phoneme style mapping (no dictionary),
 * so it works for English-like orthography and for conlangs with
 * phonemic or semi-phonemic Roman script. Unknown graphemes pass
 * through so spelling stays consistent.
 */

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

/**
 * Convert a single word to an IPA-inspired phonetic signature (ASCII).
 * Digraphs and context-sensitive rules (e.g. c→k/s, g→g/j) are applied
 * so that similar sounds map to the same sequence.
 */
function wordToPhonetic(word: string): string {
	if (!word.length) return '';

	const out: string[] = [];
	let i = 0;
	const next = (delta = 1) => (word[i + delta] ?? '');
	const isVowel = (c: string) => VOWELS.has(c);

	while (i < word.length) {
		const raw = word[i];
		if (raw === undefined) break;
		const c = raw.toLowerCase();
		const n = next(0);

		// --- Digraphs (order matters: longer first) ---
		if (c === 'c' && n === 'h') {
			out.push('C'); // IPA tʃ → single code
			i += 2;
			continue;
		}
		if (c === 's' && n === 'h') {
			out.push('S'); // IPA ʃ
			i += 2;
			continue;
		}
		if (c === 't' && n === 'h') {
			out.push('D'); // IPA θ/ð → D for dental
			i += 2;
			continue;
		}
		if (c === 'p' && n === 'h') {
			out.push('f');
			i += 2;
			continue;
		}
		if (c === 'q' && n === 'u') {
			out.push('k');
			out.push('w');
			i += 2;
			continue;
		}
		if (c === 'c' && n === 'k') {
			out.push('k');
			i += 2;
			continue;
		}
		if (c === 'n' && n === 'g') {
			out.push('N'); // IPA ŋ
			i += 2;
			continue;
		}
		if (c === 'i' && n === 'g' && (word[i + 2] ?? '') === 'h') {
			out.push('i'); // "igh" → long i (e.g. "light" → "lit")
			i += 3;
			continue;
		}
		if (c === 'g' && n === 'h' && isVowel(next(-1))) {
			// vowel+gh → f (e.g. "tough") or silent; use f for consistency
			out.push('f');
			i += 2;
			continue;
		}
		if (c === 'g' && n === 'h') {
			out.push('g'); // initial "gh" → g
			i += 2;
			continue;
		}
		if (c === 'e' && n === 'a') {
			out.push('i'); // "sea", "see" → same
			i += 2;
			continue;
		}
		if (c === 'e' && n === 'e') {
			out.push('i');
			i += 2;
			continue;
		}
		if (c === 'o' && n === 'o') {
			out.push('u');
			i += 2;
			continue;
		}
		if (c === 'o' && n === 'a') {
			out.push('o');
			i += 2;
			continue;
		}

		// --- Single graphemes (IPA-inspired) ---
		if (c === 'c') {
			out.push(isVowel(n) && (n === 'e' || n === 'i' || n === 'y') ? 's' : 'k');
			i++;
			continue;
		}
		if (c === 'g') {
			out.push(isVowel(n) && (n === 'e' || n === 'i' || n === 'y') ? 'j' : 'g');
			i++;
			continue;
		}
		if (c === 'x') {
			out.push('k');
			out.push('s');
			i++;
			continue;
		}
		if (c === 'y' && isVowel(next(-1)) && !isVowel(n)) {
			out.push('i'); // vowel+y = vowel+i
			i++;
			continue;
		}
		if (c === 'y' && (i === 0 || !isVowel(next(-1)))) {
			out.push('j'); // y as consonant
			i++;
			continue;
		}
		if (VOWELS.has(c)) {
			out.push(c);
			i++;
			continue;
		}
		// Consonants: pass through (b,d,f,h,j,k,l,m,n,p,r,s,t,v,w,z) or map odd ones
		if (c >= 'a' && c <= 'z') {
			out.push(c);
			i++;
			continue;
		}
		// Non-Roman: keep one canonical form so same char always maps same
		out.push(c);
		i++;
	}

	return out.join('');
}

/**
 * Convert full text (multiple words) to a single phonetic signature string.
 * Word boundaries are preserved with a separator so "new age" and "newage"
 * don't collapse.
 */
export function textToPhoneticSignature(text: string): string {
	const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
	return words.map(wordToPhonetic).join('|');
}

/**
 * DJB2-style hash of a string with seed (for use by main.ts).
 */
function djb2Hash(str: string, seed: number): number {
	let hash = seed;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash) + str.charCodeAt(i);
		hash = hash & hash;
	}
	return Math.abs(hash);
}

/**
 * Phonetic-IPA hash: similar-sounding words get similar hash values
 * (and thus similar colors). Based on IPA-inspired phonetic mapping
 * of each word, then hashing the resulting signature.
 */
export function hashPhoneticIpa(text: string, seed: number): number {
	const signature = textToPhoneticSignature(text);
	return signature ? djb2Hash(signature, seed) : djb2Hash(text, seed);
}
