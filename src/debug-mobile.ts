/**
 * Mobile Debugging Helper
 * 
 * This file provides debugging utilities to identify why link coloring
 * might not work on mobile in Live Preview mode.
 * 
 * Usage: Import and call these functions from the browser console on mobile.
 */

import { EditorView } from "@codemirror/view";

/**
 * Check if CodeMirror editor is available
 */
export function checkEditorAvailability(plugin: any): void {
	console.log("=== Editor Availability Check ===");
	console.log("Is Mobile:", plugin.isMobile);
	
	plugin.app.workspace.iterateRootLeaves((leaf: any) => {
		console.log("Leaf:", leaf.view?.constructor?.name);
		
		if (leaf.view?.editor) {
			console.log("  Editor type:", leaf.view.editor.constructor?.name);
			console.log("  Has .cm:", !!leaf.view.editor.cm);
			
			if (leaf.view.editor.cm) {
				const view = leaf.view.editor.cm as EditorView;
				console.log("  EditorView exists:", !!view);
				console.log("  visibleRanges:", view.visibleRanges);
				console.log("  state exists:", !!view.state);
				console.log("  Has decorations:", !!view.state.field);
			}
		}
	});
}

/**
 * Test if syntax tree is accessible
 */
export function testSyntaxTree(plugin: any): void {
	console.log("=== Syntax Tree Test ===");
	
	plugin.app.workspace.iterateRootLeaves((leaf: any) => {
		if (leaf.view?.editor?.cm) {
			const view = leaf.view.editor.cm as EditorView;
			const { syntaxTree } = require("@codemirror/language");
			
			try {
				console.log("  Attempting to access syntax tree...");
				
				let nodeCount = 0;
				let linkNodes = 0;
				
				for (const { from, to } of view.visibleRanges) {
					syntaxTree(view.state).iterate({
						from,
						to,
						enter: (node: any) => {
							nodeCount++;
							if (node.type.name.includes("link")) {
								linkNodes++;
								console.log(`    Found link node: ${node.type.name} at ${node.from}-${node.to}`);
							}
						}
					});
				}
				
				console.log(`  Total nodes scanned: ${nodeCount}`);
				console.log(`  Link nodes found: ${linkNodes}`);
			} catch (error) {
				console.error("  Error accessing syntax tree:", error);
			}
		}
	});
}

/**
 * Check if decorations are applied
 */
export function checkDecorations(plugin: any): void {
	console.log("=== Decoration Check ===");
	
	plugin.app.workspace.iterateRootLeaves((leaf: any) => {
		if (leaf.view?.editor?.cm) {
			const view = leaf.view.editor.cm as EditorView;
			
			// Check if our extension field exists
			console.log("  Checking for decoration field...");
			
			try {
				// Get all decorations from the editor
				const dom = view.dom;
				const coloredLinks = dom.querySelectorAll('[style*="color:"]');
				
				console.log(`  Found ${coloredLinks.length} elements with inline color styles`);
				
				// Check for our specific classes
				const targetLinks = dom.querySelectorAll('.consistent-link-target');
				const aliasLinks = dom.querySelectorAll('.consistent-link-alias');
				
				console.log(`  .consistent-link-target: ${targetLinks.length}`);
				console.log(`  .consistent-link-alias: ${aliasLinks.length}`);
				
				// Check first few links
				if (targetLinks.length > 0) {
					console.log("  First 3 colored links:");
					targetLinks.forEach((el: Element, i: number) => {
						if (i < 3) {
							console.log(`    ${i + 1}. Style:`, el.getAttribute('style'));
						}
					});
				}
			} catch (error) {
				console.error("  Error checking decorations:", error);
			}
		}
	});
}

/**
 * Comprehensive diagnostic
 */
export function runDiagnostics(plugin: any): void {
	console.log("\n" + "=".repeat(60));
	console.log("LINK COLORER - MOBILE DIAGNOSTICS");
	console.log("=".repeat(60) + "\n");
	
	checkEditorAvailability(plugin);
	console.log("\n" + "-".repeat(60) + "\n");
	
	testSyntaxTree(plugin);
	console.log("\n" + "-".repeat(60) + "\n");
	
	checkDecorations(plugin);
	console.log("\n" + "=".repeat(60) + "\n");
}