import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LintManager } from './lintManager';
import { DiagnosticProvider } from './diagnosticProvider';
import { CodeActionProvider } from './codeActionProvider';
import { GradleProcessManager } from './gradleProcessManager';
import { AndroidDeviceManager } from './androidDeviceManager';
import { LogcatManager } from './logcatManager';
import { AndroidAppLauncher } from './androidLauncher';
import { AndroidExplorerView } from './androidExplorerView';
import { DefinitionProvider } from './definitionProvider';
import { ReferenceProvider } from './referenceProvider';
import { HoverProvider } from './hoverProvider';
import { GradleTaskProvider } from './gradleTaskProvider';
import { AdbWirelessManager } from './adbWirelessManager';

let lintManager: LintManager;
let diagnosticProvider: DiagnosticProvider;
let gradleProcessManager: GradleProcessManager;
let deviceManager: AndroidDeviceManager;
let logcatManager: LogcatManager;
let appLauncher: AndroidAppLauncher;
let androidExplorerView: AndroidExplorerView;
let gradleTaskProvider: GradleTaskProvider;
let adbWirelessManager: AdbWirelessManager;
let runStatusBarItem: vscode.StatusBarItem;

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

    gradleProcessManager = new GradleProcessManager(outputChannel);
    context.subscriptions.push(gradleProcessManager);

    deviceManager = new AndroidDeviceManager(outputChannel);
    context.subscriptions.push(deviceManager);

    logcatManager = new LogcatManager(deviceManager, context.extensionUri);
    context.subscriptions.push(logcatManager);

    appLauncher = new AndroidAppLauncher(gradleProcessManager, deviceManager, logcatManager, outputChannel);
    context.subscriptions.push(appLauncher);

    adbWirelessManager = new AdbWirelessManager(outputChannel, deviceManager.getAdbPath());

    // Initialize Android Explorer View
    androidExplorerView = new AndroidExplorerView(deviceManager, logcatManager, gradleProcessManager, context);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('androidExplorer', androidExplorerView)
    );

    // Initialize Gradle Task Provider
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceFolder) {
        gradleTaskProvider = new GradleTaskProvider(gradleProcessManager, workspaceFolder);
        context.subscriptions.push(
            vscode.window.registerTreeDataProvider('gradleTasks', gradleTaskProvider)
        );
    }

    // Connect app launcher to explorer view for status updates
    appLauncher.setAppIdCallback((appId) => {
        androidExplorerView.setCurrentAppId(appId);
    });

    // Refresh devices on startup
    androidExplorerView.refreshDevices().catch(err => {
        log(outputChannel, `Failed to refresh devices on startup: ${err}`);
    });

    // Initialize lint manager
    lintManager = new LintManager(diagnosticProvider, gradleProcessManager, outputChannel);
    
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

    context.subscriptions.push(
        vscode.commands.registerCommand('android-linter.launchOnDevice', async () => {
            androidExplorerView.setGradleRunning(true);
            try {
                await appLauncher.launch();
            } finally {
                androidExplorerView.setGradleRunning(false);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('android-linter.relaunchApp', async () => {
            androidExplorerView.setGradleRunning(true);
            try {
                await appLauncher.relaunchApp();
            } finally {
                androidExplorerView.setGradleRunning(false);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('android-linter.debugApp', async () => {
            await appLauncher.debugApp();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('android-linter.stopApp', async () => {
            await appLauncher.stopApp();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('android-linter.showLogcat', async () => {
            await appLauncher.startLogcatSession();
            androidExplorerView.setLogcatRunning(true);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('android-linter.stopLogcat', async () => {
            await appLauncher.stopLogcat();
            androidExplorerView.setLogcatRunning(false);
        })
    );

    // Register Android Explorer commands
    context.subscriptions.push(
        vscode.commands.registerCommand('android-linter.refreshDevices', async () => {
            await androidExplorerView.refreshDevices();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('android-linter.selectDevice', async (device) => {
            androidExplorerView.setSelectedDevice(device);
            vscode.window.showInformationMessage(`Selected device: ${device.label}`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('android-linter.clearLogcat', () => {
            logcatManager.clearWebview();
            vscode.window.showInformationMessage('Logcat cleared');
        })
    );

    // Gradle Task Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('android-linter.runGradleTask', async (taskName: string) => {
            if (!workspaceFolder) return;
            
            // If no task name passed (e.g. from palette), prompt for it
            const task = taskName || await vscode.window.showInputBox({
                placeHolder: 'assembleDebug',
                prompt: 'Enter the Gradle task to run',
            });

            if (!task) return;

            androidExplorerView.setGradleRunning(true);
            try {
                const terminal = vscode.window.createTerminal(`Gradle: ${task}`);
                terminal.show();
                
                // Use the proper wrapper based on platform
                const wrapper = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';
                terminal.sendText(`${wrapper} ${task}`);
                
            } finally {
                androidExplorerView.setGradleRunning(false);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('android-linter.syncProject', async () => {
            if (gradleTaskProvider) {
                await gradleTaskProvider.refreshTasks();
                vscode.window.showInformationMessage('Gradle Project Synced & Tasks Refreshed');
            }
        })
    );

    // ADB Wireless Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('android-linter.adbConnect', async () => {
            await adbWirelessManager.connect();
            // Refresh devices after connection attempt
            setTimeout(() => androidExplorerView.refreshDevices(), 2000);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('android-linter.adbPair', async () => {
            await adbWirelessManager.pair();
        })
    );

    // Optional status bar item (now we have the Android Explorer panel)
    const showStatusBar = vscode.workspace.getConfiguration('android-linter').get<boolean>('showStatusBar', false);
    if (showStatusBar) {
        runStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        runStatusBarItem.text = '$(debug-start) Run on Android';
        runStatusBarItem.tooltip = 'Install Debug build and launch on a connected device';
        runStatusBarItem.command = 'android-linter.launchOnDevice';
        runStatusBarItem.show();
        context.subscriptions.push(runStatusBarItem);
    }

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

    // Register definition provider for "Go to Definition" (Ctrl+Click)
    const definitionProvider = new DefinitionProvider();
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            ['kotlin', 'java'],
            definitionProvider
        )
    );

    // Register reference provider for "Find All References"
    const referenceProvider = new ReferenceProvider();
    context.subscriptions.push(
        vscode.languages.registerReferenceProvider(
            ['kotlin', 'java'],
            referenceProvider
        )
    );

    // Register hover provider to show references in tooltip (optional, disabled by default)
    const enableHover = vscode.workspace.getConfiguration('android-linter').get<boolean>('enableHoverReferences', false);
    if (enableHover) {
        const hoverProvider = new HoverProvider();
        context.subscriptions.push(
            vscode.languages.registerHoverProvider(
                ['kotlin', 'java'],
                hoverProvider
            )
        );
        outputChannel.appendLine('✅ Registered code navigation providers (Go to Definition, Find References, Hover)');
    } else {
        outputChannel.appendLine('✅ Registered code navigation providers (Go to Definition, Find References)');
        outputChannel.appendLine('💡 Tip: Enable "android-linter.enableHoverReferences" to show references on hover');
    }

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

            // Auto-sync on build.gradle changes?
            if (document.fileName.endsWith('.gradle') || document.fileName.endsWith('.gradle.kts')) {
               const selection = await vscode.window.showInformationMessage(
                   'Gradle file changed. Sync project?',
                   'Sync', 'Later'
               );
               if (selection === 'Sync') {
                   vscode.commands.executeCommand('android-linter.syncProject');
               }
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
    if (logcatManager) {
        logcatManager.dispose();
    }
    if (deviceManager) {
        deviceManager.dispose();
    }
    if (gradleProcessManager) {
        gradleProcessManager.dispose();
    }
    if (runStatusBarItem) {
        runStatusBarItem.dispose();
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
