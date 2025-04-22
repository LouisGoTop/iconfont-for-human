'use strict';

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// --- Function to create a placeholder SVG data URI ---
// Accepts icon name/id and optional unicode

// --- REMOVED global defaultGutterIcon and iconDecorationType ---
// const defaultGutterIcon = createPlaceholderSvgUri('line', '');
// const iconDecorationType = vscode.window.createTextEditorDecorationType({ ... });

// Map to store icon class names and their corresponding unicode
let iconMap = new Map<string, string>();
// Map to store SVG path data from iconfont.js
let svgPathMap = new Map<string, string>();
// Map to store dynamically created decoration types for each icon
let iconDecorationTypes = new Map<string, vscode.TextEditorDecorationType>();
// Separate decoration type for hover annotations (invisible)
let hoverAnnotationDecorationType: vscode.TextEditorDecorationType;

// --- Function to parse iconfont.js and extract SVG data ---
async function parseIconFontJs() {
	const jsFiles = await vscode.workspace.findFiles('**/iconfont.js', '**/node_modules/**', 1);
	if (jsFiles.length === 0) {
		console.log('iconfont-for-human: No iconfont.js found in the workspace.');
		return;
	}

	try {
		console.log(`iconfont-for-human: Found iconfont.js at ${jsFiles[0].fsPath}`);
		const jsContent = await fs.promises.readFile(jsFiles[0].fsPath, 'utf8');
		console.log('iconfont-for-human: Successfully read iconfont.js');

		// 首先提取整个 SVG 字符串
		const symbolsMatch = jsContent.match(/'<svg>(.+?)<\/svg>'/);
		if (!symbolsMatch) {
			console.log('iconfont-for-human: No SVG content found in iconfont.js');
			return;
		}

		const svgContent = symbolsMatch[1];
		console.log('iconfont-for-human: Found SVG content in iconfont.js');

		// 提取所有 symbol 元素
		const symbolRegex = /<symbol.+?id="([^"]+)".+?>(.+?)<\/symbol>/g;
		let symbolMatch;
		
		while ((symbolMatch = symbolRegex.exec(svgContent)) !== null) {
			const [fullMatch, id, content] = symbolMatch;
			
			// 从 symbol 内容中提取 path
			const pathMatch = content.match(/<path.+?d="([^"]+)"/);
			if (pathMatch) {
				const path = pathMatch[1];
				svgPathMap.set(id, path);
				console.log(`iconfont-for-human: Found icon: ${id}`);
			}
		}

		console.log(`iconfont-for-human: Successfully parsed ${svgPathMap.size} icons from iconfont.js`);
		
		// 打印前几个图标的信息用于调试
		let count = 0;
		for (const [id, path] of svgPathMap.entries()) {
			if (count < 3) {
				console.log(`Icon ${count + 1}: id="${id}", path="${path.substring(0, 50)}..."`);
			}
			count++;
		}
	} catch (error) {
		console.error('Error parsing iconfont.js:', error);
		// 打印更详细的错误信息
		if (error instanceof Error) {
			console.error('Error details:', {
				message: error.message,
				stack: error.stack
			});
		}
	}
}

// --- Function to create SVG URI using actual icon data ---
// Accepts iconId (without prefix) and optional unicode
// Note: This function might not be directly used if only gutter icons are needed per line,
// but keep it for potential hover message usage or inline icons.
function createSvgUri(iconId: string, unicode?: string): vscode.Uri {
	const svgPath = svgPathMap.get(iconId); // Look up using ID directly

	if (!svgPath) {
		return vscode.Uri.parse(''); // Return empty URI if no path is found
	}

	// 根据 VS Code 主题设置颜色
	const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
	const iconColor = isDark ? '#FFFFFF' : 'rgba(0, 0, 0, 0.9)';
	// const bgColor = isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.05)'; // Background color removed

	// 创建简化的 SVG 字符串，只包含路径，让 VS Code 控制尺寸
	// viewBox 仍然应该匹配原始 SVG 的坐标系 (例如 1024x1024)
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="16" height="16">
        <path d="${svgPath}" fill="${iconColor}"></path>
    </svg>`;
    // Removed: background circle, container group, filter

	const encodedSvg = Buffer.from(svg).toString('base64');
	return vscode.Uri.parse(`data:image/svg+xml;base64,${encodedSvg}`);
}

// --- Function to find and parse iconfont.css ---
async function findAndParseIconfontCss() {
	// Clear previous maps
	iconMap.clear();
	svgPathMap.clear();

	// Dispose existing decoration types before parsing
	disposeDecorationTypes();

	// First parse iconfont.js to get SVG data
	await parseIconFontJs();

	// Search for iconfont.css in the workspace, excluding node_modules
	const cssFiles = await vscode.workspace.findFiles('**/iconfont.css', '**/node_modules/**', 10); // Limit search results

	if (cssFiles.length === 0) {
		console.log('iconfont-for-human: No iconfont.css found in the workspace.');
		// Optionally show a message to the user
		// vscode.window.showWarningMessage('iconfont-for-human: Could not find iconfont.css.');
		return;
	}

	// For simplicity, use the first found file. Might need refinement later.
	const cssPath = cssFiles[0].fsPath;
	console.log(`iconfont-for-human: Found iconfont.css at ${cssPath}`);

	try {
		const cssContent = await fs.promises.readFile(cssPath, 'utf8');
		// Regex to find `.icon-xxx:before { content: '\xxxx'; }`
		// Improved slightly to handle potential spaces and optional quotes
		const iconRegex = /\.([a-zA-Z0-9_-]+)::?before\s*{\s*content:\s*['"]?(\\[a-fA-F0-9]+)['"]?;?\s*}/g;
		let match;
		while ((match = iconRegex.exec(cssContent))) {
			const iconName = match[1]; // e.g., 'icon-star'
			const iconUnicode = match[2].substring(1); // e.g., 'e600' (remove the backslash)
			if (iconName && iconUnicode) {
				// Check if this icon name exists in the SVG map before adding to iconMap
				if (svgPathMap.has(iconName)) {
					iconMap.set(iconName, iconUnicode);
				} else {
					console.warn(`iconfont-for-human: Icon "${iconName}" found in CSS but not in iconfont.js SVG symbols.`);
				}
			}
		}
		console.log(`iconfont-for-human: Parsed ${iconMap.size} usable icons from ${cssPath}`);
		// Trigger decoration update AFTER parsing - Removed from here
		// const activeEditor = vscode.window.activeTextEditor;
		// if (activeEditor) {
		// 	updateDecorations(); // Call update after successful parsing
		// }
	} catch (error) {
		console.error(`iconfont-for-human: Error reading or parsing ${cssPath}:`, error);
		vscode.window.showErrorMessage(`iconfont-for-human: Failed to parse ${cssPath}. See console for details.`);
	}
}

// --- Function to dispose all decoration types ---
function disposeDecorationTypes(editor?: vscode.TextEditor) {
	const targetEditor = editor || vscode.window.activeTextEditor;
	// Clear decorations in the editor first
	if (targetEditor) {
		// Clear icon decorations
		for (const decorationType of iconDecorationTypes.values()) {
			targetEditor.setDecorations(decorationType, []);
		}
		// Clear hover decorations
		if (hoverAnnotationDecorationType) {
			targetEditor.setDecorations(hoverAnnotationDecorationType, []);
		}
	}
	// Then dispose the types
	for (const decorationType of iconDecorationTypes.values()) {
		decorationType.dispose();
	}
	iconDecorationTypes.clear();
	if (hoverAnnotationDecorationType) {
		hoverAnnotationDecorationType.dispose();
		// hoverAnnotationDecorationType = undefined; // Optional: reset variable
	}
	console.log('iconfont-for-human: Disposed existing decoration types.');
}

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "iconfont-for-human" is now active!');

	// Create the invisible decoration type for hover messages
	hoverAnnotationDecorationType = vscode.window.createTextEditorDecorationType({});
	context.subscriptions.push(hoverAnnotationDecorationType); // Add to subscriptions for cleanup

	// Initial parsing of iconfont files (CSS depends on JS for SVG paths)
	await findAndParseIconfontCss(); // This will parse JS first, then CSS

	let activeEditor = vscode.window.activeTextEditor;

	// --- Update Decorations Function (Rewritten) ---
	function updateDecorations() {
		if (!activeEditor) {
			console.log("iconfont-for-human: No active editor.");
			return;
		}
		if (iconMap.size === 0 || svgPathMap.size === 0) {
			console.log("iconfont-for-human: Icon maps are empty, skipping decoration.");
			// Clear existing decorations if maps become empty
			disposeDecorationTypes(activeEditor);
			return;
		}

		const doc = activeEditor.document;
		const lineCount = doc.lineCount;
		// Map to store Gutter Icon DecorationOptions grouped by icon name
		let gutterDecorationsToApply = new Map<string, vscode.DecorationOptions[]>();
		// Array to store Hover Annotation DecorationOptions
		let hoverAnnotations: vscode.DecorationOptions[] = [];
		const decoratedContentLines = new Set<number>(); // Track decorated content lines per update

		// Iterate through all lines
		for (let i = 0; i < lineCount; i++) {
			const lineText = doc.lineAt(i).text;

			// Iterate through known icon class names from CSS/JS map
			for (const iconName of iconMap.keys()) {
				// Check if line contains the icon class name AND we have SVG data for it
				if (lineText.includes(iconName)) {
					// Found the icon selector line (i), now look ahead for the 'content:' line (j)
					let contentLineFound = -1;
					const maxLookAhead = 5; // How many lines to look ahead for 'content:'
					for (let j = i + 1; j < Math.min(i + 1 + maxLookAhead, lineCount); j++) {
						const nextLineText = doc.lineAt(j).text;
						if (nextLineText.includes('content:')) {
							contentLineFound = j;
							break;
						}
					}

					// If we found a content line nearby and it hasn't been decorated yet
					if (contentLineFound !== -1 && !decoratedContentLines.has(contentLineFound)) {
						const targetLine = contentLineFound;
						decoratedContentLines.add(targetLine); // Mark this content line as decorated for this pass
						const range = new vscode.Range(targetLine, 0, targetLine, 1); // Range for both gutter and hover

						// --- Prepare Gutter Icon Decoration --- 
						// Ensure a decoration type exists for this icon
						if (!iconDecorationTypes.has(iconName)) {
							try {
								const iconUri = createSvgUri(iconName);
								if (iconUri.scheme === 'data') {
									const newType = vscode.window.createTextEditorDecorationType({
										gutterIconPath: iconUri,
										gutterIconSize: 'contain',
									});
									iconDecorationTypes.set(iconName, newType);
									console.log(`iconfont-for-human: Created decoration type for ${iconName}`);
								} else {
									console.warn(`iconfont-for-human: Could not create valid SVG URI for ${iconName}, skipping.`);
									continue; // Skip this icon if URI is invalid
								}
							} catch(e) {
								console.error(`iconfont-for-human: Error creating decoration type for ${iconName}`, e);
								continue; // Skip this icon if type creation fails
							}
						}

						// Get or initialize the gutter options array for this icon type
						let gutterOptionsArray = gutterDecorationsToApply.get(iconName);
						if (!gutterOptionsArray) {
							gutterOptionsArray = [];
							gutterDecorationsToApply.set(iconName, gutterOptionsArray);
						}
						// Add options for the gutter icon (range only, hover handled separately)
						gutterOptionsArray.push({ range: range });

						// --- Prepare Hover Annotation --- 
						const iconUnicode = iconMap.get(iconName);
						const hoverIconUri = createSvgUri(iconName); // Re-create/get URI for hover
						const markdownString = new vscode.MarkdownString();
						markdownString.isTrusted = true; // Enable potential command URIs or complex rendering
						markdownString.appendMarkdown(`**Icon:** \`${iconName}\`\\n\\n`);
						if (iconUnicode) {
							markdownString.appendMarkdown(`**Unicode:** \`\\\\u${iconUnicode}\`\\n\\n`);
						}
						if (hoverIconUri.scheme === 'data') {
							markdownString.appendMarkdown(`![${iconName}](${hoverIconUri.toString()}|height=32)`);
						}
						markdownString.appendMarkdown(`\\n\\n*CSS rule starts on line ${i + 1}*`);

						// Add options for the hover annotation (same range, but with hoverMessage)
						hoverAnnotations.push({
							range: range,
							hoverMessage: markdownString
						});

						// Break the inner loop (iconName) to move to the next line (i).
						break;
					}
				}
			}
		}

		console.log(`iconfont-for-human: Preparing to apply ${gutterDecorationsToApply.size} types of gutter decorations and ${hoverAnnotations.length} hover annotations.`);

		// --- Apply Decorations --- 
		const currentIconNames = new Set(gutterDecorationsToApply.keys());

		// Clear decorations for icon types that are no longer present in the current view
		for (const [iconName, decorationType] of iconDecorationTypes.entries()) {
			if (!currentIconNames.has(iconName)) {
				console.log(`iconfont-for-human: Clearing decorations for unused type: ${iconName}`);
				activeEditor.setDecorations(decorationType, []);
			}
		}

		// Apply new/updated gutter decorations
		for (const [iconName, decorationOptionsArray] of gutterDecorationsToApply.entries()) {
			const decorationType = iconDecorationTypes.get(iconName);
			if (decorationType) {
				activeEditor.setDecorations(decorationType, decorationOptionsArray);
			} else {
				console.warn(`iconfont-for-human: Gutter decoration type for ${iconName} not found during application.`);
			}
		}

		// Apply hover annotations using the single hover type
		if (hoverAnnotationDecorationType) {
			activeEditor.setDecorations(hoverAnnotationDecorationType, hoverAnnotations);
		} else {
			console.error("iconfont-for-human: Hover annotation decoration type not initialized!");
		}

		console.log("iconfont-for-human: Decorations updated.");
	} // End of updateDecorations

	// --- Initial Setup and Listeners ---
	await findAndParseIconfontCss(); // Parse files first

	let timeout: NodeJS.Timeout | undefined = undefined;
	function triggerUpdateDecorations(throttle = false) {
		if (timeout) {
			clearTimeout(timeout);
			timeout = undefined;
		}
		// Clear existing types if not throttling (e.g., file change)? No, parse handles disposal.
		if (throttle) {
			timeout = setTimeout(updateDecorations, 500);
		} else {
			updateDecorations(); // Immediate update
		}
	}

	// Initial decoration update
	if (activeEditor) {
		triggerUpdateDecorations();
	}

	// --- Event Listeners ---
	vscode.window.onDidChangeActiveTextEditor(editor => {
		console.log("iconfont-for-human: Active editor changed.");
		// Clear decorations from the previous editor
		if (activeEditor) {
			disposeDecorationTypes(activeEditor); // Pass the specific editor to clear
		}
		activeEditor = editor;
		if (editor) {
			// No need to re-parse, just update decorations for the new editor
			triggerUpdateDecorations();
		} else {
			// No active editor, ensure types are disposed
			disposeDecorationTypes();
		}
	}, null, context.subscriptions);

	vscode.workspace.onDidChangeTextDocument(event => {
		if (activeEditor && event.document === activeEditor.document) {
			// console.log("iconfont-for-human: Text document changed."); // Verbose
			triggerUpdateDecorations(true); // Throttle updates on text change
		}
	}, null, context.subscriptions);

	// Listen for theme changes to potentially update icon colors
	vscode.window.onDidChangeActiveColorTheme(async () => {
		console.log("iconfont-for-human: Color theme changed.");
		// Re-parsing might not be needed, but we NEED to recreate SVGs/DecorationTypes
		disposeDecorationTypes(activeEditor); // Dispose old types with old colors
		// Re-create maps? No, maps are fine. Just update decorations.
		if (activeEditor) {
			updateDecorations(); // This will recreate types with new colors via createSvgUri
		}
	}, null, context.subscriptions);

	// Listen for configuration changes if you add settings
	// vscode.workspace.onDidChangeConfiguration(...)

	// Listen for icon file changes (iconfont.css, iconfont.js)
	// This requires setting up a FileSystemWatcher
	const watcherCss = vscode.workspace.createFileSystemWatcher('**/iconfont.css');
	const watcherJs = vscode.workspace.createFileSystemWatcher('**/iconfont.js');

	const reparseAndUpdate = async () => {
		console.log('iconfont-for-human: Icon file changed, reparsing...');
		await findAndParseIconfontCss(); // Reparse both files
		if (activeEditor) {
			triggerUpdateDecorations(); // Update immediately
		}
	};

	watcherCss.onDidChange(reparseAndUpdate, null, context.subscriptions);
	watcherCss.onDidCreate(reparseAndUpdate, null, context.subscriptions);
	watcherCss.onDidDelete(reparseAndUpdate, null, context.subscriptions); // Handle deletion
	watcherJs.onDidChange(reparseAndUpdate, null, context.subscriptions);
	watcherJs.onDidCreate(reparseAndUpdate, null, context.subscriptions);
	watcherJs.onDidDelete(reparseAndUpdate, null, context.subscriptions); // Handle deletion

	context.subscriptions.push(watcherCss, watcherJs);

	console.log('iconfont-for-human: File watchers set up.');

	// Example command remains
	let disposable = vscode.commands.registerCommand('iconfont-for-human.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from iconfont-for-human!');
	});
	context.subscriptions.push(disposable);

} // End of activate

// This method is called when your extension is deactivated
export function deactivate() {
	console.log('iconfont-for-human: Deactivating extension.');
	// Dispose all decoration types (disposeDecorationTypes handles both now)
	disposeDecorationTypes();
	// Clear maps
	iconMap.clear();
	svgPathMap.clear();
}

