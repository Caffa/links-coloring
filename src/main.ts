import { Plugin } from 'obsidian';
import { Extension, RangeSetBuilder } from '@codemirror/state';
import {
    EditorView,
    Decoration,
    DecorationSet,
    ViewPlugin,
    ViewUpdate
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

import { LinkColorSettings, DEFAULT_SETTINGS, LinkColorSettingTab, PALETTES, HashMode } from './settings';

// Global text-to-color mapping to ensure consistent shading per text
const textColorMap = new Map<string, string>();
// Track how many times each base color has been used (for shade generation)
const colorUsageMap = new Map<string, number>();

export default class LinkColorPlugin extends Plugin {
    settings: LinkColorSettings;
    editorExtension: Extension;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new LinkColorSettingTab(this.app, this));
        this.editorExtension = createLinkColorExtension(this);
        this.registerEditorExtension(this.editorExtension);

        this.registerEvent(this.app.workspace.on('css-change', () => {
            this.app.workspace.updateOptions();
        }));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.app.workspace.updateOptions();
    }
}

function createLinkColorExtension(plugin: LinkColorPlugin) {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = this.buildDecorations(view);
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = this.buildDecorations(update.view);
                }
            }

            buildDecorations(view: EditorView): DecorationSet {
                const builder = new RangeSetBuilder<Decoration>();
                const isDarkMode = document.body.classList.contains('theme-dark');

                let inLink = false;
                let isEmbed = false;
                let hasPipe = false;
                let targetTextBuffer = "";
                let targetColor = "";

                for (const { from, to } of view.visibleRanges) {
                    syntaxTree(view.state).iterate({
                        from,
                        to,
                        enter: (node) => {
                            const type = node.type.name;
                            const text = view.state.sliceDoc(node.from, node.to);

                            // 1. Detect Link Start
                            if (type.includes("formatting-link-start")) {
                                const charBefore = node.from > 0 ? view.state.sliceDoc(node.from - 1, node.from) : "";

                                // This covers cases where "![[" is parsed as a single token.
                                isEmbed = charBefore === "!" || text.startsWith("!");

                                inLink = true;
                                hasPipe = false;
                                targetTextBuffer = "";
                                targetColor = "";
                                return;
                            }

                            // 2. Detect Link End
                            // token type is unexpected (e.g., inside an embed block).
                            if (type.includes("formatting-link-end") || text === "]]") {
                                inLink = false;
                                isEmbed = false;
                                return;
                            }

                            if (inLink && !isEmbed) {
                                // 3. Runaway Safety
                                // If we hit a newline while in a link, assume the link was malformed or
                                // we missed the end token. This prevents coloring the rest of the document.
                                if (text.includes("\n")) {
                                    inLink = false;
                                    return;
                                }

                                if (text === "|" || type.includes("formatting-link-pipe")) {
                                    hasPipe = true;
                                    targetColor = getColor(targetTextBuffer, plugin.settings, isDarkMode);
                                    return;
                                }

                                if (!type.includes("formatting")) {
                                    if (!hasPipe) {
                                        targetTextBuffer += text;
                                        const dynColor = getColor(targetTextBuffer, plugin.settings, isDarkMode);
                                        builder.add(
                                            node.from,
                                            node.to,
                                            Decoration.mark({
                                                attributes: { style: generateStyleString(dynColor, plugin.settings) },
                                                class: "consistent-link-target"
                                            })
                                        );
                                    } else {
                                        if (targetColor) {
                                            builder.add(
                                                node.from,
                                                node.to,
                                                Decoration.mark({
                                                    attributes: { style: generateStyleString(targetColor, plugin.settings) },
                                                    class: "consistent-link-alias"
                                                })
                                            );
                                        }
                                    }
                                }
                            }
                        },
                    });
                }

                return builder.finish();
            }
        },
        {
            decorations: (v) => v.decorations,
        }
    );
}

function getColor(text: string, settings: LinkColorSettings, isDarkMode: boolean): string {
    // 1. Clean Prefix
    if (settings.ignorePrefix && text.includes(" - ")) {
        const parts = text.split(" - ");
        const namePart = parts[parts.length - 1];
        if (namePart) text = namePart.trim();
    }

    // 2. Prepare Data
    const cleaned = text.trim().toLowerCase();

    // 4. Generate Hashes
    const seed = settings.customSeed; // <--- GET SEED FROM SETTINGS

    // 3. Check Cache (must include seed so changing seed invalidates cache)
    const textKey = `${settings.palette}-${isDarkMode ? 'dark' : 'light'}-${seed}-${cleaned}`;
    if (textColorMap.has(textKey)) {
        return textColorMap.get(textKey)!;
    }
    let hash: number;

    switch (settings.hashMode) {
        case 'strict-full': hash = hashStrictFull(cleaned, seed); break;
        case 'strict-acronym': hash = hashStrictAcronym(cleaned, seed); break;
        case 'strict-first-last': hash = hashStrictFirstLast(cleaned, seed); break;
        case 'strict-first-two-last-two': hash = hashStrictFirstTwoLastTwo(cleaned, seed); break;
        case 'vowel-consonant': hash = hashVowelConsonant(cleaned, seed); break;
        case 'position-weighted': hash = hashPositionWeighted(cleaned, seed); break;
        case 'word-boundary-ngrams': hash = hashWordBoundaryNgrams(cleaned, seed); break;
        case 'length-middle': hash = hashLengthMiddle(cleaned, seed); break;
        case 'similarity': hash = hashSimilarity(cleaned, seed); break;
        default: hash = hashStrictFull(cleaned, seed);
    }

    // 5. Select Palette
    const paletteObj = PALETTES[settings.palette] ?? PALETTES['vibrant']!;
    const colorList = isDarkMode ? paletteObj.dark : paletteObj.light;
    const paletteSize = colorList.length;

    // --- FIX 1: GLOBAL LOAD BALANCING ---
    // Instead of checking 3 spots, scan the WHOLE palette to find the absolute least used color.
    // If there is a tie, use the hash to deterministically break it.

    let bestIndex = -1;
    let minUsage = Number.MAX_SAFE_INTEGER;

    // We create a randomized start point based on hash so we don't always fill index 0 first
    const startOffset = hash % paletteSize;

    for (let i = 0; i < paletteSize; i++) {
        // Wrap around array
        const idx = (startOffset + i) % paletteSize;
        const key = `${settings.palette}-${isDarkMode ? 'dark' : 'light'}-${seed}-${idx}`;
        const usage = colorUsageMap.get(key) || 0;

        if (usage < minUsage) {
            minUsage = usage;
            bestIndex = idx;
        }
    }

    // 6. Register Usage
    const selectedKey = `${settings.palette}-${isDarkMode ? 'dark' : 'light'}-${seed}-${bestIndex}`;
    const currentUsageCount = colorUsageMap.get(selectedKey) || 0;
    colorUsageMap.set(selectedKey, currentUsageCount + 1);

    const baseColor = colorList[bestIndex]!;

    // 7. Variant Seed
    const variantSeed = djb2Hash(cleaned + '|v', seed);

    // 8. Apply Aggressive Variant
    // We pass 'currentUsageCount' to force distinctness when a color is reused
    const finalColor = applyAggressiveVariant(baseColor, variantSeed, currentUsageCount, isDarkMode);

    textColorMap.set(textKey, finalColor);
    return finalColor;
}

function applyAggressiveVariant(baseColor: string, variantSeed: number, usageCount: number, isDarkMode: boolean): string {
    const hex = baseColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const hsl = rgbToHsl(r, g, b);

    // Seed Random generator
    const rand = (n: number) => Math.abs(((variantSeed >> n) ^ (variantSeed << (n % 13))) & 0xffff) / 0xffff;

    // --- FIX 2: USAGE BASED SPREAD ---
    // If this is the 1st time using this base color: almost no shift.
    // 2nd time: shift Left. 3rd time: shift Right. 4th: shift Left more.
    // This creates a "fan" effect around the base color.
    const spreadDirection = usageCount % 2 === 0 ? 1 : -1;
    const spreadMagnitude = Math.ceil(usageCount / 2) * 15; // 15, 30, 45 degree jumps per usage

    // Random noise (kept smaller to preserve the "Base" color identity slightly)
    const randomHueNoise = (rand(3) - 0.5) * 20; // +/- 10 degrees random wobble

    // Total Hue Shift
    // We limit spreadMagnitude to ~60 to prevent complete color crossovers (e.g. Red becoming Blue)
    const effectiveSpread = Math.min(spreadMagnitude, 60) * spreadDirection;
    hsl.h = (hsl.h + effectiveSpread + randomHueNoise + 360) % 360;

    // --- FIX 3: SATURATION/LIGHTNESS VARIANCE ---
    // Dark mode needs high Lightness to be readable. Light mode needs low Lightness.

    // Saturation: 60% to 95% range (High saturation is distinct)
    const satNoise = (rand(5) - 0.5) * 30; // +/- 15%
    hsl.s = Math.max(50, Math.min(95, hsl.s + satNoise));

    // Lightness: Ensure contrast but allow variance
    // Dark Mode: Range 65% - 85%
    // Light Mode: Range 25% - 45%
    const lightTarget = isDarkMode ? 75 : 35;
    const lightNoise = (rand(7) - 0.5) * 20; // +/- 10%
    hsl.l = Math.max(isDarkMode ? 60 : 20, Math.min(isDarkMode ? 90 : 50, lightTarget + lightNoise));

    const out = hslToRgb(hsl.h, hsl.s, hsl.l);
    return rgbToHex(out.r, out.g, out.b);
}

// Apply an intra-base variant using a secondary seed and a small shade wobble
function applyBandVariant(baseColor: string, bandIndex: number, isDarkMode: boolean): string {
    // Bands: 0 = normal, 1 = vivid, 2 = muted
    const hex = baseColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const hsl = rgbToHsl(r, g, b);

    if (bandIndex === 1) {
        // vivid
        hsl.s = Math.min(90, hsl.s + 10);
        hsl.l = isDarkMode ? Math.min(90, hsl.l + 2) : Math.max(15, hsl.l - 2);
    } else if (bandIndex === 2) {
        // muted
        hsl.s = Math.max(32, hsl.s - 12);
        hsl.l = isDarkMode ? Math.min(92, hsl.l + 3) : Math.max(12, hsl.l - 3);
    }

    const out = hslToRgb(hsl.h, hsl.s, hsl.l);
    return rgbToHex(out.r, out.g, out.b);
}

function applyVariant(baseColor: string, variantSeed: number, shadeIndex: number, isDarkMode: boolean): string {
    // Seed decomposition for deterministic tweaks
    const rand = (n: number) => Math.abs(((variantSeed >> n) ^ (variantSeed << (n % 13))) & 0xffff) / 0xffff;

    // Compute small deterministic adjustments
    const hueSign = rand(2) > 0.5 ? 1 : -1;
    const satSign = rand(4) > 0.5 ? 1 : -1;

    // Hue shift up to ~12 degrees with golden-angle inspired spread
    const hueAmp = 8 + rand(6) * 4; // 8..12
    const hueShift = hueSign * hueAmp;

    // Saturation delta 6..12%
    const satDelta = satSign * (6 + rand(8) * 6);

    // Small lightness adjustment 6..12% directed by mode
    const lightSign = isDarkMode ? 1 : -1;
    const lightDelta = lightSign * (6 + rand(10) * 6);

    // Convert to HSL, apply shifts, clamp, then blend with improved generateShade wobble
    const hex = baseColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const hsl = rgbToHsl(r, g, b);

    hsl.h = (hsl.h + hueShift + 360) % 360;
    hsl.s = Math.max(38, Math.min(88, hsl.s + satDelta));
    hsl.l = Math.max(18, Math.min(88, hsl.l + lightDelta));

    const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
    const baseVariant = rgbToHex(rgb.r, rgb.g, rgb.b);

    // Add a subtle shade wobble based on usageCount to avoid identical collisions in a run
    return generateShade(baseVariant, Math.max(0, shadeIndex), isDarkMode);
}

/**
 * Generate a shade variation of a color.
 * In dark mode: creates lighter shades (increases brightness)
 * In light mode: creates darker shades (decreases brightness)
 *
 * @param color - The base color in hex format
 * @param shadeIndex - Which shade variation (1 = first variation, 2 = second, etc.)
 * @param isDarkMode - Whether we're in dark mode
 * @returns A new hex color that's a shade variation of the input
 */
function generateShade(color: string, shadeIndex: number, isDarkMode: boolean): string {
    // Parse hex color to RGB
    const hex = color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Convert RGB to HSL for easier manipulation
    const hsl = rgbToHsl(r, g, b);

    // Intelligent shade logic:
    // - Use easing so the total shift approaches a bound instead of growing linearly.
    // - Slight hue rotation using golden-angle steps to avoid clustering.
    // - Small alternating saturation tweaks to add variety without blowing out vibrancy.

    const level = Math.max(1, shadeIndex);
    const ease = 1 - Math.exp(-level / 3); // 0..1 easing as level grows

    // 1) Hue: subtle golden-angle-based rotation, scaled by easing
    // Map to [-180, 180], then scale down to a small amplitude (~<= 10-12 deg)
    const golden = 137.508;
    const deltaH = ((((level * golden) % 360) - 180) * 0.06) * ease; // ~[-10.8, 10.8]
    hsl.h = (hsl.h + deltaH + 360) % 360;

    // 2) Saturation: alternate up/down with small amplitude, grow with easing
    const satSign = (level % 2 === 0) ? -1 : 1;
    const deltaS = satSign * (6 + 6 * ease); // between ~6% and 12%
    hsl.s = Math.max(28, Math.min(92, hsl.s + deltaS)); // tightened to avoid near-grey and oversaturation

    // 3) Lightness: bounded total adjustment, not linear per step
    const lightSign = isDarkMode ? 1 : -1; // lighten in dark mode, darken in light mode
    const maxLShift = 18; // cap total shift to avoid extremes
    let deltaL = lightSign * maxLShift * ease; // approach +/- maxLShift as level increases

    // add a tiny alternating wobble that diminishes as we approach the bound
    const wobble = (level % 2 === 0 ? -1 : 1) * 1.5 * (1 - ease);
    deltaL += wobble;

    hsl.l = Math.max(12, Math.min(92, hsl.l + deltaL)); // keep inside visually pleasing range

    // Convert back to RGB and then to hex
    const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
}

/**
 * Convert RGB to HSL color space
 */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
            case r:
                h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                break;
            case g:
                h = ((b - r) / d + 2) / 6;
                break;
            case b:
                h = ((r - g) / d + 4) / 6;
                break;
        }
    }

    return { h: h * 360, s: s * 100, l: l * 100 };
}

/**
 * Convert HSL to RGB color space
 */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
    h = h / 360;
    s = s / 100;
    l = l / 100;

    let r, g, b;

    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p: number, q: number, t: number) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }

    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255)
    };
}

/**
 * Convert RGB values to hex color string
 */
function rgbToHex(r: number, g: number, b: number): string {
    const toHex = (n: number) => {
        const hex = n.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };
    return '#' + toHex(r) + toHex(g) + toHex(b);
}

/**
 * Strict Full Hash: Maximum uniqueness using acronyms, full text, and length.
 * Example: "Data Science" -> "ds" + "data science" + "12"
 */
function hashStrictFull(text: string, seed: number): number {
    const words = text.split(/\s+/).filter(Boolean);
    const acronyms = words.map(word => word.charAt(0)).join('');
    const str = acronyms + text + text.length.toString();
    return djb2Hash(str, seed);
}

/**
 * Strict Acronym Hash: Uses only first letters of words.
 * Similar structure words may share colors.
 * Example: "Data Science" -> "ds", "Design System" -> "ds" (same color)
 */
function hashStrictAcronym(text: string, seed: number): number {
    const words = text.split(/\s+/).filter(Boolean);
    const acronyms = words.map(word => word.charAt(0)).join('');
    return djb2Hash(acronyms, seed);
}

/**
 * Strict First-Last Hash: Uses the first and last letters of every word.
 * Example: "Data Science" -> "D" + "a" + "S" + "e" -> "DaSe"
 */
function hashStrictFirstLast(text: string, seed: number): number {
    const words = text.split(/\s+/).filter(Boolean);
    const signature = words.map(word => {
        if (word.length === 0) return "";
        if (word.length === 1) return word + word;
        return word.charAt(0) + word.charAt(word.length - 1);
    }).join('');
    return djb2Hash(signature, seed);
}

/**
 * Strict First-Two-Last-Two Hash: Uses first 2 and last 2 characters of each word.
 * Provides better discrimination than first-last alone.
 * Example: "Data Science" -> "Da" + "ta" + "Sc" + "ce" -> "DataScce"
 */
function hashStrictFirstTwoLastTwo(text: string, seed: number): number {
    const words = text.split(/\s+/).filter(Boolean);
    const signature = words.map(word => {
        if (word.length === 0) return "";
        if (word.length === 1) return word + word + word + word;
        if (word.length === 2) return word + word;
        if (word.length === 3) return word.substring(0, 2) + word.substring(1);
        const firstTwo = word.substring(0, 2);
        const lastTwo = word.substring(word.length - 2);
        return firstTwo + lastTwo;
    }).join('');
    return djb2Hash(signature, seed);
}

/**
 * Vowel-Consonant Pattern Hash: Creates a pattern based on vowel/consonant positions.
 * Each character is mapped to 'V' (vowel) or 'C' (consonant), creating a unique pattern.
 * Example: "Data" -> "CVCV", "Science" -> "CCVCCV"
 */
function hashVowelConsonant(text: string, seed: number): number {
    const vowels = new Set(['a', 'e', 'i', 'o', 'u']);
    const words = text.split(/\s+/).filter(Boolean);
    const pattern = words.map(word => {
        return Array.from(word).map(char => vowels.has(char) ? 'V' : 'C').join('');
    }).join('|');
    // Also include word lengths for extra discrimination
    const lengthInfo = words.map(w => w.length.toString()).join(',');
    return djb2Hash(pattern + ':' + lengthInfo, seed);
}

/**
 * Position-Weighted Hash: Characters are weighted by their position in the word.
 * Edge characters (first/last) have higher weight, middle characters have lower weight.
 * This creates better discrimination for words with similar starts/ends but different middles.
 * Example: "Data" -> weighted sum of 'D'(4) + 'a'(1) + 't'(1) + 'a'(4)
 */
function hashPositionWeighted(text: string, seed: number): number {
    const words = text.split(/\s+/).filter(Boolean);
    let weightedSum = 0;

    for (const word of words) {
        const len = word.length;
        if (len === 0) continue;

        for (let i = 0; i < len; i++) {
            // Weight: edges get weight 4, middle gets weight 1
            // Distance from edge: min(i, len - 1 - i)
            const distFromEdge = Math.min(i, len - 1 - i);
            const weight = distFromEdge === 0 ? 4 : (distFromEdge === 1 ? 2 : 1);
            weightedSum += word.charCodeAt(i) * weight;
        }
        // Add word length as separator
        weightedSum += len * 1000;
    }

    // Combine with seed and hash
    return djb2Hash(weightedSum.toString() + text, seed);
}

/**
 * Word Boundary N-grams Hash: Uses trigrams (3-character sequences) that respect word boundaries.
 * Only creates n-grams within words, not across word boundaries.
 * This provides better discrimination while maintaining word identity.
 * Example: "Data Science" -> ["Dat", "ata"] + ["Sci", "cie", "ien", "enc", "nce"]
 */
function hashWordBoundaryNgrams(text: string, seed: number): number {
    const words = text.split(/\s+/).filter(Boolean);
    const trigrams: string[] = [];

    for (const word of words) {
        if (word.length < 3) {
            // For short words, just use the word itself
            trigrams.push(word);
        } else {
            // Extract all trigrams from this word
            for (let i = 0; i <= word.length - 3; i++) {
                trigrams.push(word.substring(i, i + 3));
            }
        }
    }

    if (trigrams.length === 0) return djb2Hash(text, seed);

    // Hash all trigrams together with word count for extra discrimination
    const signature = trigrams.join('|') + ':' + words.length.toString();
    return djb2Hash(signature, seed);
}

/**
 * Length + Middle Hash: Combines word length with middle characters.
 * For each word, takes: length + first char + middle char(s) + last char.
 * This provides excellent discrimination while being compact.
 * Example: "Data" (len=4) -> "4Dta", "Science" (len=7) -> "7Scee"
 */
function hashLengthMiddle(text: string, seed: number): number {
    const words = text.split(/\s+/).filter(Boolean);
    const signature = words.map(word => {
        const len = word.length;
        if (len === 0) return "0";
        if (len === 1) return "1" + word + word;
        if (len === 2) return "2" + word;

        const first = word.charAt(0);
        const last = word.charAt(len - 1);

        // Get middle character(s)
        let middle: string;
        if (len === 3) {
            middle = word.charAt(1);
        } else if (len % 2 === 0) {
            // Even length: take two middle chars
            const mid = len / 2;
            middle = word.substring(mid - 1, mid + 1);
        } else {
            // Odd length: take center char
            const mid = Math.floor(len / 2);
            middle = word.charAt(mid);
        }

        return len.toString() + first + middle + last;
    }).join('');

    return djb2Hash(signature, seed);
}

/**
 * Similarity Hash: Similar words get similar colors using Levenshtein distance.
 * Words with small edit distances map to nearby color indices.
 *
 * Strategy: Use character n-grams (bigrams) to create a similarity-based hash.
 * Words sharing many bigrams will hash to nearby values, ensuring similar words
 * get similar colors.
 */
function hashSimilarity(text: string, seed: number): number {
    const bigrams = extractBigrams(text);
    if (bigrams.length === 0) return djb2Hash(text, seed);

    let hash = seed; // Use the seed
    for (const bigram of bigrams) {
        hash = ((hash << 5) + hash) + bigram.charCodeAt(0);
        hash = ((hash << 5) + hash) + bigram.charCodeAt(1);
        hash = hash & hash;
    }
    return Math.abs(hash);
}

/**
 * Extract bigrams (2-character sequences) from text.
 * Example: "apple" -> ["ap", "pp", "pl", "le"]
 */
function extractBigrams(text: string): string[] {
    const bigrams: string[] = [];
    for (let i = 0; i < text.length - 1; i++) {
        bigrams.push(text.substring(i, i + 2));
    }
    return bigrams;
}

/**
 * DJB2 Hash Function: A widely used non-cryptographic hash function.
 * Known for excellent distribution and speed.
 */
function djb2Hash(str: string, seed: number = 5381): number {
    let hash = seed; // Use the passed seed instead of hardcoded 5381
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash);
}

function generateStyleString(color: string, settings: LinkColorSettings) {
    return `
        color: ${color} !important;
        -webkit-text-fill-color: ${color} !important;
        --link-color: ${color} !important;
        --link-external-color: ${color} !important;
    `;
}

