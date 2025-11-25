import * as vscode from 'vscode';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { AndroidDeviceManager } from './androidDeviceManager';
import { LogcatWebviewPanel } from './logcatWebview';
import { CONFIG_NAMESPACE, CONFIG_KEYS, OUTPUT_CHANNELS } from './constants';
import { Logger } from './logger';

type LogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error' | 'assert';

const levelMap: Record<LogLevel, string> = {
    verbose: 'V',
    debug: 'D',
    info: 'I',
    warn: 'W',
    error: 'E',
    assert: 'F'
};

export class LogcatManager implements vscode.Disposable {
    private readonly deviceManager: AndroidDeviceManager;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly logger: Logger;
    private logcatProcess?: ChildProcessWithoutNullStreams;
    private currentDeviceId?: string;
    private currentPackage?: string;
    private webviewPanel?: LogcatWebviewPanel;
    private useWebview: boolean = true;

    constructor(deviceManager: AndroidDeviceManager, extensionUri?: vscode.Uri) {
        this.deviceManager = deviceManager;
        this.outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNELS.LOGCAT);
        this.logger = Logger.create(this.outputChannel, 'Logcat');
        
        // Initialize webview panel if URI provided
        if (extensionUri) {
            this.webviewPanel = LogcatWebviewPanel.getInstance(extensionUri);
        }

        // Check user preference for UI mode
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        this.useWebview = config.get<boolean>(CONFIG_KEYS.LOGCAT_USE_WEBVIEW, true);
    }

    public async start(deviceId: string, packageName?: string): Promise<void> {
        await this.stop();

        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const levelKey = (config.get<string>(CONFIG_KEYS.LOGCAT_LEVEL) || 'info').toLowerCase() as LogLevel;
        const logLevel = levelMap[levelKey] ? levelMap[levelKey] : levelMap.info;
        const format = config.get<string>(CONFIG_KEYS.LOGCAT_FORMAT) || 'threadtime';
        const autoClear = config.get<boolean>(CONFIG_KEYS.LOGCAT_AUTO_CLEAR, true);

        const adbPath = this.deviceManager.getAdbPath();
        const args = ['-s', deviceId, 'logcat', '--format', format];

        let appliedPidFilter = false;

        if (packageName) {
            const pidTimeout = config.get<number>(CONFIG_KEYS.LOGCAT_PID_WAIT_TIMEOUT_MS) || 10000;
            const pidInterval = config.get<number>(CONFIG_KEYS.LOGCAT_PID_POLL_INTERVAL_MS) || 500;
            const pids = await this.deviceManager.waitForProcessIds(deviceId, packageName, pidTimeout, pidInterval);

            if (pids.length > 0) {
                pids.forEach(pid => {
                    args.push('--pid', pid);
                });
                appliedPidFilter = true;
            } else {
                this.logger.warn(`Could not determine PID for ${packageName} within ${pidTimeout}ms. Showing full logcat output.`);
            }
        }

        args.push(`*:${logLevel}`);

        if (autoClear) {
            await this.deviceManager.clearLogcat(deviceId);
        }

        this.logger.log(`📡 Starting logcat for ${deviceId}${packageName ? ` (package: ${packageName})` : ''}`);

        // Show webview or output channel
        if (this.useWebview && this.webviewPanel) {
            this.webviewPanel.show();
            this.webviewPanel.clear();
        } else {
            this.outputChannel.show(true);
        }

        const child = spawn(adbPath, args, { shell: process.platform === 'win32' });

        this.logcatProcess = child;
        this.currentDeviceId = deviceId;
        this.currentPackage = packageName;

        child.stdout.on('data', (data: Buffer) => {
            const text = data.toString();
            
            // Always write to output channel (as backup)
            this.outputChannel.append(text);
            
            // Also send to webview if enabled
            if (this.useWebview && this.webviewPanel) {
                const lines = text.split('\n');
                lines.forEach(line => {
                    if (line.trim()) {
                        this.webviewPanel!.addLog(line);
                    }
                });
            }
        });

        child.stderr.on('data', (data: Buffer) => {
            this.outputChannel.append(data.toString());
        });

        child.on('close', (code) => {
            this.logcatProcess = undefined;
            const codeInfo = code !== null ? ` (code ${code})` : '';
            this.logger.stop(`Logcat process exited${codeInfo}`);
        });

        child.on('error', (error) => {
            this.logger.error(`Failed to start logcat: ${error.message}`);
            vscode.window.showErrorMessage('Android Linter: Failed to start logcat. Check Output for details.');
        });
    }

    public async stop(): Promise<void> {
        if (this.logcatProcess) {
            if (!this.logcatProcess.killed) {
                this.logcatProcess.kill();
            }
            this.logcatProcess = undefined;
            this.logger.stop('Stopped logcat');
        }
        this.currentDeviceId = undefined;
        this.currentPackage = undefined;
    }

    public clearWebview(): void {
        if (this.webviewPanel) {
            this.webviewPanel.clear();
        }
    }

    public async restart(): Promise<void> {
        if (this.currentDeviceId) {
            await this.start(this.currentDeviceId, this.currentPackage);
        }
    }

    public isRunning(): boolean {
        return Boolean(this.logcatProcess);
    }

    public getActiveDevice(): string | undefined {
        return this.currentDeviceId;
    }

    public dispose(): void {
        void this.stop();
        if (this.webviewPanel) {
            this.webviewPanel.dispose();
        }
        this.outputChannel.dispose();
    }
}