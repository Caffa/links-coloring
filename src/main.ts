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

                            if (type.includes("formatting-link-start")) {
                                inLink = true;
                                hasPipe = false;
                                targetTextBuffer = "";
                                targetColor = "";
                                return;
                            }
                            if (type.includes("formatting-link-end")) {
                                inLink = false;
                                return;
                            }

                            if (inLink) {
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
                                                attributes: { style: generateStyleString(dynColor) },
                                                class: "consistent-link-target"
                                            })
                                        );
                                    } else {
                                        if (targetColor) {
                                            builder.add(
                                                node.from,
                                                node.to,
                                                Decoration.mark({
                                                    attributes: { style: generateStyleString(targetColor) },
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

    // 2. Prepare Data (LowerCase)
    const cleaned = text.trim().toLowerCase();

    // 3. Check if we've already assigned a color to this specific text
    const textKey = `${settings.palette}-${isDarkMode ? 'dark' : 'light'}-${cleaned}`;
    if (textColorMap.has(textKey)) {
        return textColorMap.get(textKey)!;
    }

    // 4. Generate hash based on selected mode
    let hash: number;

    switch (settings.hashMode) {
        case 'strict-full':
            hash = hashStrictFull(cleaned);
            break;
        case 'strict-acronym':
            hash = hashStrictAcronym(cleaned);
            break;
        case 'similarity':
            hash = hashSimilarity(cleaned);
            break;
        default:
            hash = hashStrictFull(cleaned);
    }

    // 5. Select Palette and Pick Color
    const paletteObj = PALETTES[settings.palette] ?? PALETTES['vibrant']!;
    const colorList = isDarkMode ? paletteObj.dark : paletteObj.light;

    const paletteSize = colorList.length;
    const goldenStep = Math.max(1, Math.round(paletteSize * 0.382));

    // Probe a few candidate indices and pick the least used to spread load
    const candidates = [
        hash % paletteSize,
        (hash + goldenStep) % paletteSize,
        (hash + 2 * goldenStep) % paletteSize,
    ];

    let baseIndex = candidates[0];
    let minUse = Number.MAX_SAFE_INTEGER;
    for (const idx of candidates) {
        const key = `${settings.palette}-${isDarkMode ? 'dark' : 'light'}-${idx}`;
        const use = colorUsageMap.get(key) || 0;
        if (use < minUse) {
            minUse = use;
            baseIndex = idx;
        }
    }

    let baseColor = colorList[baseIndex]!;

    // 6. Variant seed: derive a secondary hash to diversify within the same base color
    const variantSeed = djb2Hash(cleaned + '|v');

    // 7. Track usage and cap variants per base; if exceeded, hop to a new base
    let colorKey = `${settings.palette}-${isDarkMode ? 'dark' : 'light'}-${baseIndex}`;
    let usageCount = colorUsageMap.get(colorKey) || 0;

    const MAX_VARIANTS_PER_BASE = 6;
    if (usageCount >= MAX_VARIANTS_PER_BASE) {
        // Move to a different base using golden step and pick the least used among a few probes
        const probes = [
            (baseIndex + goldenStep) % paletteSize,
            (baseIndex + 2 * goldenStep) % paletteSize,
            (baseIndex + 3 * goldenStep) % paletteSize,
        ];
        let best = probes[0];
        let bestUse = Number.MAX_SAFE_INTEGER;
        for (const idx of probes) {
            const k = `${settings.palette}-${isDarkMode ? 'dark' : 'light'}-${idx}`;
            const u = colorUsageMap.get(k) || 0;
            if (u < bestUse) {
                bestUse = u;
                best = idx;
            }
        }
        baseIndex = best;
        baseColor = colorList[baseIndex]!;
        colorKey = `${settings.palette}-${isDarkMode ? 'dark' : 'light'}-${baseIndex}`;
        usageCount = colorUsageMap.get(colorKey) || 0;
    }

    // 8. Apply a stratification band before the variant to expand the effective palette
    const bandIndex = (variantSeed % 3 + 3) % 3; // 0..2
    const bandedBase = applyBandVariant(baseColor, bandIndex, isDarkMode);

    // 9. Apply variant based on seed plus a small shade wobble from usageCount
    const finalColor = applyVariant(bandedBase, variantSeed, usageCount, isDarkMode);

    // Update usage count for this base color
    colorUsageMap.set(colorKey, usageCount + 1);

    // Store the color for this specific text so it's consistent across all encounters
    textColorMap.set(textKey, finalColor);

    return finalColor;
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
function hashStrictFull(text: string): number {
    const words = text.split(/\s+/).filter(Boolean);
    const acronyms = words.map(word => word.charAt(0)).join('');
    const seed = acronyms + text + text.length.toString();
    return djb2Hash(seed);
}

/**
 * Strict Acronym Hash: Uses only first letters of words.
 * Similar structure words may share colors.
 * Example: "Data Science" -> "ds", "Design System" -> "ds" (same color)
 */
function hashStrictAcronym(text: string): number {
    const words = text.split(/\s+/).filter(Boolean);
    const acronyms = words.map(word => word.charAt(0)).join('');
    return djb2Hash(acronyms);
}

/**
 * Similarity Hash: Similar words get similar colors using Levenshtein distance.
 * Words with small edit distances map to nearby color indices.
 *
 * Strategy: Use character n-grams (bigrams) to create a similarity-based hash.
 * Words sharing many bigrams will hash to nearby values, ensuring similar words
 * get similar colors.
 */
function hashSimilarity(text: string): number {
    // Extract bigrams (2-character sequences) from the text
    const bigrams = extractBigrams(text);

    if (bigrams.length === 0) {
        // Fallback for very short words
        return djb2Hash(text);
    }

    // Hash the bigrams to create a similarity-based hash
    // This naturally groups similar words together
    let hash = 5381;
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
function djb2Hash(seed: string): number {
    let hash = 5381;
    for (let i = 0; i < seed.length; i++) {
        hash = ((hash << 5) + hash) + seed.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash);
}

function generateStyleString(color: string) {
    return `
        color: ${color} !important;
        -webkit-text-fill-color: ${color} !important;
        --link-color: ${color} !important;
        --link-external-color: ${color} !important;
        font-weight: bold;
    `;
}

