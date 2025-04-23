'use strict';

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as Font from 'fonteditor-core'; // 引入 fonteditor-core
import * as pako from 'pako'; // 尝试显式引入 pako

// --- 全局变量和类型定义 ---

// 存储图标 CSS 类名 => Unicode 映射 (来自 iconfont.css)
let iconMap = new Map<string, string>();
// 存储图标 ID => SVG <symbol> 内部内容的映射 (来自 iconfont.js)
let svgPathMap = new Map<string, string>();
// 存储 Unicode 十六进制值 => 图标名称的反向映射 (用于 HTML 实体查找)
let unicodeToIconNameMap = new Map<string, string>();
// 存储 Gutter 图标的 DecorationType (Key: iconName)
let gutterIconDecorationTypes = new Map<string, vscode.TextEditorDecorationType>();
// 存储内联替换图标的 DecorationType (Key: iconName)
let inlineIconDecorationTypes = new Map<string, vscode.TextEditorDecorationType>();
// 用于 CSS 文件中 `content` 属性悬停提示的 DecorationType (本身不可见)
let hoverAnnotationDecorationType: vscode.TextEditorDecorationType;

// CSS 图标的右键菜单信息接口
interface IconInfo {
	iconName: string;
	iconUnicode: string | undefined;
	ruleLine: number; // CSS 规则选择器所在的行 (0-based)
	contentLine: number; // CSS `content` 属性所在的行 (0-based)
}
// CSS `content` 行号 => IconInfo 映射 (用于右键菜单)
let contentLineToIconInfoMap = new Map<number, IconInfo>();

// 内联图标的悬停提示信息接口
interface InlineIconHoverInfo {
	iconName: string;
	originalText: string; // 例如 "icon-name" 或 "&#xe631;"
	range: vscode.Range; // 图标在代码中的精确范围
}
// 范围标识符 => InlineIconHoverInfo 映射 (用于 HoverProvider)
// Key 格式: `${文档 URI}#${起始行}:${起始字符}-${结束字符}`
let decoratedRangeToIconInfoMap = new Map<string, InlineIconHoverInfo>();

// --- 新增：存储当前字体预览 Webview --- 
let currentFontPreviewPanel: vscode.WebviewPanel | undefined = undefined;

// --- 文件解析函数 ---

// 解析 iconfont.js, 提取 SVG <symbol> 内容
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
	const scale = 1;
	const translation = (1024 * (1 - scale)) / 2;

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="13" height="13" style="position: absolute; top: 0; display: inline-block;">
		<rect x="0" y="0" width="1024" height="1024" fill="${bgColor}" stroke="#000000" stroke-width="5" />
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

// --- 新增：创建和管理字体预览 Webview 的函数 ---
async function createOrShowFontPreviewPanel(context: vscode.ExtensionContext, document: vscode.TextDocument) {
	const column = vscode.window.activeTextEditor
		? vscode.window.activeTextEditor.viewColumn
		: undefined;

	const filePath = document.uri.fsPath;
	const fileExtension = path.extname(filePath).toLowerCase();
	const fileName = path.basename(filePath);

	// 如果已存在面板，则显示它
	if (currentFontPreviewPanel) {
		currentFontPreviewPanel.reveal(column);
		// 如果打开了新的字体文件，需要更新 webview 内容
		// 在这里重新发送数据
		await sendFontDataToWebview(document, currentFontPreviewPanel.webview);
		currentFontPreviewPanel.title = `预览: ${fileName}`; // 更新标题
		return;
	}

	// 否则，创建新面板
	currentFontPreviewPanel = vscode.window.createWebviewPanel(
		'fontPreview', // 内部类型
		`预览: ${fileName}`, // 显示给用户的标题
		column || vscode.ViewColumn.One, // 显示在哪个视图列
		{
			enableScripts: true, // 允许执行 JS
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] // 允许访问 media 目录
		}
	);

	// 设置 HTML 内容
	currentFontPreviewPanel.webview.html = await getWebviewContent(context, currentFontPreviewPanel.webview);

	// 当面板关闭时，清理资源
	currentFontPreviewPanel.onDidDispose(
		() => {
			currentFontPreviewPanel = undefined;
		},
		null,
		context.subscriptions
	);

	// 面板创建后，立即发送字体数据
	await sendFontDataToWebview(document, currentFontPreviewPanel.webview);

	// (可选) 监听来自 Webview 的消息
	currentFontPreviewPanel.webview.onDidReceiveMessage(
		message => {
			switch (message.command) {
				case 'alert':
					vscode.window.showErrorMessage(message.text);
					return;
				// 可以添加更多命令处理
			}
		},
		null,
		context.subscriptions
	);
}

// --- 新增：获取 Webview 的 HTML 内容 --- 
async function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview): Promise<string> {
	const htmlPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'load-ttf.html');
	const cssPathOnDisk = vscode.Uri.joinPath(context.extensionUri, 'media', 'load-ttf.css');
	const jsPathOnDisk = vscode.Uri.joinPath(context.extensionUri, 'media', 'load-ttf.js');

	// 将本地文件路径转换为 Webview 可以使用的 URI
	const cssUri = webview.asWebviewUri(cssPathOnDisk);
	const jsUri = webview.asWebviewUri(jsPathOnDisk);

	// 读取 HTML 文件内容
	let htmlContent = await fs.promises.readFile(htmlPath.fsPath, 'utf8');

	// 替换 HTML 中指向 CSS 和 JS 的链接
	htmlContent = htmlContent.replace('./load-ttf.css', cssUri.toString());
	htmlContent = htmlContent.replace('./load-ttf.js', jsUri.toString());

	return htmlContent;
}

// --- 新增：读取字体文件并发送到 Webview --- 
async function sendFontDataToWebview(document: vscode.TextDocument, webview: vscode.Webview) {
	const filePath = document.uri.fsPath;
	const fileExtension = path.extname(filePath).toLowerCase();

	try {
		const fileBuffer = await fs.promises.readFile(filePath);
		const base64Data = fileBuffer.toString('base64');

		// 发送消息到 Webview
		webview.postMessage({
			command: 'loadFont',
			data: base64Data,
			extension: fileExtension // e.g., '.ttf'
		});
		console.log(`iconfont-for-human: Sent font data (${fileExtension}) to webview.`);
	} catch (error) {
		console.error(`iconfont-for-human: Error reading or sending font file ${filePath}:`, error);
		vscode.window.showErrorMessage(`无法读取或发送字体文件: ${path.basename(filePath)}`);
		// 可以向 Webview 发送错误消息
		webview.postMessage({
			command: 'loadError',
			message: `无法读取字体文件: ${path.basename(filePath)}`
		});
	}
}

// --- 新增：Custom Editor Provider 实现 ---
class FontPreviewProvider implements vscode.CustomReadonlyEditorProvider<vscode.CustomDocument> {

	public static readonly viewType = 'font.preview'; // 必须与 package.json 中的 viewType 一致

	constructor(
		private readonly context: vscode.ExtensionContext
	) { }

	// 对于只读编辑器，openCustomDocument 通常只需要返回 document 自身
	openCustomDocument(
		uri: vscode.Uri,
		openContext: vscode.CustomDocumentOpenContext,
		token: vscode.CancellationToken
	): vscode.CustomDocument | Thenable<vscode.CustomDocument> {
		// 这里可以添加读取文件初始状态的逻辑，但对于只读二进制文件，
		// 简单地返回一个包含 URI 的对象通常足够了。
		// 核心数据将在 resolveCustomEditor 中加载。
		return { uri, dispose: () => { /* 清理逻辑 */ } };
	}

	public async resolveCustomEditor(
		document: vscode.CustomDocument, // 参数类型改为 CustomDocument
		webviewPanel: vscode.WebviewPanel,
		token: vscode.CancellationToken
	): Promise<void> {
		console.log(`iconfont-for-human: Resolving custom editor for ${document.uri.fsPath}`);

		// 设置 Webview 选项
		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
		};

		// 设置 Webview HTML 内容
		webviewPanel.webview.html = await getWebviewContent(this.context, webviewPanel.webview);

		// 发送字体数据 - 修改 sendFontDataToWebview 以接受 Uri
		await sendFontDataToWebviewFromUri(document.uri, webviewPanel.webview); // 使用新的辅助函数

		// (可选) 监听来自 Webview 的消息
		webviewPanel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'alert':
						vscode.window.showErrorMessage(message.text);
						return;
					// 可以添加更多命令处理
				}
			},
			null,
			this.context.subscriptions // 将 listener 添加到 context subscriptions
		);

		// (可选) 可以在这里添加 dispose 时的清理逻辑，如果需要的话
		// webviewPanel.onDidDispose(() => { ... }, null, this.context.subscriptions);
	}
}

// --- 修改：sendFontDataToWebview 以接受 Uri --- 
// 重命名并修改函数以接收 Uri 而不是 TextDocument
async function sendFontDataToWebviewFromUri(uri: vscode.Uri, webview: vscode.Webview) {
	const filePath = uri.fsPath;
	const fileExtension = path.extname(filePath).toLowerCase();
	const suffix = fileExtension.substring(1);

	try {
		// 使用 workspace.fs 读取文件内容
		const fileBuffer = Buffer.from(await vscode.workspace.fs.readFile(uri));
		const base64Data = fileBuffer.toString('base64');

		if (suffix == 'woff2') {
			// result = openType.parse(buffer.buffer)
			await Font.woff2.init(fileBuffer)
		}

		// --- 新增：在后端解析字体 ---
		// 使用 Font.Font.create 并根据你的要求添加 inflate 选项
		const fontInstance = Font.Font.create(fileBuffer, {
			type: suffix as any,
			// @ts-ignore - 显式提供 inflate 函数给 woff 类型
			inflate: suffix === 'woff' ? pako.inflate : undefined
		});
		const fontData = fontInstance.get(); // 使用 get() 获取数据

		// 从 fontData.glyf 获取字形，并过滤掉没有 unicode 的
		// 为 g 添加 any 类型以解决隐式 any 问题
		const glyphs = (fontData.glyf || []).filter((g: any) => g.unicode && g.unicode.length > 0);

		// 提取需要的信息 (unicode 和 name)
		// 注意：unicode 可能是数组，我们通常取第一个
		// 为 g 添加 any 类型
		const glyphsData = glyphs.map((g: any) => {
			const unicodeDecimal = g.unicode![0]; // 取第一个 unicode
			return {
				unicode: unicodeDecimal,
				name: g.name || `uni${unicodeDecimal.toString(16).toUpperCase()}`
			};
		});
		// ------------------------

		// 发送消息到 Webview (包含原始 base64 和解析后的字形数据)
		webview.postMessage({
			command: 'loadFont',
			base64Data: base64Data, // 用于 @font-face
			glyphsData: glyphsData,  // 使用正确的键名 glyphsData
			extension: fileExtension // e.g., '.ttf'
		});
		console.log(`iconfont-for-human: Sent font data (${fileExtension}) and ${glyphsData.length} glyphs to webview.`);
	} catch (error: any) { // More specific error handling
		console.error(`iconfont-for-human: Error reading or parsing font file ${filePath}:`, error);
		let errorMessage = `无法解析字体文件: ${path.basename(filePath)}`;
		if (error instanceof Error) {
			errorMessage += `\nError: ${error.message}`;
		}
		vscode.window.showErrorMessage(errorMessage);
		// 可以向 Webview 发送错误消息
		webview.postMessage({
			command: 'loadError',
			message: errorMessage
		});
	}
}

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "iconfont-for-human" is now active!');

	// --- 注册 Custom Editor Provider ---
	const fontPreviewProvider = new FontPreviewProvider(context);
	context.subscriptions.push(
		// 移除不必要的类型参数
		vscode.window.registerCustomEditorProvider(FontPreviewProvider.viewType, fontPreviewProvider)
	);
	console.log(`iconfont-for-human: Registered ${FontPreviewProvider.viewType}`);

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
								} catch (e) {
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
							markdownString.appendMarkdown(`**Icon:** \`${iconName}\`\n`);
							if (iconUnicode) {
								markdownString.appendMarkdown(`**CSS Code:** \`\\${iconUnicode}\`\n`);
							}
							markdownString.appendMarkdown(`*CSS 规则定义在第 ${i + 1} 行*`);

							// Find the exact range of the content string (e.g., '\e600') on the target line
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
			// Updated Regex: Tries to ensure it's within an <Icon ...> tag context on the same line.
			// Supports icon-, 1-, 1.5- prefixes
			const iconNamePropRegex = /name=(?:["']|\{["'])((?:icon-|1-|1\.5-)[a-zA-Z0-9_-]+)(?:["']|\}["'])/g;

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
									margin: '0 0 0 0.2em', // 左侧边距
								},
								isWholeLine: false,
								rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
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

	// --- triggerUpdateDecorations 函数 (保持不变) ---
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

	// Initial decoration update for non-custom editors
	if (activeEditor && activeEditor.document.uri.scheme !== 'vscode-custom-editor') {
		triggerUpdateDecorations();
	}

	// --- Event Listeners (保持不变, 但移除字体检查逻辑) ---
	vscode.window.onDidChangeActiveTextEditor(async editor => {
		console.log("iconfont-for-human: Active editor changed.");
		// Clear decorations from the previous editor if it wasn't a custom editor
		if (activeEditor && activeEditor.document.uri.scheme !== 'vscode-custom-editor') {
			disposeDecorationTypes(activeEditor);
		}
		activeEditor = editor;
		if (editor) {
			// --- 移除旧的字体文件检查逻辑 ---
			// const doc = editor.document;
			// const ext = path.extname(doc.uri.fsPath).toLowerCase();
			// if (['.ttf', '.woff', '.woff2'].includes(ext)) {
			// 	await createOrShowFontPreviewPanel(context, doc);
			// } else {
			// 	// 如果切换到非字体文件，并且预览面板存在，可以选择关闭或保留
			// 	// currentFontPreviewPanel?.dispose(); // 如果需要自动关闭
			// }
			// -----------------------------------------
			// Update decorations for the new editor only if it's NOT a custom editor
			if (editor.document.uri.scheme !== 'vscode-custom-editor') {
				triggerUpdateDecorations();
			} else {
				// If it IS a custom editor, ensure decorations are cleared from it if any existed
				disposeDecorationTypes(editor);
			}
		} else {
			// No active editor, ensure types are disposed
			disposeDecorationTypes();
		}
	}, null, context.subscriptions);

	vscode.workspace.onDidChangeTextDocument(event => {
		// Update decorations only if the change is in the active editor AND it's not a custom editor
		if (activeEditor && event.document === activeEditor.document && activeEditor.document.uri.scheme !== 'vscode-custom-editor') {
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
		if (activeEditor && activeEditor.document.uri.scheme !== 'vscode-custom-editor') {
			updateDecorations(); // This will recreate types with new colors via createSvgUri
		}
	}, null, context.subscriptions);

	// Listen for icon file changes (iconfont.css, iconfont.js)
	const watcherCss = vscode.workspace.createFileSystemWatcher('**/iconfont.css');
	const watcherJs = vscode.workspace.createFileSystemWatcher('**/iconfont.js');

	const reparseAndUpdate = async () => {
		console.log('iconfont-for-human: Icon file changed, reparsing...');
		await findAndParseIconfontCss(); // Reparse both files
		if (activeEditor && activeEditor.document.uri.scheme !== 'vscode-custom-editor') {
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

	// --- 保留原有的命令、菜单、HoverProvider 等 --- 

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
			// 增加判断：不在自定义编辑器中提供悬停
			if (document.uri.scheme === 'vscode-custom-editor') {
				return undefined;
			}
			// Find if the hover position is within any decorated range for this document
			let matchedInfo: InlineIconHoverInfo | undefined = undefined;
			let matchedKey: string | undefined = undefined; // Store the key for later range expansion

			for (const [key, info] of decoratedRangeToIconInfoMap.entries()) {
				const keyPrefix = `${document.uri.toString()}#`;
				if (key.startsWith(keyPrefix) && info.range.contains(position)) {
					matchedInfo = info;
					matchedKey = key; // Store the key
					break;
				}
			}

			if (matchedInfo) {
				const markdown = new vscode.MarkdownString();
				markdown.isTrusted = true; // IMPORTANT: Allows commands to be executed
				markdown.supportHtml = true;

				// Get the icon URI for display
				const iconUri = createSvgUri(matchedInfo.iconName);

				// Add the large icon image at the top using HTML img tag for better control
				if (iconUri.scheme === 'data') {
					// 将当前代码
					markdown.appendMarkdown(`![${matchedInfo.iconName}](${iconUri.toString(true)}|width=70|height=70)\n\n`);
				}

				// Command arguments need to be URI-encoded JSON strings
				const nameArgs = encodeURIComponent(JSON.stringify({ iconName: matchedInfo.iconName }));
				const componentArgs = encodeURIComponent(JSON.stringify({ component: `<Icon name="${matchedInfo.iconName}" />` }));

				// 添加反向映射逻辑：从 iconName 获取对应的 Unicode
				let originalCode = matchedInfo.originalText;
				if (!originalCode.startsWith('&#x')) {
					// 如果不是 HTML 实体形式，尝试通过 iconMap 进行反向查找
					for (const [name, unicode] of iconMap.entries()) {
						if (name === matchedInfo.iconName) {
							originalCode = `&#x${unicode};`;
							break;
						}
					}
				}
				const codeArgs = encodeURIComponent(JSON.stringify({ originalText: originalCode }));

				// --- 修改："复制 Code" 命令和描述 ---
				markdown.appendMarkdown(`[~~点击复制 Code~~](command:iconfont-for-human.copyIconCodeFromHover?${codeArgs} "Copy code as HTML entity")`);
				markdown.appendMarkdown(`&nbsp;&nbsp;|&nbsp;&nbsp;`); // Separator
				markdown.appendMarkdown(` \`${originalCode}\` ~~即将废弃~~ \n`); // 显示转换后的 code
				markdown.appendMarkdown(`\n---\n\n`); // Horizontal rule with spacing

				markdown.appendMarkdown(`[**🚀 点击复制 icon name**](command:iconfont-for-human.copyIconNameFromHover?${nameArgs} "Copy icon name")`);
				markdown.appendMarkdown(`&nbsp;&nbsp;|&nbsp;&nbsp;`); // Separator
				markdown.appendMarkdown(` \`${matchedInfo.iconName}\`\n`); // Single newline for closer info lines
				markdown.appendMarkdown(`\n---\n\n`); // Horizontal rule with spacing

				markdown.appendMarkdown(`[**🚀 点击复制 Icon 组件**](command:iconfont-for-human.copyIconComponentFromHover?${componentArgs} "Copy icon component")`);
				markdown.appendMarkdown(`&nbsp;&nbsp;|&nbsp;&nbsp;`); // Separator
				markdown.appendMarkdown(` \`<Icon name="${matchedInfo.iconName}" />\`\n`); // Single newline for closer info lines
				markdown.appendMarkdown(`\n---\n\n`); // Horizontal rule with spacing

				// --- 修改：处理 HTML 实体转换 ---
				if (matchedInfo.originalText.startsWith('&#x')) {
					// --- 关键修改：扩大范围以包含 code="..." ---
					const lineText = document.lineAt(matchedInfo.range.start.line).text;
					const entityStartIndex = matchedInfo.range.start.character;
					const entityEndIndex = matchedInfo.range.end.character;

					// 向前查找 'code="'
					const codeAttrPrefix = 'code="';
					const codeAttrStartIndex = lineText.lastIndexOf(codeAttrPrefix, entityStartIndex);

					let fullRangeStartChar = entityStartIndex; // Default to entity start if not found
					if (codeAttrStartIndex !== -1) {
						fullRangeStartChar = codeAttrStartIndex;
					} else {
						console.warn(`iconfont-for-human: Could not find 'code="' before entity on line ${matchedInfo.range.start.line + 1}`);
						// Fallback or skip? Let's try to proceed but the replacement might be partial.
					}

					// 向后查找 '"' (实体后面的第一个引号)
					const closingQuoteIndex = lineText.indexOf('"', entityEndIndex);
					let fullRangeEndChar = entityEndIndex; // Default to entity end if not found
					if (closingQuoteIndex !== -1) {
						fullRangeEndChar = closingQuoteIndex + 1; // Include the closing quote
					} else {
						console.warn(`iconfont-for-human: Could not find closing quote after entity on line ${matchedInfo.range.start.line + 1}`);
						// Fallback or skip? Let's try to proceed but the replacement might be partial.
					}

					// 创建覆盖整个 code="..." 属性的范围
					const fullAttributeRange = new vscode.Range(
						matchedInfo.range.start.line,
						fullRangeStartChar,
						matchedInfo.range.end.line, // Assuming same line for now
						fullRangeEndChar
					);
					// ------------------------------------------

					const convertArgs = encodeURIComponent(JSON.stringify({
						iconName: matchedInfo.iconName,
						range: { // Pass the *full attribute* range information
							startLine: fullAttributeRange.start.line,
							startChar: fullAttributeRange.start.character,
							endLine: fullAttributeRange.end.line,
							endChar: fullAttributeRange.end.character
						}
					}));
					// Simpler tooltip to avoid parsing issues
					markdown.appendMarkdown(`[🚀🚀 **一键转换组件 name**](command:iconfont-for-human.convertEntityToNameFromHover?${convertArgs} "替换为 name 属性")`);
					markdown.appendMarkdown(`&nbsp;&nbsp;|&nbsp;&nbsp;`); // Separator
					markdown.appendMarkdown(`组件用法替换为 \`name="${matchedInfo.iconName}"\`\n`);
					markdown.appendMarkdown(`\n---\n\n`); // Horizontal rule with spacing

					// --- 新增：一键转换为 Icon 组件 --- 
					const componentConvertArgs = encodeURIComponent(JSON.stringify({
						iconName: matchedInfo.iconName,
						range: { // Pass the original entity range for this conversion
							startLine: matchedInfo.range.start.line,
							startChar: matchedInfo.range.start.character,
							endLine: matchedInfo.range.end.line,
							endChar: matchedInfo.range.end.character
						}
					}));
					markdown.appendMarkdown(`[🚀🚀🚀 **一键转换为 Icon 组件**](command:iconfont-for-human.convertEntityToComponentFromHover?${componentConvertArgs} "将 HTML 实体替换为 Icon 组件")`);
					markdown.appendMarkdown(`&nbsp;&nbsp;|&nbsp;&nbsp;`); // Separator
					markdown.appendMarkdown(` 替换为 \`<Icon name="${matchedInfo.iconName}" />\`\n`);
					markdown.appendMarkdown(`\n---\n\n`); // Horizontal rule with spacing
				}

				// 使用原始实体范围进行悬停提示区域显示，但命令使用扩展范围
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

	// --- 新增：处理从 HoverProvider 转换 HTML 实体为 Name 的命令 ---
	interface ConvertArgs {
		iconName: string;
		range: {
			startLine: number;
			startChar: number;
			endLine: number;
			endChar: number;
		};
	}
	const convertEntityToNameFromHoverCommand = vscode.commands.registerCommand('iconfont-for-human.convertEntityToNameFromHover', async (args: ConvertArgs) => {
		const editor = vscode.window.activeTextEditor;
		if (editor && args && args.iconName && args.range) {
			const range = new vscode.Range(
				args.range.startLine,
				args.range.startChar,
				args.range.endLine,
				args.range.endChar
			);
			const replacementText = `name="${args.iconName}"`;

			// Ensure the range corresponds to the expected text (optional but safer)
			// const currentText = editor.document.getText(range);
			// if (!currentText.startsWith('&#x')) { // Basic check
			// 	vscode.window.showWarningMessage('The selected range does not seem to be an HTML entity.');
			// 	return;
			// }

			const edit = new vscode.WorkspaceEdit();
			edit.replace(editor.document.uri, range, replacementText);

			try {
				const success = await vscode.workspace.applyEdit(edit);
				if (success) {
					vscode.window.showInformationMessage(`已替换为: ${replacementText}`);
				} else {
					vscode.window.showErrorMessage('替换失败。');
				}
			} catch (error) {
				console.error("Error applying edit for convertEntityToNameFromHover:", error);
				vscode.window.showErrorMessage('替换时发生错误。');
			}
		} else if (!editor) {
			vscode.window.showWarningMessage('请打开一个编辑器以执行替换操作。');
		} else {
			vscode.window.showWarningMessage('无效的参数，无法执行替换。');
		}
	});
	context.subscriptions.push(convertEntityToNameFromHoverCommand);

	// --- 新增：处理从 HoverProvider 转换 HTML 实体为 Icon 组件的命令 ---
	const convertEntityToComponentFromHoverCommand = vscode.commands.registerCommand('iconfont-for-human.convertEntityToComponentFromHover', async (args: ConvertArgs) => { // Reusing ConvertArgs interface
		const editor = vscode.window.activeTextEditor;
		if (editor && args && args.iconName && args.range) {
			const range = new vscode.Range(
				args.range.startLine,
				args.range.startChar,
				args.range.endLine,
				args.range.endChar
			);
			// Replacement text is the Icon component
			const replacementText = `<Icon name="${args.iconName}" />`;

			const edit = new vscode.WorkspaceEdit();
			edit.replace(editor.document.uri, range, replacementText);

			try {
				const success = await vscode.workspace.applyEdit(edit);
				if (success) {
					vscode.window.showInformationMessage(`已替换为: ${replacementText}`);
				} else {
					vscode.window.showErrorMessage('替换为 Icon 组件失败。');
				}
			} catch (error) {
				console.error("Error applying edit for convertEntityToComponentFromHover:", error);
				vscode.window.showErrorMessage('替换为 Icon 组件时发生错误。');
			}
		} else if (!editor) {
			vscode.window.showWarningMessage('请打开一个编辑器以执行替换操作。');
		} else {
			vscode.window.showWarningMessage('无效的参数，无法执行替换。');
		}
	});
	context.subscriptions.push(convertEntityToComponentFromHoverCommand);

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