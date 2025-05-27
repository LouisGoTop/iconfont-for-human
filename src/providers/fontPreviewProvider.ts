import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as Font from 'fonteditor-core';
import * as pako from 'pako';

// 从 extension.bak.ts 移植过来的函数
async function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview): Promise<string> {
    const htmlPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'load-ttf.html');
    const cssPathOnDisk = vscode.Uri.joinPath(context.extensionUri, 'media', 'load-ttf.css');
    const jsPathOnDisk = vscode.Uri.joinPath(context.extensionUri, 'media', 'load-ttf.js');

    const cssUri = webview.asWebviewUri(cssPathOnDisk);
    const jsUri = webview.asWebviewUri(jsPathOnDisk);

    let htmlContent = await fs.promises.readFile(htmlPath.fsPath, 'utf8');

    htmlContent = htmlContent.replace('./load-ttf.css', cssUri.toString());
    htmlContent = htmlContent.replace('./load-ttf.js', jsUri.toString());

    return htmlContent;
}

async function sendFontDataToWebviewFromUri(uri: vscode.Uri, webview: vscode.Webview) {
    const filePath = uri.fsPath;
    const fileExtension = path.extname(filePath).toLowerCase();
    const suffix = fileExtension.substring(1);

    try {
        const fileBuffer = Buffer.from(await vscode.workspace.fs.readFile(uri));
        const base64Data = fileBuffer.toString('base64');

        if (suffix === 'woff2') {
            // 据 fonteditor-core 文档，woff2.init 可能需要 ArrayBuffer
            // 但 Buffer 在 Node.js 中通常可以工作，如果遇到问题，可能需要转换：
            // const arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);
            // await Font.woff2.init(arrayBuffer);
            await Font.woff2.init(fileBuffer); 
        }

        const fontInstance = Font.Font.create(fileBuffer, {
            type: suffix as any,
            // @ts-ignore - 显式提供 inflate 函数给 woff 类型
            inflate: suffix === 'woff' ? pako.inflate : undefined
        });
        const fontData = fontInstance.get();

        const glyphs = (fontData.glyf || []).filter((g: any) => g.unicode && g.unicode.length > 0);
        const glyphsData = glyphs.map((g: any) => {
            const unicodeDecimal = g.unicode![0];
            return {
                unicode: unicodeDecimal,
                name: g.name || `uni${unicodeDecimal.toString(16).toUpperCase()}`
            };
        });

        webview.postMessage({
            command: 'loadFont',
            base64Data: base64Data,
            glyphsData: glyphsData,
            extension: fileExtension
        });
        console.log(`iconfont-for-human: Sent font data (${fileExtension}) and ${glyphsData.length} glyphs to webview.`);
    } catch (error: any) {
        console.error(`iconfont-for-human: Error reading or parsing font file ${filePath}:`, error);
        let errorMessage = `无法解析字体文件: ${path.basename(filePath)}`;
        if (error instanceof Error) {
            errorMessage += `\nError: ${error.message}`;
        }
        vscode.window.showErrorMessage(errorMessage);
        webview.postMessage({
            command: 'loadError',
            message: errorMessage
        });
    }
}

export class FontPreviewProvider implements vscode.CustomReadonlyEditorProvider<vscode.CustomDocument> {

    public static readonly viewType = 'font.preview'; // 必须与 package.json 中的 viewType 一致

    constructor(
        private readonly context: vscode.ExtensionContext
    ) { }

    openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): vscode.CustomDocument | Thenable<vscode.CustomDocument> {
        return { uri, dispose: () => { /* 清理逻辑 */ } };
    }

    public async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        console.log(`iconfont-for-human: Resolving custom editor for ${document.uri.fsPath}`);

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
        };

        webviewPanel.webview.html = await getWebviewContent(this.context, webviewPanel.webview);
        await sendFontDataToWebviewFromUri(document.uri, webviewPanel.webview);

        webviewPanel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                }
            },
            null,
            this.context.subscriptions
        );
    }
} 