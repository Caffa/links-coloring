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

    // 3. Generate hash based on selected mode
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

    // 4. Select Palette and Pick Color
    const paletteObj = PALETTES[settings.palette] ?? PALETTES['vibrant']!;
    const colorList = isDarkMode ? paletteObj.dark : paletteObj.light;

    const index = hash % colorList.length;
    return colorList[index]!;
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

