import * as vscode from 'vscode';
import { IconManager } from './managers/iconManager';
import { DecorationManager } from './managers/decorationManager';
import { CommandManager } from './managers/commandManager';
import { IconFontParser } from './parsers/iconFontParser';
import { IconHoverProvider } from './providers/hoverProvider';
import { FontPreviewProvider } from './providers/fontPreviewProvider';
import { disposeDecorationTypes } from './utils/index';
import { supportedCodeLangs } from './config/constants';

export async function activate(context: vscode.ExtensionContext) {
    console.log('iconfont-for-human 插件已激活');

    // 初始化管理器
    const iconManager = new IconManager();
    const decorationManager = new DecorationManager(iconManager);
    const commandManager = new CommandManager(iconManager);
    const iconFontParser = new IconFontParser(iconManager);

    // 注册命令
    commandManager.registerCommands(context);

    // 注册悬停提供器
    const hoverProvider = new IconHoverProvider(iconManager);
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(supportedCodeLangs, hoverProvider),
        hoverProvider,
        decorationManager
    );

    // --- 注册 Custom Editor Provider ---
    const fontPreviewProvider = new FontPreviewProvider(context);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(FontPreviewProvider.viewType, fontPreviewProvider)
    );
    console.log(`iconfont-for-human: Registered ${FontPreviewProvider.viewType}`);

    // 初始化装饰器类型
    const hoverDecoration = vscode.window.createTextEditorDecorationType({});
    iconManager.getState().hoverAnnotationDecorationType = hoverDecoration;
    context.subscriptions.push(hoverDecoration);

    // 初始解析图标文件
    await iconFontParser.parseAll();

    let activeEditor = vscode.window.activeTextEditor;
    let updateTimeout: NodeJS.Timeout | undefined;

    // 触发装饰器更新
    function triggerUpdateDecorations(throttle = false) {
        if (updateTimeout) {
            clearTimeout(updateTimeout);
            updateTimeout = undefined;
        }
        if (throttle) {
            updateTimeout = setTimeout(() => decorationManager.updateDecorations(activeEditor!), 500);
        } else {
            decorationManager.updateDecorations(activeEditor!);
        }
    }

    // 初始更新装饰器
    if (activeEditor && activeEditor.document.uri.scheme !== 'vscode-custom-editor') {
        triggerUpdateDecorations();
    }

    // 监听编辑器变化
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(async editor => {
            if (activeEditor && activeEditor.document.uri.scheme !== 'vscode-custom-editor') {
                disposeDecorationTypes(iconManager.getState(), activeEditor);
            }
            activeEditor = editor;
            if (editor && editor.document.uri.scheme !== 'vscode-custom-editor') {
                triggerUpdateDecorations();
            } else if (editor) {
                // 如果是自定义编辑器，确保装饰被清除
                disposeDecorationTypes(iconManager.getState(), editor);
            }
        })
    );

    // 监听文档变化
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (activeEditor && event.document === activeEditor.document 
                && activeEditor.document.uri.scheme !== 'vscode-custom-editor') {
                triggerUpdateDecorations(true);
            }
        })
    );

    // 监听主题变化
    context.subscriptions.push(
        vscode.window.onDidChangeActiveColorTheme(async () => {
            disposeDecorationTypes(iconManager.getState(), activeEditor);
            if (activeEditor && activeEditor.document.uri.scheme !== 'vscode-custom-editor') {
                triggerUpdateDecorations();
            }
        })
    );

    // 监听图标文件变化
    const watcherCss = vscode.workspace.createFileSystemWatcher('**/iconfont.css');
    const watcherJs = vscode.workspace.createFileSystemWatcher('**/iconfont.js');

    const reparseAndUpdate = async () => {
        await iconFontParser.parseAll();
        if (activeEditor && activeEditor.document.uri.scheme !== 'vscode-custom-editor') {
            triggerUpdateDecorations();
        }
    };

    // 使用类型安全的方式注册文件系统观察器事件
    const registerWatcherEvents = (watcher: vscode.FileSystemWatcher) => {
        context.subscriptions.push(
            watcher.onDidChange(reparseAndUpdate),
            watcher.onDidCreate(reparseAndUpdate),
            watcher.onDidDelete(reparseAndUpdate),
            watcher
        );
    };

    registerWatcherEvents(watcherCss);
    registerWatcherEvents(watcherJs);
}

export function deactivate() {
    console.log('iconfont-for-human 插件已停用');
}