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

import { LinkColorSettings, DEFAULT_SETTINGS, LinkColorSettingTab } from './settings';

export default class LinkColorPlugin extends Plugin {
    settings: LinkColorSettings;
    editorExtension: Extension;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new LinkColorSettingTab(this.app, this));
        this.editorExtension = createLinkColorExtension(this);
        this.registerEditorExtension(this.editorExtension);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        // Trigger a re-render of the editor to apply new settings immediately
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
                const sat = plugin.settings.saturation;
                const lit = plugin.settings.lightness;

                // State Machine Variables
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

                            // 1. Link Start
                            if (type.includes("formatting-link-start")) {
                                inLink = true;
                                hasPipe = false;
                                targetTextBuffer = "";
                                targetColor = "";
                                return;
                            }

                            // 2. Link End
                            if (type.includes("formatting-link-end")) {
                                inLink = false;
                                return;
                            }

                            // 3. Inside Link
                            if (inLink) {
                                // A. Detect Pipe
                                if (text === "|" || type.includes("formatting-link-pipe")) {
                                    hasPipe = true;
                                    targetColor = stringToHslColor(targetTextBuffer, sat, lit);
                                    return;
                                }

                                // B. Content
                                if (!type.includes("formatting")) {
                                    if (!hasPipe) {
                                        // Accumulate Target
                                        targetTextBuffer += text;

                                        // Color the Target (Visible when editing)
                                        const dynColor = stringToHslColor(targetTextBuffer, sat, lit);
                                        builder.add(
                                            node.from,
                                            node.to,
                                            Decoration.mark({
                                                attributes: {
                                                    style: generateStyleString(dynColor)
                                                },
                                                class: "consistent-link-target"
                                            })
                                        );

                                    } else {
                                        // Color the Alias (Using the Target's color)
                                        if (targetColor) {
                                            builder.add(
                                                node.from,
                                                node.to,
                                                Decoration.mark({
                                                    attributes: {
                                                        style: generateStyleString(targetColor)
                                                    },
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

// Helper: Generates a CSS string that forces the color to apply
function generateStyleString(color: string) {
    return `
        color: ${color} !important;
        -webkit-text-fill-color: ${color} !important;
        --link-color: ${color} !important;
        --link-external-color: ${color} !important;
        font-weight: bold;
    `;
}

// Helper: Hashing function
function stringToHslColor(str: string, s: number, l: number) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, ${s}%, ${l}%)`;
}