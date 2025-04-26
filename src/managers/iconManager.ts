import * as vscode from 'vscode';
import { GlobalState } from '../types';
import { disposeDecorationTypes } from '../utils';

export class IconManager {
    private state: GlobalState;

    constructor() {
        this.state = {
            iconMap: new Map(),
            svgPathMap: new Map(),
            unicodeToIconNameMap: new Map(),
            gutterIconDecorationTypes: new Map(),
            inlineIconDecorationTypes: new Map(),
            contentLineToIconInfoMap: new Map(),
            decoratedRangeToIconInfoMap: new Map()
        };
    }

    // 获取全局状态
    getState(): GlobalState {
        return this.state;
    }

    // 清理所有状态
    clearState(): void {
        disposeDecorationTypes(this.state);
        this.state.iconMap.clear();
        this.state.svgPathMap.clear();
        this.state.unicodeToIconNameMap.clear();
    }

    // 添加图标映射
    addIconMapping(iconName: string, unicode: string): void {
        const idWithoutPrefix = iconName.replace(/^icon-/, '');
        if (this.state.svgPathMap.has(idWithoutPrefix) || this.state.svgPathMap.has(iconName)) {
            this.state.iconMap.set(iconName, unicode);
            this.state.unicodeToIconNameMap.set(unicode, iconName);
        }
    }

    // 添加SVG路径映射
    addSvgPathMapping(id: string, content: string): void {
        this.state.svgPathMap.set(id, content.trim());
    }

    // 获取图标名称
    getIconNameByUnicode(unicode: string): string | undefined {
        return this.state.unicodeToIconNameMap.get(unicode);
    }
}