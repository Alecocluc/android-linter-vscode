import * as vscode from 'vscode';
import { GradleCommandError, GradleProcessManager } from './gradleProcessManager';
import { AndroidDevice, AndroidDeviceManager } from './androidDeviceManager';
import { LogcatManager } from './logcatManager';
import { detectApplicationId, resolveManifestLauncher } from './androidProjectInfo';

export class AndroidAppLauncher implements vscode.Disposable {
    private readonly gradleManager: GradleProcessManager;
    private readonly deviceManager: AndroidDeviceManager;
    private readonly logcatManager: LogcatManager;
    private readonly outputChannel: vscode.OutputChannel;
    private lastDeviceId?: string;

    constructor(
        gradleManager: GradleProcessManager,
        deviceManager: AndroidDeviceManager,
        logcatManager: LogcatManager,
        outputChannel: vscode.OutputChannel
    ) {
        this.gradleManager = gradleManager;
        this.deviceManager = deviceManager;
        this.logcatManager = logcatManager;
        this.outputChannel = outputChannel;
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

        const config = vscode.workspace.getConfiguration('android-linter');
        const installTask = config.get<string>('launchInstallTask') || 'installDebug';
        const installTimeout = config.get<number>('launchInstallTimeoutMs') || 240000;
        const autoStartLogcat = config.get<boolean>('logcatAutoStartOnLaunch', true);
        const moduleName = config.get<string>('launchModule') || 'app';

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
                this.log('⚪ Installation cancelled');
                return;
            }

            this.log(`✅ Gradle task ${installTask} completed`);
        } catch (error) {
            if (wasCancelled) {
                this.log('⚪ Installation cancelled');
                return;
            }

            if (error instanceof GradleCommandError && error.timedOut) {
                vscode.window.showErrorMessage('Android Linter: Gradle install timed out. Consider increasing android-linter.launchInstallTimeoutMs.');
                return;
            }

            if (error instanceof GradleCommandError) {
                this.log(`❌ Gradle install failed: ${error.stderr || error.stdout}`);
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
            this.log(`❌ Failed to launch app: ${message}`);
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

        await this.logcatManager.start(selectedDevice.id, applicationId);
    }

    public async stopLogcat(): Promise<void> {
        await this.logcatManager.stop();
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
        const config = vscode.workspace.getConfiguration('android-linter');
        const fromSettings = (config.get<string>('launchApplicationId') || '').trim();
        if (fromSettings) {
            return fromSettings;
        }

        const moduleName = config.get<string>('launchModule') || 'app';
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
            const remember = config.get<boolean>('launchRememberApplicationId', true);
            if (remember) {
                await config.update('launchApplicationId', provided.trim(), vscode.ConfigurationTarget.Workspace);
            }
            return provided.trim();
        }

        return undefined;
    }

    private log(message: string): void {
        const config = vscode.workspace.getConfiguration('android-linter');
        if (config.get<boolean>('verboseLogging', true)) {
            this.outputChannel.appendLine(message);
        }
    }
}