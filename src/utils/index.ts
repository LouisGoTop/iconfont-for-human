import * as vscode from 'vscode';
import { GlobalState } from '../types';
import { ICON_PREFIX_REGEX } from '../config/constants';

// 创建SVG URI
export function createSvgUri(state: GlobalState, iconIdFromMap: string): vscode.Uri {
    const idWithoutPrefix = iconIdFromMap.replace(ICON_PREFIX_REGEX, '');
    const symbolContent = state.svgPathMap.get(idWithoutPrefix) || state.svgPathMap.get(iconIdFromMap);

    if (!symbolContent) {
        console.warn(`SVG内容未找到: ${iconIdFromMap}`);
        return vscode.Uri.parse('');
    }

    const bgColor = 'rgba(255, 255, 255, 0.5)';
    const scale = 1;
    const translation = (1024 * (1 - scale)) / 2;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="13" height="13" style="position: absolute; top: 0; display: inline-block;">
        <rect x="0" y="0" width="1024" height="1024" fill="${bgColor}" stroke="#000000" stroke-width="5" />
        <g transform="translate(${translation}, ${translation}) scale(${scale})">
            ${symbolContent}
        </g>
    </svg>`;

    const encodedSvg = Buffer.from(svg).toString('base64');
    return vscode.Uri.parse(`data:image/svg+xml;base64,${encodedSvg}`);
}

// 清理装饰器类型
export function disposeDecorationTypes(state: GlobalState, editor?: vscode.TextEditor): void {
    const targetEditor = editor || vscode.window.activeTextEditor;
    
    if (targetEditor) {
        for (const decorationType of state.gutterIconDecorationTypes.values()) {
            targetEditor.setDecorations(decorationType, []);
        }
        for (const decorationType of state.inlineIconDecorationTypes.values()) {
            targetEditor.setDecorations(decorationType, []);
        }
        if (state.hoverAnnotationDecorationType) {
            targetEditor.setDecorations(state.hoverAnnotationDecorationType, []);
        }
    }

    for (const decorationType of state.gutterIconDecorationTypes.values()) {
        decorationType.dispose();
    }
    state.gutterIconDecorationTypes.clear();

    for (const decorationType of state.inlineIconDecorationTypes.values()) {
        decorationType.dispose();
    }
    state.inlineIconDecorationTypes.clear();

    if (state.hoverAnnotationDecorationType) {
        state.hoverAnnotationDecorationType.dispose();
    }

    state.contentLineToIconInfoMap.clear();
    state.decoratedRangeToIconInfoMap.clear();
}

// 查找指定行的图标信息
export function findIconInfoForLine(state: GlobalState, targetLine: number) {
    return state.contentLineToIconInfoMap.get(targetLine);
}