import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../logger';

const execFileAsync = promisify(execFile);

/**
 * Manages Android emulators (AVDs).
 * 
 * Provides:
 * - List available AVDs
 * - Start/stop emulators
 * - Cold boot / wipe data
 * - Create new AVDs
 * - Query system images and device definitions
 */
export class EmulatorManager implements vscode.Disposable {
    private logger: Logger;
    private sdkPath: string | undefined;
    private runningEmulators = new Map<string, { pid: number }>();

    constructor() {
        this.logger = Logger.getInstance();
        this.sdkPath = this.resolveSdkPath();
    }

    /**
     * List all available AVDs.
     */
    async listAvds(): Promise<AvdInfo[]> {
        const emulatorPath = this.getEmulatorPath();
        if (!emulatorPath) {
            this.logger.warn('Emulator not found in Android SDK');
            return [];
        }

        try {
            const { stdout } = await execFileAsync(emulatorPath, ['-list-avds'], { timeout: 10000 });
            const avds = stdout.trim().split('\n').filter(line => line.trim().length > 0);
            
            return avds.map(name => ({
                name: name.trim(),
                isRunning: this.runningEmulators.has(name.trim())
            }));
        } catch (error) {
            this.logger.error(`Failed to list AVDs: ${error}`);
            return [];
        }
    }

    /**
     * Start an emulator with the given AVD name.
     */
    async startEmulator(avdName: string, options: EmulatorStartOptions = {}): Promise<boolean> {
        const emulatorPath = this.getEmulatorPath();
        if (!emulatorPath) {
            vscode.window.showErrorMessage('Emulator not found in Android SDK');
            return false;
        }

        const args = ['-avd', avdName];

        if (options.coldBoot) {
            args.push('-no-snapshot-load');
        }
        if (options.wipeData) {
            args.push('-wipe-data');
        }
        if (options.noWindow) {
            args.push('-no-window');
        }
        if (options.gpu) {
            args.push('-gpu', options.gpu);
        }

        this.logger.start(`Starting emulator: ${avdName}`);

        try {
            // Start emulator in background (don't await — it keeps running)
            const child = require('child_process').spawn(emulatorPath, args, {
                detached: true,
                stdio: 'ignore'
            });

            child.unref();
            
            this.runningEmulators.set(avdName, { pid: child.pid });
            
            vscode.window.showInformationMessage(`Emulator starting: ${avdName}`);
            return true;
        } catch (error) {
            this.logger.error(`Failed to start emulator: ${error}`);
            vscode.window.showErrorMessage(`Failed to start emulator: ${error}`);
            return false;
        }
    }

    /**
     * Stop a running emulator.
     */
    async stopEmulator(serialNumber: string): Promise<boolean> {
        const adbPath = this.getAdbPath();
        if (!adbPath) return false;

        try {
            await execFileAsync(adbPath, ['-s', serialNumber, 'emu', 'kill'], { timeout: 10000 });
            this.logger.stop(`Stopped emulator: ${serialNumber}`);
            return true;
        } catch (error) {
            this.logger.error(`Failed to stop emulator: ${error}`);
            return false;
        }
    }

    /**
     * List available system images for creating AVDs.
     */
    async listSystemImages(): Promise<SystemImage[]> {
        const avdManagerPath = this.getAvdManagerPath();
        if (!avdManagerPath) return [];

        try {
            const { stdout } = await execFileAsync(avdManagerPath, ['list', 'target', '--compact'], { timeout: 30000 });
            const images: SystemImage[] = [];
            
            // Parse output
            for (const line of stdout.split('\n')) {
                const trimmed = line.trim();
                if (trimmed.startsWith('system-images;')) {
                    const parts = trimmed.split(';');
                    if (parts.length >= 4) {
                        images.push({
                            id: trimmed,
                            apiLevel: parseInt(parts[1].replace('android-', ''), 10),
                            variant: parts[2],
                            abi: parts[3]
                        });
                    }
                }
            }
            
            return images;
        } catch (error) {
            this.logger.error(`Failed to list system images: ${error}`);
            return [];
        }
    }

    /**
     * List available device definitions.
     */
    async listDeviceDefinitions(): Promise<DeviceDefinition[]> {
        const avdManagerPath = this.getAvdManagerPath();
        if (!avdManagerPath) return [];

        try {
            const { stdout } = await execFileAsync(avdManagerPath, ['list', 'device', '--compact'], { timeout: 10000 });
            const devices: DeviceDefinition[] = [];
            
            for (const line of stdout.split('\n')) {
                const trimmed = line.trim();
                if (trimmed.length > 0 && !trimmed.startsWith('-') && !trimmed.startsWith('id:')) {
                    devices.push({ id: trimmed, name: trimmed });
                }
            }
            
            return devices;
        } catch (error) {
            this.logger.error(`Failed to list device definitions: ${error}`);
            return [];
        }
    }

    /**
     * Create a new AVD via multi-step wizard.
     */
    async createAvdWizard(): Promise<string | undefined> {
        // Step 1: Pick device definition
        const devices = await this.listDeviceDefinitions();
        const devicePick = await vscode.window.showQuickPick(
            devices.map(d => ({ label: d.name, description: d.id, deviceId: d.id })),
            { placeHolder: 'Select a device definition', title: 'Create AVD - Step 1: Device' }
        );
        if (!devicePick) return undefined;

        // Step 2: Pick system image (API level)
        const images = await this.listSystemImages();
        const imagePick = await vscode.window.showQuickPick(
            images.map(img => ({
                label: `API ${img.apiLevel}`,
                description: `${img.variant} - ${img.abi}`,
                imageId: img.id
            })),
            { placeHolder: 'Select a system image', title: 'Create AVD - Step 2: System Image' }
        );
        if (!imagePick) return undefined;

        // Step 3: Name the AVD
        const avdName = await vscode.window.showInputBox({
            prompt: 'Enter a name for the AVD',
            placeHolder: 'Pixel_7_API_34',
            validateInput: (value) => {
                if (!value) return 'Name is required';
                if (!/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(value)) {
                    return 'Name must start with a letter and contain only letters, numbers, underscores, dots, or hyphens';
                }
                return null;
            }
        });
        if (!avdName) return undefined;

        // Create the AVD
        const avdManagerPath = this.getAvdManagerPath();
        if (!avdManagerPath) {
            vscode.window.showErrorMessage('avdmanager not found in Android SDK');
            return undefined;
        }

        try {
            await execFileAsync(avdManagerPath, [
                'create', 'avd',
                '-n', avdName,
                '-k', (imagePick as any).imageId,
                '-d', (devicePick as any).deviceId,
                '--force'
            ], { timeout: 30000 });

            vscode.window.showInformationMessage(`AVD created: ${avdName}`);
            return avdName;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create AVD: ${error}`);
            return undefined;
        }
    }

    /**
     * Delete an AVD.
     */
    async deleteAvd(avdName: string): Promise<boolean> {
        const avdManagerPath = this.getAvdManagerPath();
        if (!avdManagerPath) return false;

        const confirm = await vscode.window.showWarningMessage(
            `Delete AVD "${avdName}"? This cannot be undone.`,
            'Delete', 'Cancel'
        );
        if (confirm !== 'Delete') return false;

        try {
            await execFileAsync(avdManagerPath, ['delete', 'avd', '-n', avdName], { timeout: 10000 });
            vscode.window.showInformationMessage(`AVD deleted: ${avdName}`);
            return true;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete AVD: ${error}`);
            return false;
        }
    }

    // ─── Path resolution ──────────────────────────────────────────────────────

    private resolveSdkPath(): string | undefined {
        const envPaths = [
            process.env.ANDROID_HOME,
            process.env.ANDROID_SDK_ROOT
        ];
        for (const p of envPaths) {
            if (p && fs.existsSync(p)) return p;
        }

        // Common paths
        const home = process.env.USERPROFILE || process.env.HOME || '';
        const commonPaths = [
            path.join(home, 'AppData', 'Local', 'Android', 'Sdk'),
            path.join(home, 'Android', 'Sdk'),
            path.join(home, 'Library', 'Android', 'sdk'),
        ];
        for (const p of commonPaths) {
            if (fs.existsSync(p)) return p;
        }

        return undefined;
    }

    private getEmulatorPath(): string | undefined {
        if (!this.sdkPath) return undefined;
        const emulatorPath = path.join(this.sdkPath, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');
        return fs.existsSync(emulatorPath) ? emulatorPath : undefined;
    }

    private getAvdManagerPath(): string | undefined {
        if (!this.sdkPath) return undefined;
        
        // Find cmdline-tools version
        const cmdlineToolsDir = path.join(this.sdkPath, 'cmdline-tools');
        if (fs.existsSync(cmdlineToolsDir)) {
            const versions = fs.readdirSync(cmdlineToolsDir).sort().reverse();
            for (const version of versions) {
                const avdManager = path.join(cmdlineToolsDir, version, 'bin', 
                    process.platform === 'win32' ? 'avdmanager.bat' : 'avdmanager');
                if (fs.existsSync(avdManager)) return avdManager;
            }
        }
        
        return undefined;
    }

    private getAdbPath(): string | undefined {
        if (!this.sdkPath) return undefined;
        const adbPath = path.join(this.sdkPath, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
        return fs.existsSync(adbPath) ? adbPath : undefined;
    }

    dispose(): void {
        this.runningEmulators.clear();
    }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AvdInfo {
    name: string;
    isRunning: boolean;
}

export interface EmulatorStartOptions {
    coldBoot?: boolean;
    wipeData?: boolean;
    noWindow?: boolean;
    gpu?: string; // 'auto' | 'host' | 'swiftshader_indirect' | 'off'
}

export interface SystemImage {
    id: string;
    apiLevel: number;
    variant: string; // 'google_apis' | 'google_apis_playstore' | 'default'
    abi: string;     // 'x86_64' | 'arm64-v8a'
}

export interface DeviceDefinition {
    id: string;
    name: string;
}
