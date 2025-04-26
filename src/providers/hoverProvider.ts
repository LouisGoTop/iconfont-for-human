import * as vscode from 'vscode';
import { IconManager } from '../managers/iconManager';
import { createSvgUri } from '../utils';

export class IconHoverProvider implements vscode.HoverProvider {
    constructor(private iconManager: IconManager) {}

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        if (document.uri.scheme === 'vscode-custom-editor') {
            return undefined;
        }

        const state = this.iconManager.getState();
        let matchedInfo;
        let matchedKey;

        for (const [key, info] of state.decoratedRangeToIconInfoMap.entries()) {
            const keyPrefix = `${document.uri.toString()}#`;
            if (key.startsWith(keyPrefix) && info.range.contains(position)) {
                matchedInfo = info;
                matchedKey = key;
                break;
            }
        }

        if (matchedInfo) {
            const markdown = new vscode.MarkdownString();
            markdown.isTrusted = true;
            markdown.supportHtml = true;

            const iconUri = createSvgUri(state, matchedInfo.iconName);
            if (iconUri.scheme === 'data') {
                markdown.appendMarkdown(`![${matchedInfo.iconName}](${iconUri.toString(true)}|width=80|height=80)\n\n`);
            }

            const nameArgs = encodeURIComponent(JSON.stringify({ iconName: matchedInfo.iconName }));
            const componentArgs = encodeURIComponent(JSON.stringify({ component: `<Icon name="${matchedInfo.iconName}" />` }));

            let originalCode = matchedInfo.originalText;
            if (!originalCode.startsWith('&#x')) {
                for (const [name, unicode] of state.iconMap.entries()) {
                    if (name === matchedInfo.iconName) {
                        originalCode = `&#x${unicode};`;
                        break;
                    }
                }
            }

            markdown.appendMarkdown(`[**🚀 点击复制 icon name**](command:iconfont-for-human.copyIconNameFromHover?${nameArgs})`);
            markdown.appendMarkdown(`&nbsp;&nbsp;|&nbsp;&nbsp;`);
            markdown.appendMarkdown(` \`${matchedInfo.iconName}\`\n`);
            markdown.appendMarkdown(` \`${originalCode}\`\n`);
            markdown.appendMarkdown(`\n---\n\n`);

            markdown.appendMarkdown(`[**🚀 点击复制 Icon 组件**](command:iconfont-for-human.copyIconComponentFromHover?${componentArgs})`);
            markdown.appendMarkdown(`&nbsp;&nbsp;|&nbsp;&nbsp;`);
            markdown.appendMarkdown(` \`<Icon name="${matchedInfo.iconName}" />\`\n`);
            markdown.appendMarkdown(`\n---\n\n`);

            if (matchedInfo.originalText.startsWith('&#x')) {
                const lineText = document.lineAt(matchedInfo.range.start.line).text;
                const entityStartIndex = matchedInfo.range.start.character;
                const entityEndIndex = matchedInfo.range.end.character;

                const codeAttrPrefix = 'code=';
                const codeAttrStartIndex = lineText.lastIndexOf(codeAttrPrefix, entityStartIndex);

                let fullRangeStartChar = entityStartIndex;
                if (codeAttrStartIndex !== -1) {
                    fullRangeStartChar = codeAttrStartIndex;
                }

                let quoteChar = '"';
                if (codeAttrStartIndex !== -1) {
                    const afterCodeAttr = lineText.substring(codeAttrStartIndex + codeAttrPrefix.length).trim();
                    if (afterCodeAttr.startsWith("'")) {
                        quoteChar = "'";
                    }
                }

                let fullRangeEndChar = entityEndIndex;
                if (codeAttrStartIndex !== -1) {
                    const afterEntity = lineText.substring(entityEndIndex);
                    const closingQuoteIndex = afterEntity.indexOf(quoteChar);
                    if (closingQuoteIndex !== -1) {
                        fullRangeEndChar = entityEndIndex + closingQuoteIndex + 1;
                    }
                }

                const fullAttributeRange = new vscode.Range(
                    matchedInfo.range.start.line,
                    fullRangeStartChar,
                    matchedInfo.range.end.line,
                    fullRangeEndChar
                );

                const convertArgs = encodeURIComponent(JSON.stringify({
                    iconName: matchedInfo.iconName,
                    range: {
                        startLine: fullAttributeRange.start.line,
                        startChar: fullAttributeRange.start.character,
                        endLine: fullAttributeRange.end.line,
                        endChar: fullAttributeRange.end.character
                    }
                }));

                markdown.appendMarkdown(`[🚀🚀 **一键转换组件 name**](command:iconfont-for-human.convertEntityToNameFromHover?${convertArgs})`);
                markdown.appendMarkdown(`&nbsp;&nbsp;|&nbsp;&nbsp;`);
                markdown.appendMarkdown(`组件用法替换为 \`name="${matchedInfo.iconName}"\`\n`);
                markdown.appendMarkdown(`\n---\n\n`);

                const componentConvertArgs = encodeURIComponent(JSON.stringify({
                    iconName: matchedInfo.iconName,
                    range: {
                        startLine: matchedInfo.range.start.line,
                        startChar: matchedInfo.range.start.character,
                        endLine: matchedInfo.range.end.line,
                        endChar: matchedInfo.range.end.character
                    }
                }));

                markdown.appendMarkdown(`[🚀🚀🚀 **一键转换为 Icon 组件**](command:iconfont-for-human.convertEntityToComponentFromHover?${componentConvertArgs})`);
                markdown.appendMarkdown(`&nbsp;&nbsp;|&nbsp;&nbsp;`);
                markdown.appendMarkdown(` 替换为 \`<Icon name="${matchedInfo.iconName}" />\`\n`);
                markdown.appendMarkdown(`\n---\n\n`);
            }

            return new vscode.Hover(markdown, matchedInfo.range);
        }

        return undefined;
    }
}