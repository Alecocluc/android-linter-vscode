import * as vscode from 'vscode';
import { GradleCommandError, GradleProcessManager } from './gradleProcessManager';
import { AndroidDevice, AndroidDeviceManager } from './androidDeviceManager';
import { LogcatManager } from './logcatManager';
import { detectApplicationId, resolveManifestLauncher } from './androidProjectInfo';
import { CONFIG_NAMESPACE, CONFIG_KEYS } from './constants';
import { Logger } from './logger';

export class AndroidAppLauncher implements vscode.Disposable {
    private readonly gradleManager: GradleProcessManager;
    private readonly deviceManager: AndroidDeviceManager;
    private readonly logcatManager: LogcatManager;
    private readonly logger: Logger;
    private lastDeviceId?: string;
    private onAppIdDetected?: (appId: string) => void;

    constructor(
        gradleManager: GradleProcessManager,
        deviceManager: AndroidDeviceManager,
        logcatManager: LogcatManager,
        outputChannel: vscode.OutputChannel
    ) {
        this.gradleManager = gradleManager;
        this.deviceManager = deviceManager;
        this.logcatManager = logcatManager;
        this.logger = Logger.create(outputChannel, 'Launcher');
    }

    public setAppIdCallback(callback: (appId: string) => void): void {
        this.onAppIdDetected = callback;
    }

    public async launch(): Promise<void> {
        const workspaceFolder = this.getPrimaryWorkspace();
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('Android Linter: No workspace folder found.');
            return;
        }

        const devices = await this.deviceManager.listDevices();
        if (devices.length === 0) {
            vscode.window.showWarningMessage('Android Linter: No Android devices detected. Connect a device or start an emulator.');
            return;
        }

        const selectedDevice = await this.pickDevice(devices);
        if (!selectedDevice) {
            return;
        }

        this.lastDeviceId = selectedDevice.id;

        const applicationId = await this.resolveApplicationId(workspaceFolder.uri.fsPath);
        if (!applicationId) {
            vscode.window.showWarningMessage('Android Linter: Unable to determine applicationId. Set android-linter.launchApplicationId in settings.');
            return;
        }

        // Notify callback of detected app ID
        if (this.onAppIdDetected) {
            this.onAppIdDetected(applicationId);
        }

        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const installTask = config.get<string>(CONFIG_KEYS.LAUNCH_INSTALL_TASK) || 'installDebug';
        const installTimeout = config.get<number>(CONFIG_KEYS.LAUNCH_INSTALL_TIMEOUT_MS) || 240000;
        const autoStartLogcat = config.get<boolean>(CONFIG_KEYS.LOGCAT_AUTO_START_ON_LAUNCH, true);
        const moduleName = config.get<string>(CONFIG_KEYS.LAUNCH_MODULE) || 'app';

        let wasCancelled = false;

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Installing ${installTask} on ${selectedDevice.label}`,
                    cancellable: true
                },
                async (progress, token) => {
                    token.onCancellationRequested(() => {
                        wasCancelled = true;
                    });
                    progress.report({ message: 'Running Gradle task...' });
                    await this.gradleManager.runCommand(
                        workspaceFolder.uri.fsPath,
                        [installTask],
                        {
                            timeout: installTimeout,
                            cancellationToken: token
                        }
                    );
                }
            );

            if (wasCancelled) {
                this.logger.log('⚪ Installation cancelled');
                return;
            }

            this.logger.success(`Gradle task ${installTask} completed`);
        } catch (error) {
            if (wasCancelled) {
                this.logger.log('⚪ Installation cancelled');
                return;
            }

            if (error instanceof GradleCommandError && error.timedOut) {
                vscode.window.showErrorMessage('Android Linter: Gradle install timed out. Consider increasing android-linter.launchInstallTimeoutMs.');
                return;
            }

            if (error instanceof GradleCommandError) {
                this.logger.error(`Gradle install failed: ${error.stderr || error.stdout}`);
            }

            vscode.window.showErrorMessage('Android Linter: Failed to install debug build. Check Output for details.');
            return;
        }

        let componentName = await this.deviceManager.resolveLaunchableActivity(selectedDevice.id, applicationId);
        if (!componentName) {
            const manifestLauncher = await resolveManifestLauncher(workspaceFolder.uri.fsPath, moduleName);
            componentName = manifestLauncher?.componentName;
        }

        try {
            if (componentName) {
                await this.deviceManager.startActivity(selectedDevice.id, componentName);
                vscode.window.showInformationMessage(`Android Linter: Launched ${componentName} on ${selectedDevice.label}`);
            } else {
                await this.deviceManager.monkeyLaunch(selectedDevice.id, applicationId);
                vscode.window.showInformationMessage(`Android Linter: Launched ${applicationId} using Monkey on ${selectedDevice.label}`);
            }
        } catch (launchError) {
            const message = launchError instanceof Error ? launchError.message : String(launchError);
            this.logger.error(`Failed to launch app: ${message}`);
            vscode.window.showErrorMessage('Android Linter: Failed to launch the application.');
            return;
        }

        if (autoStartLogcat) {
            await this.logcatManager.start(selectedDevice.id, applicationId);
        }
    }

    public async startLogcatSession(): Promise<void> {
        const workspaceFolder = this.getPrimaryWorkspace();
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('Android Linter: No workspace folder found.');
            return;
        }

        const devices = await this.deviceManager.listDevices();
        if (devices.length === 0) {
            vscode.window.showWarningMessage('Android Linter: No Android devices detected.');
            return;
        }

        const selectedDevice = await this.pickDevice(devices);
        if (!selectedDevice) {
            return;
        }

        this.lastDeviceId = selectedDevice.id;

        const applicationId = await this.resolveApplicationId(workspaceFolder.uri.fsPath);

        // Notify callback of detected app ID
        if (applicationId && this.onAppIdDetected) {
            this.onAppIdDetected(applicationId);
        }

        await this.logcatManager.start(selectedDevice.id, applicationId);
    }

    public async stopLogcat(): Promise<void> {
        await this.logcatManager.stop();
    }

    public async relaunchApp(): Promise<void> {
        this.logger.log('🔄 Relaunching app...');
        await this.stopApp();
        await this.launch();
        this.logger.success('Relaunch complete');
    }

    public async stopApp(): Promise<void> {
        const workspaceFolder = this.getPrimaryWorkspace();
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('Android Linter: No workspace folder found.');
            return;
        }

        const deviceId = this.lastDeviceId;
        if (!deviceId) {
            vscode.window.showWarningMessage('Android Linter: No app has been launched yet.');
            return;
        }

        const applicationId = await this.resolveApplicationId(workspaceFolder.uri.fsPath);
        if (!applicationId) {
            vscode.window.showWarningMessage('Android Linter: Could not determine application ID to stop.');
            return;
        }

        this.logger.stop(`Stopping app: ${applicationId} on ${deviceId}`);
        await this.deviceManager.forceStop(deviceId, applicationId);
        vscode.window.showInformationMessage(`App ${applicationId} stopped.`);
    }

    public async debugApp(): Promise<void> {
        vscode.window.showInformationMessage('Android Linter: Debugging is not yet implemented.');
    }

    public dispose(): void {
        // Nothing additional to dispose currently
    }

    private getPrimaryWorkspace(): vscode.WorkspaceFolder | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        return workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0] : undefined;
    }

    private async pickDevice(devices: AndroidDevice[]): Promise<AndroidDevice | undefined> {
        const quickPickItems = devices.map(device => ({
            label: device.isEmulator ? `$(device-desktop) ${device.label}` : `$(device-mobile) ${device.label}`,
            description: device.state,
            device
        }));

        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Select a device to deploy the debug build',
            matchOnDescription: true,
            ignoreFocusOut: true
        });

        return selected?.device;
    }

    private async resolveApplicationId(workspaceRoot: string): Promise<string | undefined> {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const fromSettings = (config.get<string>(CONFIG_KEYS.LAUNCH_APPLICATION_ID) || '').trim();
        if (fromSettings) {
            return fromSettings;
        }

        const moduleName = config.get<string>(CONFIG_KEYS.LAUNCH_MODULE) || 'app';
        const detected = await detectApplicationId(workspaceRoot, moduleName);
        if (detected) {
            return detected;
        }

        const provided = await vscode.window.showInputBox({
            prompt: 'Enter the applicationId (e.g. com.example.app)',
            placeHolder: 'com.example.app',
            ignoreFocusOut: true
        });

        if (provided) {
            const remember = config.get<boolean>(CONFIG_KEYS.LAUNCH_REMEMBER_APPLICATION_ID, true);
            if (remember) {
                await config.update(CONFIG_KEYS.LAUNCH_APPLICATION_ID, provided.trim(), vscode.ConfigurationTarget.Workspace);
            }
            return provided.trim();
        }

        return undefined;
    }
}