import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { LintIssue } from './diagnosticProvider';
import { Logger } from './logger';
import { CONFIG_NAMESPACE } from './constants';

/**
 * Client for communicating with the Android Lint Server daemon.
 * 
 * The lint server is a JVM process that runs the Android Lint library directly,
 * providing much faster analysis than running Gradle lint tasks.
 */
export class LintServerClient implements vscode.Disposable {
    private process: ChildProcess | null = null;
    private logger: Logger;
    private requestId = 0;
    private pendingRequests = new Map<number, {
        resolve: (value: any) => void;
        reject: (reason: any) => void;
        timeout: NodeJS.Timeout;
    }>();
    private buffer = '';
    private initialized = false;
    private projectPath: string | null = null;
    private serverJarPath: string;
    private onReadyCallback: (() => void) | null = null;
    private startupPromise: Promise<boolean> | null = null;

    constructor(
        private extensionPath: string,
        outputChannel?: vscode.OutputChannel
    ) {
        const channel = outputChannel || vscode.window.createOutputChannel('Android Linter');
        this.logger = Logger.create(channel, 'LintServer');
        
        // The server JAR should be in the extension's lint-server/build/libs directory
        this.serverJarPath = path.join(extensionPath, 'lint-server', 'build', 'libs', 'lint-server.jar');
    }

    /**
     * Check if the lint server JAR is available
     */
    public isAvailable(): boolean {
        return fs.existsSync(this.serverJarPath);
    }

    /**
     * Start the lint server daemon
     */
    public async start(): Promise<boolean> {
        if (this.process) {
            this.logger.log('Lint server already running');
            return true;
        }

        // Return existing startup promise if we're already starting
        if (this.startupPromise) {
            return this.startupPromise;
        }

        this.startupPromise = this.doStart();
        try {
            return await this.startupPromise;
        } finally {
            this.startupPromise = null;
        }
    }

    private async doStart(): Promise<boolean> {
        if (!this.isAvailable()) {
            this.logger.warn(`Lint server JAR not found at: ${this.serverJarPath}`);
            this.logger.log('To build the lint server, run: cd lint-server && ./gradlew shadowJar');
            return false;
        }

        // Find Java
        const javaPath = await this.findJava();
        if (!javaPath) {
            this.logger.error('Java not found. Please install JDK 17 or later.');
            return false;
        }

        this.logger.start('Starting Android Lint Server daemon...');

        return new Promise((resolve) => {
            try {
                const args = [
                    '-Xmx1g',
                    '-jar', this.serverJarPath,
                    'daemon'
                ];

                this.process = spawn(javaPath, args, {
                    cwd: this.extensionPath,
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                // Set up stdout handling
                this.process.stdout?.on('data', (data: Buffer) => {
                    this.handleOutput(data.toString());
                });

                // Set up stderr handling (for logs)
                this.process.stderr?.on('data', (data: Buffer) => {
                    const text = data.toString().trim();
                    if (text) {
                        this.logger.log(`[Server] ${text}`);
                    }
                });

                this.process.on('error', (error) => {
                    this.logger.error(`Server process error: ${error.message}`);
                    this.cleanup();
                    resolve(false);
                });

                this.process.on('exit', (code, signal) => {
                    this.logger.log(`Server process exited (code: ${code}, signal: ${signal})`);
                    this.cleanup();
                });

                // Wait for the "ready" notification
                this.onReadyCallback = () => {
                    this.logger.success('Lint server started successfully');
                    resolve(true);
                };

                // Timeout for startup
                setTimeout(() => {
                    if (!this.initialized) {
                        this.logger.warn('Lint server startup timed out');
                        resolve(false);
                    }
                }, 30000);

            } catch (error) {
                this.logger.error(`Failed to start lint server: ${error}`);
                resolve(false);
            }
        });
    }

    /**
     * Initialize the server for a specific project
     */
    public async initialize(projectPath: string): Promise<boolean> {
        if (!this.process) {
            const started = await this.start();
            if (!started) {
                return false;
            }
        }

        try {
            const response = await this.sendRequest('initialize', {
                projectPath: projectPath
            });

            if (response.result?.success) {
                this.initialized = true;
                this.projectPath = projectPath;
                this.logger.success(`Initialized for project: ${projectPath}`);
                this.logger.log(`Available checks: ${response.result.checksCount}`);
                return true;
            } else {
                this.logger.error(`Initialization failed: ${response.result?.message || response.error?.message}`);
                return false;
            }
        } catch (error) {
            this.logger.error(`Initialization error: ${error}`);
            return false;
        }
    }

    /**
     * Analyze a single file
     */
    public async analyzeFile(filePath: string, fileContent?: string): Promise<LintIssue[]> {
        if (!this.initialized) {
            this.logger.warn('Server not initialized');
            return [];
        }

        try {
            const params: Record<string, string> = {
                filePath: filePath
            };

            if (fileContent) {
                params['fileContent'] = fileContent;
            }

            const response = await this.sendRequest('analyzeFile', params);

            if (response.result?.success && response.result.issues) {
                return this.convertIssues(response.result.issues);
            } else {
                this.logger.warn(`Analysis failed: ${response.result?.message || response.error?.message}`);
                return [];
            }
        } catch (error) {
            this.logger.error(`Analysis error: ${error}`);
            return [];
        }
    }

    /**
     * Analyze the entire project
     */
    public async analyzeProject(): Promise<LintIssue[]> {
        if (!this.initialized) {
            this.logger.warn('Server not initialized');
            return [];
        }

        try {
            const response = await this.sendRequest('analyzeProject', {});

            if (response.result?.success && response.result.issues) {
                return this.convertIssues(response.result.issues);
            } else {
                this.logger.warn(`Project analysis failed: ${response.result?.message || response.error?.message}`);
                return [];
            }
        } catch (error) {
            this.logger.error(`Project analysis error: ${error}`);
            return [];
        }
    }

    /**
     * Clear the server's internal cache
     */
    public async clearCache(): Promise<void> {
        if (!this.process) return;

        try {
            await this.sendRequest('clearCache', {});
            this.initialized = false;
            this.projectPath = null;
            this.logger.log('Server cache cleared');
        } catch (error) {
            this.logger.error(`Clear cache error: ${error}`);
        }
    }

    /**
     * Check if the server is running and healthy
     */
    public async ping(): Promise<boolean> {
        if (!this.process) return false;

        try {
            const response = await this.sendRequest('ping', {}, 5000);
            return response.result?.success === true;
        } catch {
            return false;
        }
    }

    /**
     * Stop the lint server
     */
    public async stop(): Promise<void> {
        if (!this.process) return;

        try {
            await this.sendRequest('shutdown', {}, 5000);
        } catch {
            // Ignore errors during shutdown
        }

        this.cleanup();
    }

    public dispose(): void {
        this.stop();
    }

    // ---- Private methods ----

    private handleOutput(data: string) {
        this.buffer += data;
        
        // Process complete lines
        let newlineIndex: number;
        while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.substring(0, newlineIndex).trim();
            this.buffer = this.buffer.substring(newlineIndex + 1);
            
            if (line) {
                this.processMessage(line);
            }
        }
    }

    private processMessage(line: string) {
        try {
            const message = JSON.parse(line);

            // Handle notifications
            if (message.method === 'ready') {
                this.logger.log('Received ready notification');
                if (this.onReadyCallback) {
                    this.onReadyCallback();
                    this.onReadyCallback = null;
                }
                return;
            }

            // Handle responses
            if (message.id !== undefined) {
                const pending = this.pendingRequests.get(message.id);
                if (pending) {
                    clearTimeout(pending.timeout);
                    this.pendingRequests.delete(message.id);
                    pending.resolve(message);
                }
            }
        } catch (error) {
            this.logger.warn(`Failed to parse message: ${line}`);
        }
    }

    private sendRequest(method: string, params: Record<string, string>, timeout = 60000): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.process?.stdin) {
                reject(new Error('Server not running'));
                return;
            }

            const id = ++this.requestId;
            const request = JSON.stringify({ id, method, params }) + '\n';

            const timeoutHandle = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request timed out: ${method}`));
            }, timeout);

            this.pendingRequests.set(id, {
                resolve,
                reject,
                timeout: timeoutHandle
            });

            this.process.stdin.write(request);
        });
    }

    private convertIssues(serverIssues: any[]): LintIssue[] {
        return serverIssues.map(issue => ({
            file: issue.file,
            line: issue.line || 1,
            column: issue.column || 1,
            severity: this.mapSeverity(issue.severity),
            message: issue.message,
            source: 'Android Lint',
            id: issue.id,
            category: issue.category || 'General',
            quickFix: issue.quickFix ? {
                title: issue.quickFix.description,
                replacement: issue.quickFix.replacementText
            } : undefined
        }));
    }

    private mapSeverity(severity: string): 'error' | 'warning' | 'information' {
        switch (severity?.toLowerCase()) {
            case 'error':
            case 'fatal':
                return 'error';
            case 'warning':
                return 'warning';
            case 'information':
            case 'informational':
            case 'hint':
                return 'information';
            default:
                return 'warning';
        }
    }

    private async findJava(): Promise<string | null> {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const configuredJava = config.get<string>('javaPath');
        
        if (configuredJava && fs.existsSync(configuredJava)) {
            return configuredJava;
        }

        // Check JAVA_HOME
        const javaHome = process.env.JAVA_HOME;
        if (javaHome) {
            const javaExe = process.platform === 'win32' 
                ? path.join(javaHome, 'bin', 'java.exe')
                : path.join(javaHome, 'bin', 'java');
            if (fs.existsSync(javaExe)) {
                return javaExe;
            }
        }

        // Try to find java in PATH
        const javaInPath = process.platform === 'win32' ? 'java.exe' : 'java';
        try {
            const { execSync } = require('child_process');
            const which = process.platform === 'win32' ? 'where' : 'which';
            const result = execSync(`${which} ${javaInPath}`, { encoding: 'utf8' });
            const javaPath = result.trim().split('\n')[0];
            if (javaPath && fs.existsSync(javaPath)) {
                return javaPath;
            }
        } catch {
            // Not found in PATH
        }

        return null;
    }

    private cleanup() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }

        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Server stopped'));
        }
        this.pendingRequests.clear();

        this.initialized = false;
        this.projectPath = null;
        this.buffer = '';
    }
}

/**
 * Get or create a singleton lint server client
 */
let lintServerInstance: LintServerClient | null = null;

export function getLintServerClient(extensionPath: string, outputChannel?: vscode.OutputChannel): LintServerClient {
    if (!lintServerInstance) {
        lintServerInstance = new LintServerClient(extensionPath, outputChannel);
    }
    return lintServerInstance;
}

export function disposeLintServerClient(): void {
    if (lintServerInstance) {
        lintServerInstance.dispose();
        lintServerInstance = null;
    }
}
