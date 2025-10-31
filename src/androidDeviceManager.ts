import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execFileAsync = promisify(execFile);

export interface AndroidDevice {
    id: string;
    label: string;
    state: string;
    isEmulator: boolean;
    model?: string;
}

export class AndroidDeviceManager implements vscode.Disposable {
    private readonly outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    public async listDevices(): Promise<AndroidDevice[]> {
        try {
            const adbPath = this.getAdbPath();
            const { stdout } = await execFileAsync(adbPath, ['devices', '-l'], {
                timeout: 10000
            });

            const devices: AndroidDevice[] = [];
            const lines = stdout.trim().split(/\r?\n/);

            for (const line of lines.slice(1)) { // first line is header
                const trimmed = line.trim();
                if (!trimmed) {
                    continue;
                }

                const parts = trimmed.split(/\s+/);
                const id = parts[0];
                const state = parts[1] || 'unknown';

                if (!id || id.startsWith('*')) {
                    continue;
                }

                const modelMatch = trimmed.match(/model:(\S+)/);
                const device: AndroidDevice = {
                    id,
                    state,
                    model: modelMatch ? modelMatch[1] : undefined,
                    isEmulator: id.startsWith('emulator-'),
                    label: modelMatch ? `${modelMatch[1]} (${id})` : id
                };

                devices.push(device);
            }

            return devices;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`❌ Failed to list Android devices: ${message}`);
            vscode.window.showErrorMessage(`Android Linter: Unable to list connected Android devices. Ensure adb is installed and reachable.`);
            return [];
        }
    }

    public async resolveLaunchableActivity(deviceId: string, packageName: string): Promise<string | undefined> {
        try {
            const adbPath = this.getAdbPath();
            const { stdout } = await execFileAsync(
                adbPath,
                ['-s', deviceId, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', packageName],
                { timeout: 10000 }
            );

            const lines = stdout
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean);

            const component = lines.length > 0 ? lines[lines.length - 1] : undefined;
            if (component && component.includes('/')) {
                return component;
            }

            return undefined;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`⚠️ Failed to resolve launcher activity: ${message}`);
            return undefined;
        }
    }

    public async startActivity(deviceId: string, componentName: string): Promise<void> {
        const adbPath = this.getAdbPath();
        try {
            await execFileAsync(
                adbPath,
                ['-s', deviceId, 'shell', 'am', 'start', '-n', componentName],
                { timeout: 15000 }
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`❌ Failed to start activity ${componentName}: ${message}`);
            vscode.window.showErrorMessage(
                `Android Linter: Unable to start activity ${componentName} on ${deviceId}. Check Output for details.`
            );
            throw error;
        }
    }

    public async monkeyLaunch(deviceId: string, packageName: string): Promise<void> {
        const adbPath = this.getAdbPath();
        try {
            await execFileAsync(
                adbPath,
                ['-s', deviceId, 'shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'],
                { timeout: 15000 }
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`❌ Failed to start app via monkey for package ${packageName}: ${message}`);
            throw error;
        }
    }

    public async getProcessIds(deviceId: string, packageName: string): Promise<string[]> {
        const adbPath = this.getAdbPath();

        try {
            const { stdout } = await execFileAsync(
                adbPath,
                ['-s', deviceId, 'shell', 'pidof', packageName],
                { timeout: 5000 }
            );

            return stdout
                .trim()
                .split(/\s+/)
                .map(pid => pid.trim())
                .filter(Boolean);
        } catch {
            return [];
        }
    }

    public async waitForProcessIds(
        deviceId: string,
        packageName: string,
        timeoutMs: number,
        intervalMs: number
    ): Promise<string[]> {
        const started = Date.now();

        while (Date.now() - started < timeoutMs) {
            const pids = await this.getProcessIds(deviceId, packageName);
            if (pids.length > 0) {
                return pids;
            }
            await this.delay(intervalMs);
        }

        return [];
    }

    public async clearLogcat(deviceId: string): Promise<void> {
        try {
            const adbPath = this.getAdbPath();
            await execFileAsync(adbPath, ['-s', deviceId, 'logcat', '-c'], { timeout: 5000 });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`⚠️ Failed to clear logcat: ${message}`);
        }
    }

    public getAdbPath(): string {
        const config = vscode.workspace.getConfiguration('android-linter');
        let adbPath = (config.get<string>('adbPath') || 'adb').trim();

        const hasPathSeparator = adbPath.startsWith('./') || adbPath.includes('/') || adbPath.includes('\\');

        if (!path.isAbsolute(adbPath) && hasPathSeparator) {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                adbPath = adbPath.replace(/^\.\//, '');
                adbPath = path.join(workspaceFolder.uri.fsPath, adbPath);
            }
        }

        return adbPath;
    }

    public dispose(): void {
        // No resources to dispose currently
    }

    private log(message: string): void {
        const config = vscode.workspace.getConfiguration('android-linter');
        if (config.get<boolean>('verboseLogging', true)) {
            this.outputChannel.appendLine(message);
        }
    }

    private async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}