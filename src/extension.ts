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
import { AdbWirelessManager } from './adbWirelessManager';
import { Logger } from './logger';
import { CONFIG_NAMESPACE, CONFIG_KEYS, COMMANDS, VIEWS, SUPPORTED_LANGUAGES, DEFAULTS } from './constants';

let lintManager: LintManager;
let diagnosticProvider: DiagnosticProvider;
let gradleProcessManager: GradleProcessManager;
let deviceManager: AndroidDeviceManager;
let logcatManager: LogcatManager;
let appLauncher: AndroidAppLauncher;
let androidExplorerView: AndroidExplorerView;
let adbWirelessManager: AdbWirelessManager;
let runStatusBarItem: vscode.StatusBarItem;
let logger: Logger;

export function activate(context: vscode.ExtensionContext) {
    // Initialize centralized logger
    logger = Logger.getInstance();
    const outputChannel = logger.getOutputChannel();
    
    // Show the output channel so it appears in the dropdown
    const extensionConfig = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    if (extensionConfig.get<boolean>(CONFIG_KEYS.VERBOSE_LOGGING, true)) {
        logger.show(true); // true = preserve focus on editor
    }
    
    logger.start('Android Linter extension is now active');

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
        vscode.window.registerTreeDataProvider(VIEWS.ANDROID_EXPLORER, androidExplorerView)
    );

    // Connect app launcher to explorer view for status updates
    appLauncher.setAppIdCallback((appId) => {
        androidExplorerView.setCurrentAppId(appId);
    });

    // Refresh devices on startup
    androidExplorerView.refreshDevices().catch(err => {
        logger.warn(`Failed to refresh devices on startup: ${err}`);
    });

    // Initialize lint manager
    lintManager = new LintManager(diagnosticProvider, gradleProcessManager, outputChannel);
    
    // Log workspace info
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        logger.folder(`Workspace folders: ${workspaceFolders.map(f => f.uri.fsPath).join(', ')}`);
    } else {
        logger.warn('No workspace folder found');
    }

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.LINT_CURRENT_FILE, async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                await lintManager.lintFile(editor.document);
            } else {
                vscode.window.showWarningMessage('No active file to lint');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.LINT_PROJECT, async () => {
            await lintManager.lintProject();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.CLEAR_DIAGNOSTICS, () => {
            diagnosticProvider.clear();
            vscode.window.showInformationMessage('Lint results cleared');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.LAUNCH_ON_DEVICE, async () => {
            androidExplorerView.setGradleRunning(true);
            try {
                await appLauncher.launch();
            } finally {
                androidExplorerView.setGradleRunning(false);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.RELAUNCH_APP, async () => {
            androidExplorerView.setGradleRunning(true);
            try {
                await appLauncher.relaunchApp();
            } finally {
                androidExplorerView.setGradleRunning(false);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.DEBUG_APP, async () => {
            await appLauncher.debugApp();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.STOP_APP, async () => {
            await appLauncher.stopApp();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.SHOW_LOGCAT, async () => {
            await appLauncher.startLogcatSession();
            androidExplorerView.setLogcatRunning(true);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.STOP_LOGCAT, async () => {
            await appLauncher.stopLogcat();
            androidExplorerView.setLogcatRunning(false);
        })
    );

    // Register Android Explorer commands
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.REFRESH_DEVICES, async () => {
            await androidExplorerView.refreshDevices();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.SELECT_DEVICE, async (device) => {
            androidExplorerView.setSelectedDevice(device);
            vscode.window.showInformationMessage(`Selected device: ${device.label}`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.CLEAR_LOGCAT, () => {
            logcatManager.clearWebview();
            vscode.window.showInformationMessage('Logcat cleared');
        })
    );

    // ADB Wireless Commands
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.ADB_CONNECT, async () => {
            await adbWirelessManager.connect();
            // Refresh devices after connection attempt
            setTimeout(() => androidExplorerView.refreshDevices(), 2000);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.ADB_PAIR, async () => {
            await adbWirelessManager.pair();
        })
    );

    // Extract String Resource command (for code actions)
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.EXTRACT_STRING, async (uri: vscode.Uri, range: vscode.Range) => {
            const document = await vscode.workspace.openTextDocument(uri);
            const text = document.getText(range);
            
            // Prompt for resource name
            const resourceName = await vscode.window.showInputBox({
                prompt: 'Enter the string resource name',
                placeHolder: 'my_string_name',
                validateInput: (value) => {
                    if (!value) return 'Resource name is required';
                    if (!/^[a-z][a-z0-9_]*$/.test(value)) {
                        return 'Resource name must start with lowercase letter and contain only lowercase letters, numbers, and underscores';
                    }
                    return null;
                }
            });

            if (!resourceName) return;

            // Find strings.xml
            const workspaceRoot = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }

            const stringsXmlPaths = [
                path.join(workspaceRoot, 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
                path.join(workspaceRoot, 'src', 'main', 'res', 'values', 'strings.xml'),
            ];

            let stringsXmlPath: string | undefined;
            for (const p of stringsXmlPaths) {
                if (fs.existsSync(p)) {
                    stringsXmlPath = p;
                    break;
                }
            }

            if (!stringsXmlPath) {
                vscode.window.showErrorMessage('Could not find strings.xml file');
                return;
            }

            // Read and update strings.xml
            try {
                let stringsContent = fs.readFileSync(stringsXmlPath, 'utf8');
                
                // Clean the text value
                const cleanText = text.replace(/^["']|["']$/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                
                // Add the new string before </resources>
                const newString = `    <string name="${resourceName}">${cleanText}</string>\n`;
                stringsContent = stringsContent.replace('</resources>', `${newString}</resources>`);
                
                fs.writeFileSync(stringsXmlPath, stringsContent, 'utf8');
                
                // Replace the original text with the resource reference
                const edit = new vscode.WorkspaceEdit();
                const isXml = document.languageId === 'xml';
                const replacement = isXml ? `@string/${resourceName}` : `R.string.${resourceName}`;
                edit.replace(uri, range, replacement);
                await vscode.workspace.applyEdit(edit);
                
                vscode.window.showInformationMessage(`String extracted to @string/${resourceName}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to extract string: ${error}`);
            }
        })
    );

    // Optional status bar item (now we have the Android Explorer panel)
    const showStatusBar = vscode.workspace.getConfiguration(CONFIG_NAMESPACE).get<boolean>(CONFIG_KEYS.SHOW_STATUS_BAR, false);
    if (showStatusBar) {
        runStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        runStatusBarItem.text = '$(debug-start) Run on Android';
        runStatusBarItem.tooltip = 'Install Debug build and launch on a connected device';
        runStatusBarItem.command = COMMANDS.LAUNCH_ON_DEVICE;
        runStatusBarItem.show();
        context.subscriptions.push(runStatusBarItem);
    }

    // Register code action provider for quick fixes
    const codeActionProvider = new CodeActionProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            [...SUPPORTED_LANGUAGES],
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
    const enableHover = vscode.workspace.getConfiguration(CONFIG_NAMESPACE).get<boolean>(CONFIG_KEYS.ENABLE_HOVER_REFERENCES, false);
    if (enableHover) {
        const hoverProvider = new HoverProvider();
        context.subscriptions.push(
            vscode.languages.registerHoverProvider(
                ['kotlin', 'java'],
                hoverProvider
            )
        );
        logger.success('Registered code navigation providers (Go to Definition, Find References, Hover)');
    } else {
        logger.success('Registered code navigation providers (Go to Definition, Find References)');
        logger.log('💡 Tip: Enable "android-linter.enableHoverReferences" to show references on hover');
    }

    // Listen to file open events
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(async (document) => {
            logger.file(`File opened: ${document.fileName} (language: ${document.languageId})`);
            const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
            if (config.get<boolean>(CONFIG_KEYS.LINT_ON_OPEN) && isAndroidFile(document)) {
                logger.log(`   ▶️ Running lint on ${document.fileName}`);
                await lintManager.lintFile(document);
            }
        })
    );

    // Listen to file save events
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
            if (config.get<boolean>(CONFIG_KEYS.LINT_ON_SAVE) && isAndroidFile(document)) {
                await lintManager.lintFile(document);
            }
        })
    );

    // Listen to file change events (with debouncing)
    let changeTimeout: NodeJS.Timeout | undefined;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
            if (config.get<boolean>(CONFIG_KEYS.LINT_ON_CHANGE) && isAndroidFile(event.document)) {
                if (changeTimeout) {
                    clearTimeout(changeTimeout);
                }
                const delay = config.get<number>(CONFIG_KEYS.DEBOUNCE_DELAY) || DEFAULTS.DEBOUNCE_DELAY;
                changeTimeout = setTimeout(async () => {
                    await lintManager.lintFile(event.document);
                }, delay);
            }
        })
    );

    // Lint currently open files on activation
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    if (config.get<boolean>(CONFIG_KEYS.LINT_ON_OPEN)) {
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
