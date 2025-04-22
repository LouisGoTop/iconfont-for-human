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
// Map to store Unicode hex value back to icon name
let unicodeToIconNameMap = new Map<string, string>();
// Map to store dynamically created decoration types for Gutter icons (CSS)
let gutterIconDecorationTypes = new Map<string, vscode.TextEditorDecorationType>();
// Map to store dynamically created decoration types for Inline icons (Code)
let inlineIconDecorationTypes = new Map<string, vscode.TextEditorDecorationType>();
// Separate decoration type for hover annotations (invisible for triggering)
let hoverAnnotationDecorationType: vscode.TextEditorDecorationType;
// Map to store info for context menu commands, mapping content line number to icon info
interface IconInfo {
	iconName: string;
	iconUnicode: string | undefined;
	ruleLine: number;
	contentLine: number;
}
let contentLineToIconInfoMap = new Map<number, IconInfo>();

// Map to store info for hover provider, mapping range string to icon details
interface InlineIconHoverInfo {
	iconName: string;
	originalText: string; // e.g., "icon-name" or "&#xe631;"
	range: vscode.Range;
}
// Key: `${doc.uri.toString()}#${range.start.line}:${range.start.character}-${range.end.character}`
// Value: InlineIconHoverInfo
let decoratedRangeToIconInfoMap = new Map<string, InlineIconHoverInfo>();

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
			
			// 从 symbol 内容中提取 path (旧逻辑)
			// const pathMatch = content.match(/<path.+?d="([^"]+)"/);
			// if (pathMatch) {
			// 	const path = pathMatch[1];
			// 	svgPathMap.set(id, path);
			// 	console.log(`iconfont-for-human: Found icon: ${id}`);
			// }

			// 新逻辑：存储 symbol 的完整内部内容
			if (id && content) {
				svgPathMap.set(id, content.trim()); // Store the inner content of the symbol
				console.log(`iconfont-for-human: Found symbol content for: ${id}`);
			}
		}

		console.log(`iconfont-for-human: Successfully parsed ${svgPathMap.size} icons from iconfont.js`);
		
		// 打印前几个图标的信息用于调试
		let count = 0;
		for (const [id, symbolContent] of svgPathMap.entries()) {
			if (count < 3) {
				console.log(`Icon ${count + 1}: id="${id}", content="${symbolContent.substring(0, 80)}..."`);
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
function createSvgUri(iconIdFromMap: string, unicode?: string): vscode.Uri {
	// iconIdFromMap is likely 'icon-xxx' from the iconMap
	const idWithoutPrefix = iconIdFromMap.replace(/^icon-/, '');
	// Try getting symbol content without prefix first, then with prefix
	const symbolContent = svgPathMap.get(idWithoutPrefix) || svgPathMap.get(iconIdFromMap);

	if (!symbolContent) {
		console.warn(`iconfont-for-human: SVG symbol content not found in svgPathMap for ${iconIdFromMap} or ${idWithoutPrefix}`);
		return vscode.Uri.parse(''); // Return empty URI if no content is found
	}

	// 移除根据主题设置颜色的逻辑，使用 symbol 内自带的颜色

	// 创建简化的 SVG 字符串，只包含路径，让 VS Code 控制尺寸
	// viewBox 仍然应该匹配原始 SVG 的坐标系 (例如 1024x1024)
	// 添加背景色和缩放
	const bgColor = 'rgba(255, 255, 255, 0.5)'; // 中性半透明背景
	const scale = 0.96;
	const translation = (1024 * (1 - scale)) / 2;

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="16" height="16">
		<rect x="0" y="0" width="1024" height="1024" fill="${bgColor}"/>
		<g transform="translate(${translation}, ${translation}) scale(${scale})">
			${symbolContent}
		</g>
	</svg>`;
	// Removed: manual path creation, fill color override, background circle, container group, filter

	const encodedSvg = Buffer.from(svg).toString('base64');
	return vscode.Uri.parse(`data:image/svg+xml;base64,${encodedSvg}`);
}

// --- Function to find and parse iconfont.css ---
async function findAndParseIconfontCss() {
	// Clear previous maps
	iconMap.clear();
	svgPathMap.clear();
	unicodeToIconNameMap.clear(); // Clear the new map

	// Dispose existing decoration types before parsing
	disposeDecorationTypes();

	// First parse iconfont.js to get SVG data
	await parseIconFontJs();

	// Search for iconfont.css in the workspace, excluding node_modules
	const cssFiles = await vscode.workspace.findFiles('**/iconfont.css', '**/node_modules/**', 10); // Limit search results

	if (cssFiles.length === 0) {
		console.log('iconfont-for-human: No iconfont.css found in the workspace.');
		return;
	}

	const cssPath = cssFiles[0].fsPath;
	console.log(`iconfont-for-human: Found iconfont.css at ${cssPath}`);

	try {
		const cssContent = await fs.promises.readFile(cssPath, 'utf8');
		const iconRegex = /\.([a-zA-Z0-9_-]+)::?before\s*{\s*content:\s*['"]?(\\[a-fA-F0-9]+)['"]?;?\s*}/g;
		let match;
		while ((match = iconRegex.exec(cssContent))) {
			const iconName = match[1]; // e.g., 'icon-star' (always use the name from CSS class)
			const iconUnicode = match[2].substring(1);
			if (iconName && iconUnicode) {
				// Check if SVG path exists either without prefix (common) or with prefix
				const idWithoutPrefix = iconName.replace(/^icon-/, '');
				if (svgPathMap.has(idWithoutPrefix) || svgPathMap.has(iconName)) {
					iconMap.set(iconName, iconUnicode); // Store with original CSS class name as key
					unicodeToIconNameMap.set(iconUnicode, iconName); // Store reverse mapping
				} else {
					console.warn(`iconfont-for-human: Icon class "${iconName}" found in CSS but no matching SVG symbol found (checked ID: ${idWithoutPrefix} and ${iconName}).`);
				}
			}
		}
		console.log(`iconfont-for-human: Parsed ${iconMap.size} usable icons from ${cssPath}`);
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
		// Clear gutter icon decorations
		for (const decorationType of gutterIconDecorationTypes.values()) {
			targetEditor.setDecorations(decorationType, []);
		}
		// Clear inline icon decorations
		for (const decorationType of inlineIconDecorationTypes.values()) {
			targetEditor.setDecorations(decorationType, []);
		}
		// Clear hover decorations
		if (hoverAnnotationDecorationType) {
			targetEditor.setDecorations(hoverAnnotationDecorationType, []);
		}
	}
	// Then dispose the types
	for (const decorationType of gutterIconDecorationTypes.values()) {
		decorationType.dispose();
	}
	gutterIconDecorationTypes.clear();
	// Dispose inline types
	for (const decorationType of inlineIconDecorationTypes.values()) {
		decorationType.dispose();
	}
	inlineIconDecorationTypes.clear();
	if (hoverAnnotationDecorationType) {
		hoverAnnotationDecorationType.dispose();
		// hoverAnnotationDecorationType = undefined; // Optional: reset variable
	}
	// Clear context menu info map
	contentLineToIconInfoMap.clear();
	// Clear hover provider info
	decoratedRangeToIconInfoMap.clear();
	console.log('iconfont-for-human: Disposed existing decoration types.');
}

// --- Function to find icon info based on content line (for context menu) ---
// Note: This is primarily for CSS context menu, may need adaptation for HTML entities later
function findIconInfoForLine(targetLine: number): IconInfo | undefined {
	return contentLineToIconInfoMap.get(targetLine);
}

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "iconfont-for-human" is now active!');

	// Define supported languages for decorations and hover provider
	const supportedCssLangs = ['css', 'scss', 'sass', 'less', 'stylus'];
	const supportedCodeLangs = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'html'];

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
			disposeDecorationTypes(activeEditor); // Clear existing decorations if maps become empty
			return;
		}

		const doc = activeEditor.document;
		const lineCount = doc.lineCount;
		// Decorations for CSS Gutter icons
		let gutterDecorationsToApply = new Map<string, vscode.DecorationOptions[]>();
		// Decorations for Code Inline icons
		let inlineDecorationsToApply = new Map<string, vscode.DecorationOptions[]>();
		let hoverAnnotations: vscode.DecorationOptions[] = [];
		// Use sets to track decorated ranges/lines to prevent overlap/duplicates if needed
		const decoratedGutterLines = new Set<number>(); // For CSS gutter icons
		const decoratedInlineRanges = new Set<string>(); // Store range strings like "line:start-end"

		// Clear the map for context menu info at the start of each update
		contentLineToIconInfoMap.clear();
		// Clear the map for hover provider info
		decoratedRangeToIconInfoMap.clear();

		const languageId = doc.languageId;

		// --- CSS Logic ---
		if (supportedCssLangs.includes(languageId)) {
			// Iterate through all lines to find CSS rule selectors
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
						if (contentLineFound !== -1 && !decoratedGutterLines.has(contentLineFound)) {
							const targetLine = contentLineFound;
							decoratedGutterLines.add(targetLine); // Mark this line as having a gutter icon

							// --- Store info for context menu ---
							const iconUnicodeForInfo = iconMap.get(iconName);
							const iconInfo: IconInfo = {
								iconName: iconName,
								iconUnicode: iconUnicodeForInfo,
								ruleLine: i,
								contentLine: targetLine
							};
							contentLineToIconInfoMap.set(targetLine, iconInfo);

							// --- Prepare Gutter Icon Decoration (CSS) ---
							// Ensure a decoration type exists for this icon in the GUTTER map
							if (!gutterIconDecorationTypes.has(iconName)) {
								try {
									const iconUri = createSvgUri(iconName);
									if (iconUri.scheme === 'data') {
										const newType = vscode.window.createTextEditorDecorationType({
											gutterIconPath: iconUri,
											gutterIconSize: 'contain',
										});
										gutterIconDecorationTypes.set(iconName, newType);
										// console.log(`iconfont-for-human: Created decoration type for ${iconName}`); // Less verbose
									} else {
										console.warn(`iconfont-for-human: Could not create valid SVG URI for ${iconName} (CSS), skipping.`);
										continue; // Skip this icon if URI is invalid
									}
								} catch(e) {
									console.error(`iconfont-for-human: Error creating decoration type for ${iconName} (CSS)`, e);
									continue; // Skip this icon if type creation fails
								}
							}

							// Apply to Gutter Map
							// Get or initialize the gutter options array for this icon type
							let gutterOptionsArray = gutterDecorationsToApply.get(iconName);
							if (!gutterOptionsArray) {
								gutterOptionsArray = [];
								gutterDecorationsToApply.set(iconName, gutterOptionsArray);
							}
							// Add options for the gutter icon (range only, hover handled separately)
							const gutterRange = new vscode.Range(targetLine, 0, targetLine, 1);
							gutterOptionsArray.push({ range: gutterRange });

							// --- Prepare Hover Annotation ---
							const iconUnicode = iconMap.get(iconName);
							const hoverIconUri = createSvgUri(iconName); // Re-create/get URI for hover
							const markdownString = new vscode.MarkdownString();
							markdownString.isTrusted = true; // Enable potential command URIs or complex rendering
							markdownString.appendMarkdown(`**Icon:** \`${iconName}\`\\n\\n`);
							if (iconUnicode) {
								markdownString.appendMarkdown(`**Unicode:** \`\\\\${iconUnicode}\`\\n\\n`); // Use original CSS format for display
							}
							if (hoverIconUri.scheme === 'data') {
								markdownString.appendMarkdown(`![${iconName}](${hoverIconUri.toString()}|height=32)`);
							}
							markdownString.appendMarkdown(`\\n\\n*CSS rule starts on line ${i + 1}*`);

							// Find the exact range of the content string (e.g., '\\e600') on the target line
							const contentLineText = doc.lineAt(targetLine).text;
							const contentRegex = /content:\s*(['"])(\\?[a-fA-F0-9]+)\1/;
							const match = contentLineText.match(contentRegex);
							let hoverRange: vscode.Range | undefined = undefined;

							if (match && match.index !== undefined) {
								const quoteStartIndex = contentLineText.indexOf(match[1], match.index);
								if (quoteStartIndex !== -1) {
									const stringContent = match[2];
									const startColumn = quoteStartIndex;
									const endColumn = startColumn + match[1].length + stringContent.length + match[1].length;
									hoverRange = new vscode.Range(targetLine, startColumn, targetLine, endColumn);
								}
							}

							// Add hover annotation only if we found the specific range
							if (hoverRange) {
								hoverAnnotations.push({
									range: hoverRange,
									hoverMessage: markdownString
								});
							} else {
								console.warn(`iconfont-for-human: Could not find content string range on line ${targetLine + 1} for icon ${iconName}.`);
							}

							break; // Found icon association for this CSS rule block starting at line i
						}
					}
				}
			}
		}

		// --- HTML Entity and Icon Name Logic (TSX, JS, HTML, etc.) ---
		else if (supportedCodeLangs.includes(languageId)) {
			// Regex for HTML Entities: &#x...;
			const htmlEntityRegex = /&#x([a-fA-F0-9]+);/g;
			// Regex for Icon Name in props: name="icon-..." or name='icon-...' or name={"icon-..."} etc.
			// This regex captures the icon name inside quotes/braces following `name=`
			// It's simplified and might need adjustments for complex cases.
			const iconNamePropRegex = /name=(?:["']|\{["'])(icon-[a-zA-Z0-9_-]+)(?:["']|\}["'])/g;

			// Helper function to add inline decoration
			const addInlineDecoration = (iconName: string, range: vscode.Range, hoverText: string) => {
				const rangeString = `${range.start.line}:${range.start.character}-${range.end.character}`;
				if (decoratedInlineRanges.has(rangeString)) return; // Avoid decorating same range twice

				// Verify SVG path exists
				const idWithoutPrefix = iconName.replace(/^icon-/, '');
				if (!svgPathMap.has(idWithoutPrefix) && !svgPathMap.has(iconName)) {
					console.warn(`iconfont-for-human: SVG path not found for inline icon ${iconName}.`);
					return;
				}

				// Ensure an INLINE decoration type exists
				if (!inlineIconDecorationTypes.has(iconName)) {
					try {
						const iconUri = createSvgUri(iconName);
						if (iconUri.scheme === 'data') {
							// Use 'after' as per user change, simplify styling
							const newInlineType = vscode.window.createTextEditorDecorationType({
								after: {
									contentIconPath: iconUri,
									margin: '0 0 0 0.3em',
								},
								// Restore hiding original text and keep alignment attempt
							});
							inlineIconDecorationTypes.set(iconName, newInlineType);
						} else {
							console.warn(`iconfont-for-human: Could not create valid SVG URI for ${iconName} (Inline), skipping.`);
							return; // Skip if URI creation failed
						}
					} catch (e) {
						console.error(`iconfont-for-human: Error creating inline decoration type for ${iconName}`, e);
						return; // Skip if type creation fails
					}
				}

				// Get or initialize the inline options array for this icon type
				let inlineOptionsArray = inlineDecorationsToApply.get(iconName);
				if (!inlineOptionsArray) {
					inlineOptionsArray = [];
					inlineDecorationsToApply.set(iconName, inlineOptionsArray);
				}

				// Add decoration option (no hover message here, handled by HoverProvider)
				inlineOptionsArray.push({ range: range });
				decoratedInlineRanges.add(rangeString); // Mark range as decorated

				// Store info for HoverProvider
				const hoverInfo: InlineIconHoverInfo = {
					iconName: iconName,
					originalText: hoverText,
					range: range
				};
				const mapKey = `${doc.uri.toString()}#${rangeString}`;
				decoratedRangeToIconInfoMap.set(mapKey, hoverInfo);
			};

			// Iterate through lines for code patterns
			for (let i = 0; i < lineCount; i++) {
				let iconNamePropMatch;
				while ((iconNamePropMatch = iconNamePropRegex.exec(doc.lineAt(i).text)) !== null) {
					const iconName = iconNamePropMatch[1]; // Captured icon name (e.g., "icon-home")
					const fullMatchText = iconNamePropMatch[0]; // e.g., name="icon-home"
					const matchStartIndex = iconNamePropMatch.index;
					// Need null check for index
					if (matchStartIndex === undefined) continue;

					const iconNameStartIndex = doc.lineAt(i).text.indexOf(iconName, matchStartIndex);
					if (iconNameStartIndex === -1) continue; // Should not happen based on regex, but safety check

					const iconNameEndIndex = iconNameStartIndex + iconName.length;
					// Decorate the range of the icon name *inside* the quotes/braces
					const range = new vscode.Range(i, iconNameStartIndex, i, iconNameEndIndex);
					addInlineDecoration(iconName, range, iconName);
					// Reset regex lastIndex to find overlapping/multiple matches on the same line if needed?
					// iconNamePropRegex.lastIndex = matchStartIndex + 1; // Careful with loops
				}
				// Reset regex after searching the line
				iconNamePropRegex.lastIndex = 0;

				// 2. Find HTML Entities: &#x...;
				// Reset regex
				htmlEntityRegex.lastIndex = 0;
				let htmlEntityMatch;
				while ((htmlEntityMatch = htmlEntityRegex.exec(doc.lineAt(i).text)) !== null) {
					const unicodeHex = htmlEntityMatch[1].toLowerCase(); // Normalize hex for lookup
					const iconName = unicodeToIconNameMap.get(unicodeHex); // Look up icon name using the reversed map
					const fullEntity = htmlEntityMatch[0]; // e.g., &#xe600;
					const startIndex = htmlEntityMatch.index;
					// Need null check for index
					if (startIndex === undefined) continue;

					const endIndex = startIndex + fullEntity.length;
					const range = new vscode.Range(i, startIndex, i, endIndex);

					if (iconName) {
						// Add inline decoration for the HTML entity range
						addInlineDecoration(iconName, range, fullEntity);
						// Reset regex lastIndex to find overlapping/multiple matches on the same line if needed?
						// htmlEntityRegex.lastIndex = startIndex + 1; // Careful with loops
					}
				}
				// Reset regex after searching the line
				htmlEntityRegex.lastIndex = 0;
			}
		}

		console.log(`iconfont-for-human: Applying ${gutterDecorationsToApply.size} gutter types, ${inlineDecorationsToApply.size} inline types, ${hoverAnnotations.length} CSS hovers.`);

		// --- Apply Decorations ---
		const currentGutterIconNames = new Set(gutterDecorationsToApply.keys());
		const currentInlineIconNames = new Set(inlineDecorationsToApply.keys());

		// Clear decorations for unused GUTTER icon types
		for (const [iconName, decorationType] of gutterIconDecorationTypes.entries()) {
			if (!currentGutterIconNames.has(iconName)) {
				// console.log(`iconfont-for-human: Clearing decorations for unused gutter type: ${iconName}`);
				activeEditor.setDecorations(decorationType, []);
				// Optionally dispose the type if it's unlikely to be reused soon?
				// decorationType.dispose();
				// gutterIconDecorationTypes.delete(iconName);
			}
		}
		// Clear decorations for unused INLINE icon types
		for (const [iconName, decorationType] of inlineIconDecorationTypes.entries()) {
			if (!currentInlineIconNames.has(iconName)) {
				// console.log(`iconfont-for-human: Clearing decorations for unused inline type: ${iconName}`);
				activeEditor.setDecorations(decorationType, []);
				// Optionally dispose
				// decorationType.dispose();
				// inlineIconDecorationTypes.delete(iconName);
			}
		}

		// Apply new/updated GUTTER decorations (CSS)
		for (const [iconName, decorationOptionsArray] of gutterDecorationsToApply.entries()) {
			const decorationType = gutterIconDecorationTypes.get(iconName);
			if (decorationType) {
				activeEditor.setDecorations(decorationType, decorationOptionsArray);
			} else {
				console.warn(`iconfont-for-human: Gutter decoration type for ${iconName} not found during application.`);
			}
		}

		// Apply new/updated INLINE decorations (Code)
		for (const [iconName, decorationOptionsArray] of inlineDecorationsToApply.entries()) {
			const decorationType = inlineIconDecorationTypes.get(iconName);
			if (decorationType) {
				activeEditor.setDecorations(decorationType, decorationOptionsArray);
			} else {
				console.warn(`iconfont-for-human: Inline decoration type for ${iconName} not found during application.`);
			}
		}

		// Apply CSS hover annotations using the single hover type (Only for CSS content rules)
		// Note: Inline icons handle their hover via their own decoration options
		if (hoverAnnotationDecorationType && hoverAnnotations.length > 0) {
			activeEditor.setDecorations(hoverAnnotationDecorationType, hoverAnnotations);
		} else {
			// Clear previous hover annotations if none are needed now
			if (hoverAnnotationDecorationType) {
				activeEditor.setDecorations(hoverAnnotationDecorationType, []);
			}
			// console.log("iconfont-for-human: No CSS hover annotations to apply or type not init.");
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

	// --- 命令 1: 复制图标名称 ---
	let copyNameDisposable = vscode.commands.registerCommand('iconfont-for-human.copyIconName', () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;
		const position = editor.selection.active;
		const lineNumber = position.line; // 右键点击的行 (0-indexed)

		const iconInfo = findIconInfoForLine(lineNumber); // Use the map lookup

		if (iconInfo) {
			vscode.env.clipboard.writeText(iconInfo.iconName);
			vscode.window.showInformationMessage(`已复制图标名称: ${iconInfo.iconName}`);
		} else {
			vscode.window.showWarningMessage(`未能在行 ${lineNumber + 1} 找到关联的 Iconfont 图标信息。`);
		}
	});
	context.subscriptions.push(copyNameDisposable);

	// --- 命令 2: 复制图标 Unicode ---
	let copyCodeDisposal = vscode.commands.registerCommand('iconfont-for-human.copyIconCode', () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;
		const position = editor.selection.active;
		const lineNumber = position.line; // 右键点击的行 (0-indexed)

		const iconInfo = findIconInfoForLine(lineNumber); // Use the map lookup

		if (iconInfo && iconInfo.iconUnicode) {
            // Format the Unicode as HTML entity &#xXXXX;
            const htmlEntityString = `&#x${iconInfo.iconUnicode};`;
			vscode.env.clipboard.writeText(htmlEntityString);
			vscode.window.showInformationMessage(`已复制 HTML 实体: ${htmlEntityString}`);
		} else if (iconInfo) {
            vscode.window.showWarningMessage(`图标 ${iconInfo.iconName} 未找到关联的 Unicode。`);
        } else {
			vscode.window.showWarningMessage(`未能在行 ${lineNumber + 1} 找到关联的 Iconfont 图标信息。`);
		}
	});
	context.subscriptions.push(copyCodeDisposal);

	// --- Hover Provider ---
	const hoverProvider = vscode.languages.registerHoverProvider(supportedCodeLangs, {
		provideHover(document, position, token) {
			// Find if the hover position is within any decorated range for this document
			let matchedInfo: InlineIconHoverInfo | undefined = undefined;
			for (const [key, info] of decoratedRangeToIconInfoMap.entries()) {
				const keyPrefix = `${document.uri.toString()}#`;
				if (key.startsWith(keyPrefix) && info.range.contains(position)) {
					matchedInfo = info;
					break;
				}
			}

			if (matchedInfo) {
				const markdown = new vscode.MarkdownString();
				markdown.isTrusted = true; // IMPORTANT: Allows commands to be executed

				// Get the icon URI for display
				const iconUri = createSvgUri(matchedInfo.iconName);

				// Add the large icon image at the top using HTML img tag for better control
				if (iconUri.scheme === 'data') {
					markdown.appendMarkdown(`<img src="${matchedInfo.originalText}" alt="${matchedInfo.iconName}" />\n\n`); 
				}

				// Command arguments need to be URI-encoded JSON strings
				const nameArgs = encodeURIComponent(JSON.stringify({ iconName: matchedInfo.iconName }));
				const componentArgs = encodeURIComponent(JSON.stringify({ component: `<Icon name="${matchedInfo.iconName}" />` }));
				const codeArgs = encodeURIComponent(JSON.stringify({ originalText: matchedInfo.originalText }));
				markdown.appendMarkdown(`[**点击复制 icon name**](command:iconfont-for-human.copyIconNameFromHover?${nameArgs} \"Copy icon name\")`);
				markdown.appendMarkdown(`&nbsp;&nbsp;|&nbsp;&nbsp;`); // Separator
				markdown.appendMarkdown(` \`${matchedInfo.iconName}\`\n`); // Single newline for closer info lines
				markdown.appendMarkdown(`\n---\n\n`); // Horizontal rule with spacing

				markdown.appendMarkdown(`[**点击复制 Icon 组件**](command:iconfont-for-human.copyIconComponentFromHover?${componentArgs} \"Copy icon component\")`);
				markdown.appendMarkdown(`&nbsp;&nbsp;|&nbsp;&nbsp;`); // Separator
				markdown.appendMarkdown(` \`<Icon name="${matchedInfo.iconName}" />\`\n`); // Single newline for closer info lines
				markdown.appendMarkdown(`\n---\n\n`); // Horizontal rule with spacing
				markdown.appendMarkdown(`[~~点击复制 icon code~~](command:iconfont-for-human.copyIconCodeFromHover?${codeArgs} \"Copy original code string\")`);

				markdown.appendMarkdown(`&nbsp;&nbsp;|&nbsp;&nbsp;`); // Separator
				markdown.appendMarkdown(` \`${matchedInfo.originalText}\` ~~不推荐，随时废弃~~\n`);
				
				// Separator
				markdown.appendMarkdown(`\n---\n\n`); // Horizontal rule with spacing
				


				return new vscode.Hover(markdown, matchedInfo.range);
			}

			return undefined; // No hover info for this position
		}
	});
	context.subscriptions.push(hoverProvider);

	// --- Commands for Hover Provider ---
	const copyNameFromHoverCommand = vscode.commands.registerCommand('iconfont-for-human.copyIconNameFromHover', (args: { iconName: string }) => {
		if (args && args.iconName) {
			vscode.env.clipboard.writeText(args.iconName);
			vscode.window.showInformationMessage(`Copied Name: ${args.iconName}`);
		}
	});
	context.subscriptions.push(copyNameFromHoverCommand);

	const copyIconComponentFromHoverCommand = vscode.commands.registerCommand('iconfont-for-human.copyIconComponentFromHover', (args: { component: string }) => {
		if (args && args.component) {
			vscode.env.clipboard.writeText(args.component);
			vscode.window.showInformationMessage(`Copied Icon: ${args.component}`);
		}
	});
	context.subscriptions.push(copyIconComponentFromHoverCommand);

	const copyCodeFromHoverCommand = vscode.commands.registerCommand('iconfont-for-human.copyIconCodeFromHover', (args: { originalText: string }) => {
		if (args && args.originalText) {
			vscode.env.clipboard.writeText(args.originalText);
			vscode.window.showInformationMessage(`Copied Code: ${args.originalText}`);
		}
	});
	context.subscriptions.push(copyCodeFromHoverCommand);

} // End of activate

// This method is called when your extension is deactivated
export function deactivate() {
	console.log('iconfont-for-human: Deactivating extension.');
	// Dispose all decoration types (disposeDecorationTypes handles both now)
	disposeDecorationTypes(); // This will also clear contentLineToIconInfoMap
	// Clear maps (already done in dispose, but belt-and-suspenders)
	iconMap.clear();
	svgPathMap.clear();
	contentLineToIconInfoMap.clear(); // Explicit clear here too
	unicodeToIconNameMap.clear(); // Clear the new map
}

