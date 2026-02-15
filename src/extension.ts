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
import { LanguageClientManager } from './client/languageClient';
import { EmulatorManager } from './android/emulatorManager';
import { VariantManager } from './build/variantManager';
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
let languageClientManager: LanguageClientManager | undefined;
let emulatorManager: EmulatorManager | undefined;
let variantManager: VariantManager | undefined;
let runStatusBarItem: vscode.StatusBarItem;
let logger: Logger;
let gradleLintFallbackInitialized = false;

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

    // NOTE: Gradle lint fallback is NOT initialized here.
    // When ALS is enabled (default), the language server handles all linting.
    // Gradle lint is only initialized as a fallback when:
    //   - The server is disabled in settings
    //   - The server fails to start

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

    // ── Language Server (ALS) ──────────────────────────────────────
    const serverEnabled = extensionConfig.get<boolean>(CONFIG_KEYS.SERVER_ENABLED, true);
    if (serverEnabled) {
        try {
            languageClientManager = new LanguageClientManager(context);
            languageClientManager.start().then(() => {
                logger.success('Android Language Server started');
            }).catch(err => {
                logger.warn(`Language server failed to start: ${err}. Falling back to Gradle lint.`);
                initGradleLintFallback(context);
            });
        } catch (err) {
            logger.warn(`Language server initialization failed: ${err}. Using Gradle lint fallback.`);
            initGradleLintFallback(context);
        }
    } else {
        logger.log('Language server disabled – using Gradle lint fallback');
        initGradleLintFallback(context);
    }

    // ── Build Variant Manager ──────────────────────────────────────
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        try {
            variantManager = new VariantManager(context);
            context.subscriptions.push(variantManager);
        } catch (err) {
            logger.warn(`Variant manager initialization failed: ${err}`);
        }
    }

    // ── Emulator Manager ───────────────────────────────────────────
    try {
        emulatorManager = new EmulatorManager();
    } catch (err) {
        logger.warn(`Emulator manager initialization failed: ${err}`);
    }

    // Log workspace info
    if (workspaceFolders) {
        logger.folder(`Workspace folders: ${workspaceFolders.map(f => f.uri.fsPath).join(', ')}`);
    } else {
        logger.warn('No workspace folder found');
    }

    // ── Register Commands ──────────────────────────────────────────
    registerCoreCommands(context);
    registerEmulatorCommands(context);
    registerVariantCommands(context);
    registerServerCommands(context);

    // Optional status bar item
    const showStatusBar = extensionConfig.get<boolean>(CONFIG_KEYS.SHOW_STATUS_BAR, false);
    if (showStatusBar) {
        runStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        runStatusBarItem.text = '$(debug-start) Run on Android';
        runStatusBarItem.tooltip = 'Install Debug build and launch on a connected device';
        runStatusBarItem.command = COMMANDS.LAUNCH_ON_DEVICE;
        runStatusBarItem.show();
        context.subscriptions.push(runStatusBarItem);
    }

    // ── Code Intelligence (fallback when LSP not active) ───────────
    // When the language server is running, these are provided by the server.
    // When fallback mode is active, we register the TypeScript-based providers.
    if (!serverEnabled) {
        registerFallbackProviders(context);
    }

    vscode.window.showInformationMessage('Android Linter is ready!');
}

// ── Helper: Gradle-based lint fallback ────────────────────────────
function initGradleLintFallback(context: vscode.ExtensionContext) {
    if (gradleLintFallbackInitialized) {
        return;
    }

    lintManager = new LintManager(diagnosticProvider, gradleProcessManager, logger.getOutputChannel());
    gradleLintFallbackInitialized = true;

    // Listen to file open events
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(async (document) => {
            logger.file(`File opened: ${document.fileName} (language: ${document.languageId})`);
            const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
            const shouldLintOnOpen = config.get<boolean>(CONFIG_KEYS.LINT_ON_OPEN);
            if (shouldLintOnOpen && isAndroidFile(document)) {
                logger.log(`   ▶️ Running lint on ${document.fileName}`);
                await lintManager.lintFile(document);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
            if (config.get<boolean>(CONFIG_KEYS.LINT_ON_SAVE) && isAndroidFile(document)) {
                await lintManager.lintFile(document);
            }
        })
    );

    let changeTimeout: NodeJS.Timeout | undefined;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
            if (config.get<boolean>(CONFIG_KEYS.LINT_ON_CHANGE) && isAndroidFile(event.document)) {
                if (changeTimeout) { clearTimeout(changeTimeout); }
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
}

// ── Helper: register TypeScript-based code intelligence providers ──
function registerFallbackProviders(context: vscode.ExtensionContext) {
    const codeActionProvider = new CodeActionProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            [...SUPPORTED_LANGUAGES],
            codeActionProvider,
            { providedCodeActionKinds: CodeActionProvider.providedCodeActionKinds }
        )
    );

    const definitionProvider = new DefinitionProvider();
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(['kotlin', 'java'], definitionProvider)
    );

    const referenceProvider = new ReferenceProvider();
    context.subscriptions.push(
        vscode.languages.registerReferenceProvider(['kotlin', 'java'], referenceProvider)
    );

    const enableHover = vscode.workspace.getConfiguration(CONFIG_NAMESPACE)
        .get<boolean>(CONFIG_KEYS.ENABLE_HOVER_REFERENCES, false);
    if (enableHover) {
        const hoverProvider = new HoverProvider();
        context.subscriptions.push(
            vscode.languages.registerHoverProvider(['kotlin', 'java'], hoverProvider)
        );
    }
    logger.success('Registered fallback code intelligence providers');
}

// ── Helper: core commands ──────────────────────────────────────────
function registerCoreCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.LINT_CURRENT_FILE, async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                if (lintManager) {
                    await lintManager.lintFile(editor.document);
                } else {
                    vscode.window.showInformationMessage('Lint is handled by the Language Server');
                }
            } else {
                vscode.window.showWarningMessage('No active file to lint');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.LINT_PROJECT, async () => {
            if (lintManager) {
                await lintManager.lintProject();
            } else {
                vscode.window.showInformationMessage('Project lint is handled by the Language Server');
            }
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
            setTimeout(() => androidExplorerView.refreshDevices(), 2000);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.ADB_PAIR, async () => {
            await adbWirelessManager.pair();
        })
    );

    // Extract String Resource
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.EXTRACT_STRING, async (uri: vscode.Uri, range: vscode.Range) => {
            const document = await vscode.workspace.openTextDocument(uri);
            const text = document.getText(range);
            
            const resourceName = await vscode.window.showInputBox({
                prompt: 'Enter the string resource name',
                placeHolder: 'my_string_name',
                validateInput: (value) => {
                    if (!value) { return 'Resource name is required'; }
                    if (!/^[a-z][a-z0-9_]*$/.test(value)) {
                        return 'Resource name must start with lowercase letter and contain only lowercase letters, numbers, and underscores';
                    }
                    return null;
                }
            });

            if (!resourceName) { return; }

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
                if (fs.existsSync(p)) { stringsXmlPath = p; break; }
            }

            if (!stringsXmlPath) {
                vscode.window.showErrorMessage('Could not find strings.xml file');
                return;
            }

            try {
                let stringsContent = fs.readFileSync(stringsXmlPath, 'utf8');
                const cleanText = text.replace(/^["']|["']$/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const newString = `    <string name="${resourceName}">${cleanText}</string>\n`;
                stringsContent = stringsContent.replace('</resources>', `${newString}</resources>`);
                fs.writeFileSync(stringsXmlPath, stringsContent, 'utf8');

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
}

// ── Emulator commands ──────────────────────────────────────────────
function registerEmulatorCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.CREATE_EMULATOR, async () => {
            if (emulatorManager) {
                await emulatorManager.createAvdWizard();
            } else {
                vscode.window.showErrorMessage('Emulator manager not available');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.START_EMULATOR, async () => {
            if (!emulatorManager) {
                vscode.window.showErrorMessage('Emulator manager not available');
                return;
            }
            const avds = await emulatorManager.listAvds();
            if (avds.length === 0) {
                vscode.window.showWarningMessage('No AVDs found. Create one first.');
                return;
            }
            const pick = await vscode.window.showQuickPick(
                avds.map(a => ({ label: a.name, description: a.isRunning ? '(running)' : '' })),
                { placeHolder: 'Select AVD to start' }
            );
            if (pick) {
                await emulatorManager.startEmulator(pick.label);
                setTimeout(() => androidExplorerView.refreshDevices(), 5000);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.STOP_EMULATOR, async () => {
            if (!emulatorManager) {
                vscode.window.showErrorMessage('Emulator manager not available');
                return;
            }
            // List running emulators via ADB
            const serial = await vscode.window.showInputBox({
                prompt: 'Enter emulator serial (e.g. emulator-5554)',
                placeHolder: 'emulator-5554'
            });
            if (serial) {
                await emulatorManager.stopEmulator(serial);
                setTimeout(() => androidExplorerView.refreshDevices(), 2000);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.DELETE_EMULATOR, async () => {
            if (!emulatorManager) {
                vscode.window.showErrorMessage('Emulator manager not available');
                return;
            }
            const avds = await emulatorManager.listAvds();
            if (avds.length === 0) {
                vscode.window.showWarningMessage('No AVDs to delete.');
                return;
            }
            const pick = await vscode.window.showQuickPick(
                avds.map(a => ({ label: a.name, description: a.isRunning ? '(running)' : '' })),
                { placeHolder: 'Select AVD to delete' }
            );
            if (pick) {
                await emulatorManager.deleteAvd(pick.label);
            }
        })
    );
}

// ── Variant commands ───────────────────────────────────────────────
function registerVariantCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.SELECT_VARIANT, async () => {
            if (variantManager) {
                await variantManager.selectVariant();
            } else {
                vscode.window.showWarningMessage('Variant manager not available');
            }
        })
    );
}

// ── Language Server commands ───────────────────────────────────────
function registerServerCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.RESTART_SERVER, async () => {
            if (languageClientManager) {
                await languageClientManager.restart();
                vscode.window.showInformationMessage('Android Language Server restarted');
            } else {
                vscode.window.showWarningMessage('Language server is not enabled');
            }
        })
    );
}


export function deactivate() {
    const promises: Thenable<void>[] = [];
    
    if (languageClientManager) {
        promises.push(languageClientManager.stop());
    }
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
    if (variantManager) {
        variantManager.dispose();
    }
    if (runStatusBarItem) {
        runStatusBarItem.dispose();
    }
    
    return Promise.all(promises);
}

function isAndroidFile(document: vscode.TextDocument): boolean {
    const validLanguages = ['kotlin', 'java', 'xml'];
    const filePath = document.uri.fsPath.toLowerCase();
    const validExtensions = ['.kt', '.kts', '.java', '.xml'];
    const hasValidExtension = validExtensions.some(ext => filePath.endsWith(ext));

    if (!validLanguages.includes(document.languageId) && !hasValidExtension) {
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
    
    const appLevelGradle = fs.existsSync(path.join(workspaceRoot, 'app', 'build.gradle')) || fs.existsSync(path.join(workspaceRoot, 'app', 'build.gradle.kts'));

    return appLevelGradle;
}
