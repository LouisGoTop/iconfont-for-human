// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// This decoration type will be used to add icons in the gutter
const iconDecorationType = vscode.window.createTextEditorDecorationType({
	gutterIconSize: '20px',
	isWholeLine: false
});

// Map to store icon class names and their corresponding unicode/SVG data
let iconMap = new Map<string, string>();
// Map to store SVG path data
let svgPathMap = new Map<string, string>();

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
function createSvgUri(iconId: string, unicode?: string): vscode.Uri {
	const svgPath = svgPathMap.get(iconId); // Look up using ID directly

	if (!svgPath) {
		// If SVG path not found, maybe try to use unicode or fall back to placeholder
		// For now, let's just use the placeholder if SVG is missing
		// We use the iconId for placeholder generation
		return createPlaceholderSvgUri(iconId, unicode || ''); // Pass iconId to placeholder
	}

	// 根据 VS Code 主题设置颜色
	const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
	const iconColor = isDark ? '#FFFFFF' : 'rgba(0, 0, 0, 0.9)';
	const bgColor = isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.05)';

	// 创建完整的 SVG 字符串
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="20" height="20" style="position: absolute; top: 50%; transform: translateY(-50%);">
		<style>
			.icon-bg { fill: ${bgColor}; }
			.icon-path { fill: ${iconColor}; }
			.icon-container { transform: scale(0.7) translate(220px, 220px); }
		</style>
		<defs>
			<filter id="shadow">
				<feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-opacity="0.3"/>
			</filter>
		</defs>
		<circle class="icon-bg" cx="512" cy="512" r="512"/>
		<g class="icon-container">
			<path class="icon-path" d="${svgPath}" filter="url(#shadow)"></path>
		</g>
	</svg>`;

	const encodedSvg = Buffer.from(svg).toString('base64');
	return vscode.Uri.parse(`data:image/svg+xml;base64,${encodedSvg}`);
}

// --- Function to find and parse iconfont.css ---
async function findAndParseIconfontCss() {
	// Clear previous maps
	iconMap.clear();
	svgPathMap.clear();

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
		const iconRegex = /\.([a-zA-Z0-9_-]+)::?before\s*{\s*content:\s*['"]?\\([a-fA-F0-9]+)['"]?;?\s*}/g;
		let match;
		while ((match = iconRegex.exec(cssContent))) {
			const iconName = match[1]; // e.g., 'icon-star'
			const iconUnicode = match[2]; // e.g., 'e600'
			if (iconName && iconUnicode) {
				iconMap.set(iconName, iconUnicode);
			}
		}
		console.log(`iconfont-for-human: Parsed ${iconMap.size} icons from ${cssPath}`);
		// TODO: Trigger decoration update for open editors if needed after parsing
	} catch (error) {
		console.error(`iconfont-for-human: Error reading or parsing ${cssPath}:`, error);
		vscode.window.showErrorMessage(`iconfont-for-human: Failed to parse ${cssPath}. See console for details.`);
	}
}

// --- Function to create a placeholder SVG data URI ---
// Accepts icon name/id and optional unicode
function createPlaceholderSvgUri(iconIdentifier: string, unicode: string): vscode.Uri {
	// Simple hash function for consistent color generation based on icon identifier
	let hash = 0;
	for (let i = 0; i < iconIdentifier.length; i++) {
		hash = iconIdentifier.charCodeAt(i) + ((hash << 5) - hash);
	}
	const color = `hsl(${hash % 360}, 90%, 70%)`; // Generate a color

	// Get the first character of the identifier (remove icon- prefix if present)
	const initial = iconIdentifier.replace(/^icon-/i, '').charAt(0).toUpperCase() || '?';

	// Create a simple SVG string
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="16" height="16">
        <rect width="100" height="100" rx="15" ry="15" fill="${color}"></rect>
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-size="60" font-family="sans-serif">${initial}</text>
    </svg>`;

	// Encode the SVG string for the data URI
	const encodedSvg = Buffer.from(svg).toString('base64');
	const dataUri = `data:image/svg+xml;base64,${encodedSvg}`;

	return vscode.Uri.parse(dataUri);
}

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "iconfont-for-human" is now active!');

	// Initial parsing of iconfont.css
	await findAndParseIconfontCss();

	let activeEditor = vscode.window.activeTextEditor;

	function updateDecorations() {
		if (!activeEditor || iconMap.size === 0) {
			if (activeEditor) {
				activeEditor.setDecorations(iconDecorationType, []);
			}
			return;
		}

		const text = activeEditor.document.getText();
		const decorations: vscode.DecorationOptions[] = [];

		// 根据文件类型使用不同的匹配逻辑
		switch (activeEditor.document.languageId) {
			case 'css':
				// --- Refined CSS icon matching logic ---
				// Regex to find the whole rule block containing the icon class and content property
				const cssRuleRegex = /(\.([a-zA-Z0-9_-]+)::?before\s*{[\s\S]*?content:\s*['"]?(\\[a-fA-F0-9]+)['"]?;?[\s\S]*?})/g;
				let cssMatch;
				while ((cssMatch = cssRuleRegex.exec(text))) {
					const fullMatchText = cssMatch[1];    // The entire matched rule block text
					const iconName = cssMatch[2];         // The icon class name (e.g., icon-xxx)
					const unicodeValueHex = cssMatch[3];  // The raw unicode hex string (e.g., e900)
					const ruleStartIndex = cssMatch.index; // Start index of the rule in the document

					// Verify if we have data for this icon (parsed from CSS or JS)
					if (iconMap.has(iconName) || svgPathMap.has(iconName.replace(/^icon-/, ''))) {
						const mappedUnicode = iconMap.get(iconName) || unicodeValueHex; // Prefer mapped, fallback to regex match

						// Find the precise start and end index of the 'content: ...;' part within the rule
						const contentPropertyRegex = /content:\s*(['"]?)(\\[a-fA-F0-9]+)\1;?/;
						const contentMatch = contentPropertyRegex.exec(fullMatchText);

						if (contentMatch) {
							const contentPropertyValue = contentMatch[0]; // e.g., "content: '\\e900';"
							const quoteChar = contentMatch[1]; // The quote character used (or empty)
							const unicodeValue = contentMatch[2]; // The actual unicode value, e.g., \\e900
							const contentValueIndexInRule = fullMatchText.indexOf(contentPropertyValue);

							// Find the index of the actual unicode *within* the content property value
							const unicodeIndexInProperty = contentPropertyValue.indexOf(unicodeValue);

							// Calculate absolute start/end indices for the unicode value in the document
							const unicodeStartIndex = ruleStartIndex + contentValueIndexInRule + unicodeIndexInProperty;
							const unicodeEndIndex = unicodeStartIndex + unicodeValue.length;

							// Create a precise range for the unicode value itself
							const startPos = activeEditor.document.positionAt(unicodeStartIndex);
							const endPos = activeEditor.document.positionAt(unicodeEndIndex);
							const specificRange = new vscode.Range(startPos, endPos);

							// Create hover message
							const hoverMessage = new vscode.MarkdownString();
							hoverMessage.isTrusted = true;
							hoverMessage.appendMarkdown(`**Icon Class:** \`${iconName}\`\n\n`);
							hoverMessage.appendMarkdown(`**Unicode:** \`${unicodeValue.replace('\\', '\\')}\`\n`); // Display as \xxxx
							if (svgPathMap.has(iconName.replace(/^icon-/, ''))) {
								hoverMessage.appendMarkdown(`\n*(SVG path data found)*`);
							} else {
								hoverMessage.appendMarkdown(`\n*(Using placeholder)*`);
							}

							// Get the SVG icon URI (using the mapped/found unicode)
							const iconUri = createSvgUri(iconName, mappedUnicode); // Use mappedUnicode from outer scope

							decorations.push({
								range: specificRange, // Apply decoration specifically to the unicode range
								hoverMessage,
								renderOptions: {
									// Place the icon immediately after the unicode value
									after: {
										contentIconPath: iconUri,
										margin: '0 0 0 2px', // Reduced left margin
										width: '16px',
										height: '16px'
									}
								}
							});
						}
					}
				}
				break;

			case 'javascript':
			case 'typescript':
				// Match lines like "key": "&#xeXXX;", or 'key': '&#xeXXX;'
				// Captures key (group 1) and HTML entity (group 2)
				const jsIconRegex = /^\s*['"`]([a-zA-Z0-9_-]+)['"`]:\s*['"`](&#x[a-fA-F0-9]+;?)['"`]/gm;
				let jsMatch;
				while ((jsMatch = jsIconRegex.exec(text))) {
					const iconId = jsMatch[1];        // e.g., "dropdown"
					const htmlEntity = jsMatch[2];    // e.g., "&#xe945;"
					const potentialIconName = `icon-${iconId}`; // For iconMap lookup

					// Find corresponding unicode from iconMap (might be needed for placeholder/hover)
					const unicodeHex = iconMap.get(potentialIconName);

					// Check if we have SVG data or at least unicode data
					if (svgPathMap.has(iconId) || unicodeHex) {
						const startPos = activeEditor.document.positionAt(jsMatch.index);
						const lineRange = activeEditor.document.lineAt(startPos.line).range;

						// Create hover message
						const hoverMessage = new vscode.MarkdownString();
						hoverMessage.isTrusted = true;
						hoverMessage.appendMarkdown(`**Icon Key:** \`${iconId}\`\n\n`);
						hoverMessage.appendMarkdown(`**Value:** \`${htmlEntity}\`\n`);
						if (unicodeHex) {
							hoverMessage.appendMarkdown(`**Mapped Unicode:** \`\\${unicodeHex}\`\n`);
						}
						if (svgPathMap.has(iconId)) {
							hoverMessage.appendMarkdown(`\n*(SVG path data found)*`);
						} else {
							hoverMessage.appendMarkdown(`\n*(Using placeholder / CSS unicode)*`);
						}

						// Create SVG URI using the iconId (no prefix)
						const iconUri = createSvgUri(iconId, unicodeHex); // Pass optional unicodeHex

						decorations.push({
							range: lineRange, // Apply to the whole line
							hoverMessage,
							renderOptions: {
								// Use gutterIconPath to place the icon in the gutter
								gutterIconPath: iconUri,
								// gutterIconSize can be controlled by the decoration type definition
							}
						});
					}
				}
				break;

			case 'javascriptreact':
			case 'typescriptreact':
				// JSX/TSX 文件中的 Icon 组件匹配逻辑
				const iconComponentRegex = /<Icon\s+[^>]*?type=["']([^"']+)["'][^>]*?\/?>/g;
				let jsxMatch;
				while ((jsxMatch = iconComponentRegex.exec(text))) {
					const iconName = jsxMatch[1];
					const fullIconName = iconName;
					
					if (iconMap.has(fullIconName)) {
						const unicodeValue = iconMap.get(fullIconName);
						const startPos = activeEditor.document.positionAt(jsxMatch.index);
						const lineRange = activeEditor.document.lineAt(startPos.line).range;

						const hoverMessage = new vscode.MarkdownString();
						hoverMessage.appendMarkdown(`**Icon Component**\n\n`);
						hoverMessage.appendMarkdown(`- Name: \`${iconName}\`\n`);
						hoverMessage.appendMarkdown(`- Full Name: \`${fullIconName}\`\n`);
						hoverMessage.appendMarkdown(`- Unicode: \`\\${unicodeValue}\``);

						const iconUri = createSvgUri(fullIconName, unicodeValue!);

						decorations.push({
							range: lineRange,
							hoverMessage,
							renderOptions: {
								after: {
									contentIconPath: iconUri,
									margin: '0 0 0 8px',
									width: '20px',
									height: '20px'
								}
							}
						});
					}
				}
				break;
		}

		activeEditor.setDecorations(iconDecorationType, decorations);
	}

	let timeout: NodeJS.Timeout | undefined = undefined;
	function triggerUpdateDecorations(throttle = false) {
		if (timeout) {
			clearTimeout(timeout);
			timeout = undefined;
		}
		if (throttle) {
			timeout = setTimeout(updateDecorations, 500);
		} else {
			updateDecorations();
		}
	}

	if (activeEditor) {
		triggerUpdateDecorations();
	}

	vscode.window.onDidChangeActiveTextEditor(editor => {
		activeEditor = editor;
		if (editor) {
			triggerUpdateDecorations();
		}
	}, null, context.subscriptions);

	vscode.workspace.onDidChangeTextDocument(event => {
		if (activeEditor && event.document === activeEditor.document) {
			triggerUpdateDecorations(true);
		}
	}, null, context.subscriptions);

	// 监听主题变化，重新生成图标
	vscode.window.onDidChangeActiveColorTheme(() => {
		if (activeEditor) {
			updateDecorations();
		}
	}, null, context.subscriptions);

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('iconfont-for-human.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from iconfont-for-human!');
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {
	// Clear the map on deactivation
	iconMap.clear();
	svgPathMap.clear();
}
