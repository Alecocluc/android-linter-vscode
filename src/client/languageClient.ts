import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { Logger } from '../logger';
import { CONFIG_NAMESPACE } from '../constants';

/**
 * Manages the Android Language Server (ALS) lifecycle.
 * 
 * Responsibilities:
 * - Find/download the ALS JAR
 * - Start the JVM process with proper arguments
 * - Create and manage the LSP LanguageClient
 * - Handle server crashes and restarts
 * - Relay custom notifications (build variants, resource index, etc.)
 */
export class LanguageClientManager implements vscode.Disposable {
    private client: LanguageClient | undefined;
    private logger: Logger;
    private context: vscode.ExtensionContext;
    private statusBarItem: vscode.StatusBarItem;
    private outputChannel: vscode.OutputChannel;
    
    // Custom event handlers
    private onServerReadyCallbacks: Array<() => void> = [];

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.logger = Logger.getInstance();
        this.outputChannel = vscode.window.createOutputChannel('Android Language Server');
        
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
        this.statusBarItem.text = '$(loading~spin) ALS';
        this.statusBarItem.tooltip = 'Android Language Server: Starting...';
        this.statusBarItem.show();
    }

    /**
     * Start the language server.
     */
    async start(): Promise<void> {
        const serverJar = await this.resolveServerJar();
        if (!serverJar) {
            this.statusBarItem.text = '$(error) ALS';
            this.statusBarItem.tooltip = 'Android Language Server: JAR not found';
            this.logger.error('Android Language Server JAR not found. Run "npm run build-server" to build it.');
            vscode.window.showErrorMessage(
                'Android Language Server not found. Build it with: cd server && ./gradlew shadowJar',
                'Build Server'
            ).then(selection => {
                if (selection === 'Build Server') {
                    this.buildServer();
                }
            });
            return;
        }
        
        this.logger.start(`Starting Android Language Server: ${serverJar}`);
        
        // Find Java
        const javaPath = this.resolveJavaPath();
        if (!javaPath) {
            this.statusBarItem.text = '$(error) ALS';
            this.statusBarItem.tooltip = 'Android Language Server: Java not found';
            vscode.window.showErrorMessage(
                'Java 17+ is required for the Android Language Server. Set JAVA_HOME or install JDK 17+.'
            );
            return;
        }
        
        // JVM arguments
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const extraJvmArgs = config.get<string>('serverJvmArgs', '');
        
        const jvmArgs = [
            '-Xmx2g',                    // 2GB max heap
            '-XX:+UseG1GC',             // G1 garbage collector
            '-XX:+UseStringDeduplication', // Save memory on repeated strings
            ...(extraJvmArgs ? extraJvmArgs.split(' ') : []),
            '-jar', serverJar
        ];
        
        const serverOptions: ServerOptions = {
            command: javaPath,
            args: jvmArgs,
            options: {
                env: {
                    ...process.env,
                    // Pass SDK location if configured
                    ANDROID_HOME: process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '',
                }
            },
            transport: TransportKind.stdio
        };
        
        const clientOptions: LanguageClientOptions = {
            documentSelector: [
                { scheme: 'file', language: 'kotlin' },
                { scheme: 'file', language: 'java' },
                { scheme: 'file', language: 'xml' },
                { scheme: 'file', language: 'plaintext', pattern: '**/*.kt' },
                { scheme: 'file', language: 'plaintext', pattern: '**/*.kts' },
                { scheme: 'file', language: 'plaintext', pattern: '**/*.java' },
                { scheme: 'file', language: 'plaintext', pattern: '**/*.xml' },
                { scheme: 'file', language: 'groovy', pattern: '**/build.gradle' },
            ],
            synchronize: {
                fileEvents: [
                    vscode.workspace.createFileSystemWatcher('**/build.gradle'),
                    vscode.workspace.createFileSystemWatcher('**/build.gradle.kts'),
                    vscode.workspace.createFileSystemWatcher('**/settings.gradle'),
                    vscode.workspace.createFileSystemWatcher('**/settings.gradle.kts'),
                    vscode.workspace.createFileSystemWatcher('**/lint.xml'),
                    vscode.workspace.createFileSystemWatcher('**/res/values/*.xml'),
                    vscode.workspace.createFileSystemWatcher('**/AndroidManifest.xml'),
                ]
            },
            outputChannel: this.outputChannel,
            revealOutputChannelOn: 4, // Never auto-reveal
        };
        
        this.client = new LanguageClient(
            'android-language-server',
            'Android Language Server',
            serverOptions,
            clientOptions
        );
        
        // Handle server state changes
        this.client.onDidChangeState(event => {
            switch (event.newState) {
                case 1: // Stopped
                    this.statusBarItem.text = '$(circle-slash) ALS';
                    this.statusBarItem.tooltip = 'Android Language Server: Stopped';
                    break;
                case 2: // Starting
                    this.statusBarItem.text = '$(loading~spin) ALS';
                    this.statusBarItem.tooltip = 'Android Language Server: Starting...';
                    break;
                case 3: // Running
                    this.statusBarItem.text = '$(check) ALS';
                    this.statusBarItem.tooltip = 'Android Language Server: Running';
                    this.onServerReadyCallbacks.forEach(cb => cb());
                    break;
            }
        });
        
        // Start the client (which starts the server)
        await this.client.start();
        
        this.logger.success('Android Language Server started');
    }

    /**
     * Stop the language server.
     */
    async stop(): Promise<void> {
        if (this.client) {
            this.logger.stop('Stopping Android Language Server');
            await this.client.stop();
            this.client = undefined;
        }
    }

    /**
     * Restart the language server.
     */
    async restart(): Promise<void> {
        await this.stop();
        await this.start();
    }

    /**
     * Register a callback for when the server is ready.
     */
    onServerReady(callback: () => void): void {
        this.onServerReadyCallbacks.push(callback);
    }

    /**
     * Get the underlying LanguageClient (for sending custom requests).
     */
    getClient(): LanguageClient | undefined {
        return this.client;
    }

    /**
     * Check if the server is running.
     */
    isRunning(): boolean {
        return this.client?.isRunning() ?? false;
    }

    /**
     * Resolve the path to the ALS JAR file.
     * Checks: extension bundled → workspace build output → global storage
     */
    private async resolveServerJar(): Promise<string | undefined> {
        const extensionPath = this.context.extensionPath;

        // Check extension source build output (Extension Development Host)
        const extensionDevJar = path.join(extensionPath, 'server', 'build', 'libs', 'android-language-server.jar');
        if (fs.existsSync(extensionDevJar)) {
            return extensionDevJar;
        }
        
        // Check workspace server build output
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            for (const folder of workspaceFolders) {
                const devJar = path.join(folder.uri.fsPath, 'server', 'build', 'libs', 'android-language-server.jar');
                if (fs.existsSync(devJar)) {
                    return devJar;
                }
            }
        }
        
        // Check extension-bundled JAR
        const bundledJar = path.join(extensionPath, 'server', 'android-language-server.jar');
        if (fs.existsSync(bundledJar)) {
            return bundledJar;
        }
        
        // Check extension global storage
        const globalStorageJar = path.join(this.context.globalStorageUri.fsPath, 'android-language-server.jar');
        if (fs.existsSync(globalStorageJar)) {
            return globalStorageJar;
        }
        
        return undefined;
    }

    /**
     * Resolve the path to the Java executable.
     * Checks: settings → JAVA_HOME → PATH
     */
    private resolveJavaPath(): string | undefined {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        
        // Check settings
        const configuredPath = config.get<string>('javaPath', '');
        if (configuredPath && fs.existsSync(configuredPath)) {
            return configuredPath;
        }
        
        // Check JAVA_HOME
        const javaHome = process.env.JAVA_HOME;
        if (javaHome) {
            const javaBin = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
            if (fs.existsSync(javaBin)) {
                return javaBin;
            }
        }
        
        // Fall back to PATH
        return 'java';
    }

    /**
     * Build the server JAR from source.
     */
    private async buildServer(): Promise<void> {
        const serverDir = path.join(this.context.extensionPath, 'server');
        if (!fs.existsSync(serverDir)) {
            vscode.window.showErrorMessage('server/ directory not found in extension project');
            return;
        }
        
        const terminal = vscode.window.createTerminal({
            name: 'Build ALS',
            cwd: serverDir
        });
        
        const gradlew = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';
        terminal.sendText(`${gradlew} shadowJar`);
        terminal.show();
    }

    dispose(): void {
        this.statusBarItem.dispose();
        this.outputChannel.dispose();
        if (this.client) {
            this.client.stop();
        }
    }
}
