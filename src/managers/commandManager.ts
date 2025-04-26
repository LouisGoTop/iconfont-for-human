import * as vscode from 'vscode';
import { IconManager } from './iconManager';
import { ConvertArgs } from '../types';

export class CommandManager {
    constructor(private iconManager: IconManager) {}

    // 注册所有命令
    registerCommands(context: vscode.ExtensionContext): void {
        this.registerCopyCommands(context);
        this.registerConversionCommands(context);
        this.registerHoverCommands(context);
    }

    private registerCopyCommands(context: vscode.ExtensionContext): void {
        // 复制图标名称
        context.subscriptions.push(
            vscode.commands.registerCommand('iconfont-for-human.copyIconName', () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {return;}

                const position = editor.selection.active;
                const lineNumber = position.line;
                const iconInfo = this.iconManager.getState().contentLineToIconInfoMap.get(lineNumber);

                if (iconInfo) {
                    vscode.env.clipboard.writeText(iconInfo.iconName);
                    vscode.window.showInformationMessage(`已复制图标名称: ${iconInfo.iconName}`);
                }
            })
        );

        // 复制图标Unicode
        context.subscriptions.push(
            vscode.commands.registerCommand('iconfont-for-human.copyIconCode', () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {return;}

                const position = editor.selection.active;
                const lineNumber = position.line;
                const iconInfo = this.iconManager.getState().contentLineToIconInfoMap.get(lineNumber);

                if (iconInfo && iconInfo.iconUnicode) {
                    const htmlEntityString = `&#x${iconInfo.iconUnicode};`;
                    vscode.env.clipboard.writeText(htmlEntityString);
                    vscode.window.showInformationMessage(`已复制HTML实体: ${htmlEntityString}`);
                }
            })
        );
    }

    private registerConversionCommands(context: vscode.ExtensionContext): void {
        // HTML实体转换为name属性
        context.subscriptions.push(
            vscode.commands.registerCommand('iconfont-for-human.convertEntityToNameFromHover', async (args: ConvertArgs) => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || !args.iconName || !args.range) {return;}

                const range = new vscode.Range(
                    args.range.startLine,
                    args.range.startChar,
                    args.range.endLine,
                    args.range.endChar
                );

                const replacementText = `name="${args.iconName}"`;
                await this.applyEdit(editor, range, replacementText);
            })
        );

        // HTML实体转换为Icon组件
        context.subscriptions.push(
            vscode.commands.registerCommand('iconfont-for-human.convertEntityToComponentFromHover', async (args: ConvertArgs) => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || !args.iconName || !args.range) {return;}

                const range = new vscode.Range(
                    args.range.startLine,
                    args.range.startChar,
                    args.range.endLine,
                    args.range.endChar
                );

                const replacementText = `<Icon name="${args.iconName}" />`;
                await this.applyEdit(editor, range, replacementText);
            })
        );
    }

    private registerHoverCommands(context: vscode.ExtensionContext): void {
        // 从悬停复制图标名称
        context.subscriptions.push(
            vscode.commands.registerCommand('iconfont-for-human.copyIconNameFromHover', (args: { iconName: string }) => {
                if (args?.iconName) {
                    vscode.env.clipboard.writeText(args.iconName);
                    vscode.window.showInformationMessage(`已复制名称: ${args.iconName}`);
                }
            })
        );

        // 从悬停复制Icon组件
        context.subscriptions.push(
            vscode.commands.registerCommand('iconfont-for-human.copyIconComponentFromHover', (args: { component: string }) => {
                if (args?.component) {
                    vscode.env.clipboard.writeText(args.component);
                    vscode.window.showInformationMessage(`已复制图标组件: ${args.component}`);
                }
            })
        );
    }

    private async applyEdit(editor: vscode.TextEditor, range: vscode.Range, text: string): Promise<void> {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(editor.document.uri, range, text);

        try {
            const success = await vscode.workspace.applyEdit(edit);
            if (success) {
                vscode.window.showInformationMessage(`已替换为: ${text}`);
            } else {
                vscode.window.showErrorMessage('替换失败');
            }
        } catch (error) {
            console.error('替换时发生错误:', error);
            vscode.window.showErrorMessage('替换时发生错误');
        }
    }
}