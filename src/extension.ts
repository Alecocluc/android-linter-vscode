import * as vscode from 'vscode';
import { LintManager } from './lintManager';
import { DiagnosticProvider } from './diagnosticProvider';
import { CodeActionProvider } from './codeActionProvider';

let lintManager: LintManager;
let diagnosticProvider: DiagnosticProvider;

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Android Linter');
    outputChannel.appendLine('🚀 Android Linter extension is now active');
    console.log('Android Linter extension is now active');

    // Initialize diagnostic collection
    diagnosticProvider = new DiagnosticProvider();
    context.subscriptions.push(diagnosticProvider);

    // Initialize lint manager
    lintManager = new LintManager(diagnosticProvider, outputChannel);
    
    // Log workspace info
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        outputChannel.appendLine(`📁 Workspace folders: ${workspaceFolders.map(f => f.uri.fsPath).join(', ')}`);
    } else {
        outputChannel.appendLine('⚠️ No workspace folder found');
    }

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('android-linter.lintCurrentFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                await lintManager.lintFile(editor.document);
            } else {
                vscode.window.showWarningMessage('No active file to lint');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('android-linter.lintProject', async () => {
            await lintManager.lintProject();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('android-linter.clearDiagnostics', () => {
            diagnosticProvider.clear();
            vscode.window.showInformationMessage('Lint results cleared');
        })
    );

    // Register code action provider for quick fixes
    const codeActionProvider = new CodeActionProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            ['kotlin', 'java'],
            codeActionProvider,
            {
                providedCodeActionKinds: CodeActionProvider.providedCodeActionKinds
            }
        )
    );

    // Listen to file open events
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(async (document) => {
            outputChannel.appendLine(`📄 File opened: ${document.fileName} (language: ${document.languageId})`);
            const config = vscode.workspace.getConfiguration('android-linter');
            const isAndroid = isAndroidFile(document);
            outputChannel.appendLine(`   Is Android file: ${isAndroid}`);
            if (config.get<boolean>('lintOnOpen') && isAndroid) {
                outputChannel.appendLine(`   ▶️ Running lint on ${document.fileName}`);
                await lintManager.lintFile(document);
            }
        })
    );

    // Listen to file save events
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            const config = vscode.workspace.getConfiguration('android-linter');
            if (config.get<boolean>('lintOnSave') && isAndroidFile(document)) {
                await lintManager.lintFile(document);
            }
        })
    );

    // Listen to file change events (with debouncing)
    let changeTimeout: NodeJS.Timeout | undefined;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            const config = vscode.workspace.getConfiguration('android-linter');
            if (config.get<boolean>('lintOnChange') && isAndroidFile(event.document)) {
                if (changeTimeout) {
                    clearTimeout(changeTimeout);
                }
                const delay = config.get<number>('debounceDelay') || 2000;
                changeTimeout = setTimeout(async () => {
                    await lintManager.lintFile(event.document);
                }, delay);
            }
        })
    );

    // Lint currently open files on activation
    const config = vscode.workspace.getConfiguration('android-linter');
    if (config.get<boolean>('lintOnOpen')) {
        vscode.workspace.textDocuments.forEach(async (document) => {
            if (isAndroidFile(document)) {
                await lintManager.lintFile(document);
            }
        });
    }

    vscode.window.showInformationMessage('Android Linter is ready!');
}

export function deactivate() {
    if (lintManager) {
        lintManager.dispose();
    }
}

function isAndroidFile(document: vscode.TextDocument): boolean {
    // Check if file is Kotlin or Java
    if (document.languageId !== 'kotlin' && document.languageId !== 'java') {
        console.log(`❌ Not Android file: wrong language (${document.languageId})`);
        return false;
    }

    // Check if we're in an Android project (has build.gradle or build.gradle.kts)
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
        console.log(`❌ Not Android file: no workspace folder`);
        return false;
    }

    // For now, accept any Kotlin/Java file in workspace with build.gradle
    // This is more permissive and will let the lint tool decide what's valid
    console.log(`✅ Is Android file: ${document.languageId} file in workspace`);
    return true;
}
