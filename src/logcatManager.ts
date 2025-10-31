import * as vscode from 'vscode';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { AndroidDeviceManager } from './androidDeviceManager';

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
    private logcatProcess?: ChildProcessWithoutNullStreams;
    private currentDeviceId?: string;
    private currentPackage?: string;

    constructor(deviceManager: AndroidDeviceManager) {
        this.deviceManager = deviceManager;
        this.outputChannel = vscode.window.createOutputChannel('Android Logcat');
    }

    public async start(deviceId: string, packageName?: string): Promise<void> {
        await this.stop();

        const config = vscode.workspace.getConfiguration('android-linter');
        const levelKey = (config.get<string>('logcatLevel') || 'info').toLowerCase() as LogLevel;
        const logLevel = levelMap[levelKey] ? levelMap[levelKey] : levelMap.info;
        const format = config.get<string>('logcatFormat') || 'threadtime';
        const autoClear = config.get<boolean>('logcatAutoClear', true);

        const adbPath = this.deviceManager.getAdbPath();
        const args = ['-s', deviceId, 'logcat', '--format', format];

        let appliedPidFilter = false;

        if (packageName) {
            const pidTimeout = config.get<number>('logcatPidWaitTimeoutMs') || 10000;
            const pidInterval = config.get<number>('logcatPidPollIntervalMs') || 500;
            const pids = await this.deviceManager.waitForProcessIds(deviceId, packageName, pidTimeout, pidInterval);

            if (pids.length > 0) {
                pids.forEach(pid => {
                    args.push('--pid', pid);
                });
                appliedPidFilter = true;
            } else {
                this.log(`⚠️ Could not determine PID for ${packageName} within ${pidTimeout}ms. Showing full logcat output.`);
            }
        }

        args.push(`*:${logLevel}`);

        if (autoClear) {
            await this.deviceManager.clearLogcat(deviceId);
        }

        this.log(`📡 Starting logcat for ${deviceId}${packageName ? ` (package: ${packageName})` : ''}`);
        this.outputChannel.show(true);

        const child = spawn(adbPath, args, { shell: process.platform === 'win32' });

        this.logcatProcess = child;
        this.currentDeviceId = deviceId;
        this.currentPackage = packageName;

        child.stdout.on('data', (data: Buffer) => {
            this.outputChannel.append(data.toString());
        });

        child.stderr.on('data', (data: Buffer) => {
            this.outputChannel.append(data.toString());
        });

        child.on('close', (code) => {
            this.logcatProcess = undefined;
            const codeInfo = code !== null ? ` (code ${code})` : '';
            this.log(`🛑 Logcat process exited${codeInfo}`);
        });

        child.on('error', (error) => {
            this.log(`❌ Failed to start logcat: ${error.message}`);
            vscode.window.showErrorMessage('Android Linter: Failed to start logcat. Check Output for details.');
        });
    }

    public async stop(): Promise<void> {
        if (this.logcatProcess) {
            if (!this.logcatProcess.killed) {
                this.logcatProcess.kill();
            }
            this.logcatProcess = undefined;
            this.log('🛑 Stopped logcat');
        }
        this.currentDeviceId = undefined;
        this.currentPackage = undefined;
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
        this.outputChannel.dispose();
    }

    private log(message: string): void {
        const config = vscode.workspace.getConfiguration('android-linter');
        if (config.get<boolean>('verboseLogging', true)) {
            this.outputChannel.appendLine(message);
        }
    }
}