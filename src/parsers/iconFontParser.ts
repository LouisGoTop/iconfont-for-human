import * as vscode from 'vscode';
import * as fs from 'fs';
import { IconManager } from '../managers/iconManager';

export class IconFontParser {
    constructor(private iconManager: IconManager) {}

    // 解析iconfont.js
    async parseIconFontJs(): Promise<void> {
        const jsFiles = await vscode.workspace.findFiles('**/iconfont.js', '**/node_modules/**', 1);
        if (jsFiles.length === 0) {
            return;
        }

        try {
            const jsContent = await fs.promises.readFile(jsFiles[0].fsPath, 'utf8');
            const symbolsMatch = jsContent.match(/'<svg>(.+?)<\/svg>'/);
            if (!symbolsMatch) {
                return;
            }

            const svgContent = symbolsMatch[1];
            const symbolRegex = /<symbol.+?id="([^"]+)".+?>(.+?)<\/symbol>/g;
            let symbolMatch;

            while ((symbolMatch = symbolRegex.exec(svgContent)) !== null) {
                const [, id, content] = symbolMatch;
                if (id && content) {
                    this.iconManager.addSvgPathMapping(id, content);
                }
            }
        } catch (error) {
            console.error('解析iconfont.js出错:', error);
        }
    }

    // 解析iconfont.css
    async parseIconFontCss(): Promise<void> {
        const cssFiles = await vscode.workspace.findFiles('**/iconfont.css', '**/node_modules/**', 1);
        if (cssFiles.length === 0) {
            return;
        }

        try {
            const cssContent = await fs.promises.readFile(cssFiles[0].fsPath, 'utf8');
            const iconRegex = /\.([a-zA-Z0-9_-]+)::?before\s*{\s*content:\s*['"]?(\\[a-fA-F0-9]+)['"]?;?\s*}/g;
            let match;

            while ((match = iconRegex.exec(cssContent))) {
                const [, iconName, iconUnicode] = match;
                if (iconName && iconUnicode) {
                    this.iconManager.addIconMapping(iconName, iconUnicode.substring(1));
                }
            }
        } catch (error) {
            console.error('解析iconfont.css出错:', error);
            vscode.window.showErrorMessage('解析iconfont.css失败');
        }
    }

    // 解析所有图标文件
    async parseAll(): Promise<void> {
        this.iconManager.clearState();
        await this.parseIconFontJs();
        await this.parseIconFontCss();
    }
}