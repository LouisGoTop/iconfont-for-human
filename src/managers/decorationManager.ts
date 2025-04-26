import * as vscode from 'vscode';
import { IconManager } from './iconManager';
import { createSvgUri } from '../utils';
import { supportedCssLangs, supportedCodeLangs, ICON_PREFIXES } from '../config/constants';

export class DecorationManager {
    // 普通图标名称的边框装饰器（淡蓝色）
    private nameHoverableDecoration: vscode.TextEditorDecorationType;
    // HTML实体的边框装饰器（淡红色）
    private entityHoverableDecoration: vscode.TextEditorDecorationType;

    constructor(private iconManager: IconManager) {
        // 初始化装饰器
        this.nameHoverableDecoration = vscode.window.createTextEditorDecorationType({
            border: '1px solid rgba(66, 153, 225, 0.6)', // 淡蓝色边框
            borderRadius: '4px',
            borderStyle: 'solid'
        });

        this.entityHoverableDecoration = vscode.window.createTextEditorDecorationType({
            border: '1px solid rgba(225, 66, 66, 0.6)', // 淡红色边框
            borderRadius: '4px',
            borderStyle: 'solid'
        });
    }

    // 更新装饰器
    updateDecorations(editor: vscode.TextEditor): void {
        const state = this.iconManager.getState();
        if (!editor || state.iconMap.size === 0 || state.svgPathMap.size === 0) {
            return;
        }

        const doc = editor.document;
        const gutterDecorationsToApply = new Map<string, vscode.DecorationOptions[]>();
        const inlineDecorationsToApply = new Map<string, vscode.DecorationOptions[]>();
        const hoverAnnotations: vscode.DecorationOptions[] = [];
        // 分别存储不同类型的可悬停装饰
        const nameHoverableDecorations: vscode.DecorationOptions[] = [];
        const entityHoverableDecorations: vscode.DecorationOptions[] = [];
        const decoratedGutterLines = new Set<number>();
        const decoratedInlineRanges = new Set<string>();

        state.contentLineToIconInfoMap.clear();
        state.decoratedRangeToIconInfoMap.clear();

        if (supportedCssLangs.includes(doc.languageId)) {
            this.processCssFile(doc, gutterDecorationsToApply, hoverAnnotations, decoratedGutterLines, nameHoverableDecorations);
        } else if (supportedCodeLangs.includes(doc.languageId)) {
            this.processCodeFile(doc, inlineDecorationsToApply, decoratedInlineRanges, nameHoverableDecorations, entityHoverableDecorations);
        }

        this.applyDecorations(editor, gutterDecorationsToApply, inlineDecorationsToApply, hoverAnnotations, nameHoverableDecorations, entityHoverableDecorations);
    }

    private processCssFile(
        doc: vscode.TextDocument,
        gutterDecorationsToApply: Map<string, vscode.DecorationOptions[]>,
        hoverAnnotations: vscode.DecorationOptions[],
        decoratedGutterLines: Set<number>,
        nameHoverableDecorations: vscode.DecorationOptions[]
    ): void {
        const state = this.iconManager.getState();
        const lineCount = doc.lineCount;

        for (let i = 0; i < lineCount; i++) {
            const lineText = doc.lineAt(i).text;
            for (const iconName of state.iconMap.keys()) {
                if (lineText.includes(iconName)) {
                    let contentLineFound = -1;
                    const maxLookAhead = 5;
                    
                    for (let j = i + 1; j < Math.min(i + 1 + maxLookAhead, lineCount); j++) {
                        if (doc.lineAt(j).text.includes('content:')) {
                            contentLineFound = j;
                            break;
                        }
                    }

                    if (contentLineFound !== -1 && !decoratedGutterLines.has(contentLineFound)) {
                        this.addCssDecoration(
                            iconName,
                            i,
                            contentLineFound,
                            doc,
                            gutterDecorationsToApply,
                            hoverAnnotations,
                            decoratedGutterLines,
                            nameHoverableDecorations
                        );
                    }
                }
            }
        }
    }

    private processCodeFile(
        doc: vscode.TextDocument,
        inlineDecorationsToApply: Map<string, vscode.DecorationOptions[]>,
        decoratedInlineRanges: Set<string>,
        nameHoverableDecorations: vscode.DecorationOptions[],
        entityHoverableDecorations: vscode.DecorationOptions[]
    ): void {
        const state = this.iconManager.getState();
        const lineCount = doc.lineCount;
        const htmlEntityRegex = /&#x([a-fA-F0-9]+);/g;
        const prefixPattern = ICON_PREFIXES.map(prefix => prefix.replace('.', '\\.')).join('|');
        const iconNamePropRegex = new RegExp(`name=(?:["']|\\{["'])((?:${prefixPattern})[a-zA-Z0-9_-]+)(?:["']|\\}["'])`, 'g');

        for (let i = 0; i < lineCount; i++) {
            const lineText = doc.lineAt(i).text;
            this.processIconNameProps(doc, i, lineText, iconNamePropRegex, inlineDecorationsToApply, decoratedInlineRanges, nameHoverableDecorations);
            this.processHtmlEntities(doc, i, lineText, htmlEntityRegex, inlineDecorationsToApply, decoratedInlineRanges, entityHoverableDecorations);
        }
    }

    private addCssDecoration(
        iconName: string,
        ruleLine: number,
        contentLine: number,
        doc: vscode.TextDocument,
        gutterDecorationsToApply: Map<string, vscode.DecorationOptions[]>,
        hoverAnnotations: vscode.DecorationOptions[],
        decoratedGutterLines: Set<number>,
        nameHoverableDecorations: vscode.DecorationOptions[]
    ): void {
        const state = this.iconManager.getState();
        decoratedGutterLines.add(contentLine);

        const iconUnicode = state.iconMap.get(iconName);
        state.contentLineToIconInfoMap.set(contentLine, {
            iconName,
            iconUnicode,
            ruleLine,
            contentLine
        });

        if (!state.gutterIconDecorationTypes.has(iconName)) {
            const iconUri = createSvgUri(state, iconName);
            if (iconUri.scheme === 'data') {
                const newType = vscode.window.createTextEditorDecorationType({
                    gutterIconPath: iconUri,
                    gutterIconSize: 'contain',
                });
                state.gutterIconDecorationTypes.set(iconName, newType);
            }
        }

        let gutterOptionsArray = gutterDecorationsToApply.get(iconName);
        if (!gutterOptionsArray) {
            gutterOptionsArray = [];
            gutterDecorationsToApply.set(iconName, gutterOptionsArray);
        }

        const gutterRange = new vscode.Range(contentLine, 0, contentLine, 1);
        gutterOptionsArray.push({ range: gutterRange });

        this.addHoverAnnotation(doc, iconName, iconUnicode, ruleLine, contentLine, hoverAnnotations, nameHoverableDecorations);
    }

    private addHoverAnnotation(
        doc: vscode.TextDocument,
        iconName: string,
        iconUnicode: string | undefined,
        ruleLine: number,
        contentLine: number,
        hoverAnnotations: vscode.DecorationOptions[],
        hoverableDecorations: vscode.DecorationOptions[]
    ): void {
        const contentLineText = doc.lineAt(contentLine).text;
        const contentRegex = /content:\s*(['"])(\\?[a-fA-F0-9]+)\1/;
        const match = contentLineText.match(contentRegex);

        if (match && match.index !== undefined) {
            const quoteStartIndex = contentLineText.indexOf(match[1], match.index);
            if (quoteStartIndex !== -1) {
                const stringContent = match[2];
                const startColumn = quoteStartIndex;
                const endColumn = startColumn + match[1].length + stringContent.length + match[1].length;
                const hoverRange = new vscode.Range(contentLine, startColumn, contentLine, endColumn);

                // 添加可悬停装饰
                hoverableDecorations.push({ range: hoverRange });

                const markdownString = new vscode.MarkdownString();
                markdownString.isTrusted = true;
                markdownString.appendMarkdown(`**Icon:** \`${iconName}\`\n`);
                if (iconUnicode) {
                    markdownString.appendMarkdown(`**CSS Code:** \`\\${iconUnicode}\`\n`);
                }
                markdownString.appendMarkdown(`*CSS规则定义在第 ${ruleLine + 1} 行*`);

                hoverAnnotations.push({
                    range: hoverRange,
                    hoverMessage: markdownString
                });
            }
        }
    }

    private processIconNameProps(
        doc: vscode.TextDocument,
        lineIndex: number,
        lineText: string,
        regex: RegExp,
        inlineDecorationsToApply: Map<string, vscode.DecorationOptions[]>,
        decoratedInlineRanges: Set<string>,
        hoverableDecorations: vscode.DecorationOptions[]
    ): void {
        let match;
        while ((match = regex.exec(lineText)) !== null) {
            const iconName = match[1];
            const matchStartIndex = match.index;
            if (matchStartIndex === undefined) {continue;}

            const iconNameStartIndex = lineText.indexOf(iconName, matchStartIndex);
            if (iconNameStartIndex === -1) {continue;}

            const iconNameEndIndex = iconNameStartIndex + iconName.length;
            const range = new vscode.Range(lineIndex, iconNameStartIndex, lineIndex, iconNameEndIndex);
            this.addInlineDecoration(iconName, range, iconName, doc, inlineDecorationsToApply, decoratedInlineRanges, hoverableDecorations);
        }
    }

    private processHtmlEntities(
        doc: vscode.TextDocument,
        lineIndex: number,
        lineText: string,
        regex: RegExp,
        inlineDecorationsToApply: Map<string, vscode.DecorationOptions[]>,
        decoratedInlineRanges: Set<string>,
        hoverableDecorations: vscode.DecorationOptions[]
    ): void {
        const state = this.iconManager.getState();
        let match;
        while ((match = regex.exec(lineText)) !== null) {
            const unicodeHex = match[1].toLowerCase();
            const iconName = state.unicodeToIconNameMap.get(unicodeHex);
            const fullEntity = match[0];
            const startIndex = match.index;
            if (startIndex === undefined || !iconName) {continue;}

            const endIndex = startIndex + fullEntity.length;
            const range = new vscode.Range(lineIndex, startIndex, lineIndex, endIndex);
            this.addInlineDecoration(iconName, range, fullEntity, doc, inlineDecorationsToApply, decoratedInlineRanges, hoverableDecorations, true);
        }
    }

    private addInlineDecoration(
        iconName: string,
        range: vscode.Range,
        hoverText: string,
        doc: vscode.TextDocument,
        inlineDecorationsToApply: Map<string, vscode.DecorationOptions[]>,
        decoratedInlineRanges: Set<string>,
        hoverableDecorations: vscode.DecorationOptions[],
        isEntity: boolean = false
    ): void {
        const state = this.iconManager.getState();
        const rangeString = `${range.start.line}:${range.start.character}-${range.end.character}`;
        if (decoratedInlineRanges.has(rangeString)) {return;}

        const idWithoutPrefix = this.iconManager.getIdWithoutPrefix(iconName);
        if (!state.svgPathMap.has(idWithoutPrefix) && !state.svgPathMap.has(iconName)) {
            return;
        }

        if (!state.inlineIconDecorationTypes.has(iconName)) {
            const iconUri = createSvgUri(state, iconName);
            if (iconUri.scheme === 'data') {
                const newInlineType = vscode.window.createTextEditorDecorationType({
                    gutterIconPath: iconUri,
                    gutterIconSize: 'contain'
                });
                state.inlineIconDecorationTypes.set(iconName, newInlineType);
            }
        }

        let inlineOptionsArray = inlineDecorationsToApply.get(iconName);
        if (!inlineOptionsArray) {
            inlineOptionsArray = [];
            inlineDecorationsToApply.set(iconName, inlineOptionsArray);
        }

        inlineOptionsArray.push({ range });
        decoratedInlineRanges.add(rangeString);

        // 添加可悬停装饰
        hoverableDecorations.push({ range });

        const hoverInfo = {
            iconName,
            originalText: hoverText,
            range
        };
        const mapKey = `${doc.uri.toString()}#${rangeString}`;
        state.decoratedRangeToIconInfoMap.set(mapKey, hoverInfo);
    }

    private applyDecorations(
        editor: vscode.TextEditor,
        gutterDecorationsToApply: Map<string, vscode.DecorationOptions[]>,
        inlineDecorationsToApply: Map<string, vscode.DecorationOptions[]>,
        hoverAnnotations: vscode.DecorationOptions[],
        nameHoverableDecorations: vscode.DecorationOptions[],
        entityHoverableDecorations: vscode.DecorationOptions[]
    ): void {
        const state = this.iconManager.getState();

        // 应用装饰器
        for (const [iconName, decorationOptionsArray] of gutterDecorationsToApply.entries()) {
            const decorationType = state.gutterIconDecorationTypes.get(iconName);
            if (decorationType) {
                editor.setDecorations(decorationType, decorationOptionsArray);
            }
        }

        for (const [iconName, decorationOptionsArray] of inlineDecorationsToApply.entries()) {
            const decorationType = state.inlineIconDecorationTypes.get(iconName);
            if (decorationType) {
                editor.setDecorations(decorationType, decorationOptionsArray);
            }
        }

        if (state.hoverAnnotationDecorationType && hoverAnnotations.length > 0) {
            editor.setDecorations(state.hoverAnnotationDecorationType, hoverAnnotations);
        }

        // 应用不同类型的可悬停装饰
        editor.setDecorations(this.nameHoverableDecoration, nameHoverableDecorations);
        editor.setDecorations(this.entityHoverableDecoration, entityHoverableDecorations);
    }

    // 清理资源
    dispose() {
        this.nameHoverableDecoration.dispose();
        this.entityHoverableDecoration.dispose();
    }
}