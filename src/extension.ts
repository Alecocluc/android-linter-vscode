import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LintManager } from './lintManager';
import { DiagnosticProvider } from './diagnosticProvider';
import { CodeActionProvider } from './codeActionProvider';

let lintManager: LintManager;
let diagnosticProvider: DiagnosticProvider;

function log(outputChannel: vscode.OutputChannel, message: string) {
    const config = vscode.workspace.getConfiguration('android-linter');
    if (config.get<boolean>('verboseLogging', true)) {
        outputChannel.appendLine(message);
    }
}

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Android Linter');
    
    // Show the output channel so it appears in the dropdown
    const extensionConfig = vscode.workspace.getConfiguration('android-linter');
    if (extensionConfig.get<boolean>('verboseLogging', true)) {
        outputChannel.show(true); // true = preserve focus on editor
    }
    
    outputChannel.appendLine('🚀 Android Linter extension is now active');

    // Initialize diagnostic collection
    diagnosticProvider = new DiagnosticProvider();
    context.subscriptions.push(diagnosticProvider);

    // Initialize lint manager
    lintManager = new LintManager(diagnosticProvider, outputChannel);
    
    // Log workspace info
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        log(outputChannel, `📁 Workspace folders: ${workspaceFolders.map(f => f.uri.fsPath).join(', ')}`);
    } else {
        log(outputChannel, '⚠️ No workspace folder found');
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
            ['kotlin', 'java', 'xml'],
            codeActionProvider,
            {
                providedCodeActionKinds: CodeActionProvider.providedCodeActionKinds
            }
        )
    );

    // Listen to file open events
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(async (document) => {
            log(outputChannel, `📄 File opened: ${document.fileName} (language: ${document.languageId})`);
            const config = vscode.workspace.getConfiguration('android-linter');
            if (config.get<boolean>('lintOnOpen') && isAndroidFile(document)) {
                log(outputChannel, `   ▶️ Running lint on ${document.fileName}`);
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
    const validLanguages = ['kotlin', 'java', 'xml'];
    if (!validLanguages.includes(document.languageId)) {
        return false;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
        return false;
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;
    const hasGradle = fs.existsSync(path.join(workspaceRoot, 'build.gradle')) || fs.existsSync(path.join(workspaceRoot, 'build.gradle.kts'));
    
    if (hasGradle) {
        return true;
    }
    
    // Check app level build.gradle
    const appLevelGradle = fs.existsSync(path.join(workspaceRoot, 'app', 'build.gradle')) || fs.existsSync(path.join(workspaceRoot, 'app', 'build.gradle.kts'));

    return appLevelGradle;
}
