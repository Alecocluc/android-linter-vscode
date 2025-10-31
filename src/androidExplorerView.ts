import * as vscode from 'vscode';
import { AndroidDevice, AndroidDeviceManager } from './androidDeviceManager';
import { LogcatManager } from './logcatManager';
import { GradleProcessManager } from './gradleProcessManager';

type TreeItemType = 
    | 'devices-header'
    | 'device'
    | 'no-devices'
    | 'actions-header'
    | 'action'
    | 'status-header'
    | 'status-item'
    | 'refresh';

export class AndroidExplorerView implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private devices: AndroidDevice[] = [];
    private selectedDevice?: AndroidDevice;
    private isLogcatRunning: boolean = false;
    private isGradleRunning: boolean = false;
    private currentAppId?: string;

    constructor(
        private readonly deviceManager: AndroidDeviceManager,
        private readonly logcatManager: LogcatManager,
        private readonly gradleManager: GradleProcessManager,
        private readonly context: vscode.ExtensionContext
    ) {
        // Restore selected device from state
        const savedDeviceId = context.workspaceState.get<string>('selectedDeviceId');
        if (savedDeviceId) {
            this.refreshDevices().then(() => {
                const device = this.devices.find(d => d.id === savedDeviceId);
                if (device) {
                    this.selectedDevice = device;
                    this.refresh();
                }
            });
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    async refreshDevices(): Promise<void> {
        this.devices = await this.deviceManager.listDevices();
        this.refresh();
    }

    setSelectedDevice(device: AndroidDevice | undefined): void {
        this.selectedDevice = device;
        if (device) {
            this.context.workspaceState.update('selectedDeviceId', device.id);
        }
        this.refresh();
    }

    setLogcatRunning(running: boolean): void {
        this.isLogcatRunning = running;
        this.refresh();
    }

    setGradleRunning(running: boolean): void {
        this.isGradleRunning = running;
        this.refresh();
    }

    setCurrentAppId(appId: string | undefined): void {
        this.currentAppId = appId;
        this.refresh();
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
        if (!element) {
            // Root level
            return [
                new TreeNode('Devices', 'devices-header', vscode.TreeItemCollapsibleState.Expanded),
                new TreeNode('Actions', 'actions-header', vscode.TreeItemCollapsibleState.Expanded),
                new TreeNode('Status', 'status-header', vscode.TreeItemCollapsibleState.Expanded)
            ];
        }

        switch (element.type) {
            case 'devices-header':
                return this.getDeviceNodes();
            case 'actions-header':
                return this.getActionNodes();
            case 'status-header':
                return this.getStatusNodes();
            default:
                return [];
        }
    }

    private async getDeviceNodes(): Promise<TreeNode[]> {
        const nodes: TreeNode[] = [];

        if (this.devices.length === 0) {
            const noDevices = new TreeNode(
                'No devices connected',
                'no-devices',
                vscode.TreeItemCollapsibleState.None
            );
            noDevices.iconPath = new vscode.ThemeIcon('debug-disconnect');
            noDevices.tooltip = 'Connect a device or start an emulator';
            nodes.push(noDevices);
        } else {
            for (const device of this.devices) {
                const isSelected = this.selectedDevice?.id === device.id;
                const label = device.label + (isSelected ? ' ⭐' : '');
                
                const node = new TreeNode(
                    label,
                    'device',
                    vscode.TreeItemCollapsibleState.None,
                    device
                );

                // Set icon based on device type and state
                if (device.state !== 'device') {
                    node.iconPath = new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.red'));
                    node.tooltip = `${device.label} - ${device.state}`;
                } else if (device.isEmulator) {
                    node.iconPath = new vscode.ThemeIcon(
                        'device-desktop',
                        isSelected ? new vscode.ThemeColor('charts.green') : undefined
                    );
                } else {
                    node.iconPath = new vscode.ThemeIcon(
                        'device-mobile',
                        isSelected ? new vscode.ThemeColor('charts.green') : undefined
                    );
                }

                node.tooltip = isSelected 
                    ? `${device.label} - Selected`
                    : `${device.label} - Click to select`;

                node.contextValue = 'device';
                node.command = {
                    command: 'android-linter.selectDevice',
                    title: 'Select Device',
                    arguments: [device]
                };

                nodes.push(node);
            }
        }

        // Add refresh button
        const refreshNode = new TreeNode(
            'Refresh Devices',
            'refresh',
            vscode.TreeItemCollapsibleState.None
        );
        refreshNode.iconPath = new vscode.ThemeIcon('refresh');
        refreshNode.command = {
            command: 'android-linter.refreshDevices',
            title: 'Refresh'
        };
        nodes.push(refreshNode);

        return nodes;
    }

    private getActionNodes(): Promise<TreeNode[]> {
        const nodes: TreeNode[] = [];

        // Install & Launch
        const launchNode = new TreeNode(
            'Install & Launch App',
            'action',
            vscode.TreeItemCollapsibleState.None
        );
        launchNode.iconPath = new vscode.ThemeIcon('debug-start');
        launchNode.command = {
            command: 'android-linter.launchOnDevice',
            title: 'Launch'
        };
        launchNode.tooltip = 'Install debug build and launch on selected device';
        nodes.push(launchNode);

        // Start/Stop Logcat
        if (this.isLogcatRunning) {
            const stopLogcatNode = new TreeNode(
                'Stop Logcat',
                'action',
                vscode.TreeItemCollapsibleState.None
            );
            stopLogcatNode.iconPath = new vscode.ThemeIcon('debug-stop', new vscode.ThemeColor('charts.red'));
            stopLogcatNode.command = {
                command: 'android-linter.stopLogcat',
                title: 'Stop Logcat'
            };
            nodes.push(stopLogcatNode);
        } else {
            const startLogcatNode = new TreeNode(
                'Start Logcat',
                'action',
                vscode.TreeItemCollapsibleState.None
            );
            startLogcatNode.iconPath = new vscode.ThemeIcon('output');
            startLogcatNode.command = {
                command: 'android-linter.showLogcat',
                title: 'Start Logcat'
            };
            startLogcatNode.tooltip = 'Start streaming logcat from selected device';
            nodes.push(startLogcatNode);
        }

        // Lint Project
        const lintNode = new TreeNode(
            'Lint Entire Project',
            'action',
            vscode.TreeItemCollapsibleState.None
        );
        lintNode.iconPath = new vscode.ThemeIcon('search');
        lintNode.command = {
            command: 'android-linter.lintProject',
            title: 'Lint Project'
        };
        nodes.push(lintNode);

        // Clear Diagnostics
        const clearNode = new TreeNode(
            'Clear Lint Results',
            'action',
            vscode.TreeItemCollapsibleState.None
        );
        clearNode.iconPath = new vscode.ThemeIcon('clear-all');
        clearNode.command = {
            command: 'android-linter.clearDiagnostics',
            title: 'Clear'
        };
        nodes.push(clearNode);

        return Promise.resolve(nodes);
    }

    private getStatusNodes(): Promise<TreeNode[]> {
        const nodes: TreeNode[] = [];

        // Selected Device
        const deviceNode = new TreeNode(
            this.selectedDevice 
                ? `Device: ${this.selectedDevice.label}`
                : 'Device: None selected',
            'status-item',
            vscode.TreeItemCollapsibleState.None
        );
        deviceNode.iconPath = new vscode.ThemeIcon(
            this.selectedDevice ? 'check' : 'circle-slash'
        );
        nodes.push(deviceNode);

        // App ID
        const appNode = new TreeNode(
            this.currentAppId 
                ? `App: ${this.currentAppId}`
                : 'App: Not detected',
            'status-item',
            vscode.TreeItemCollapsibleState.None
        );
        appNode.iconPath = new vscode.ThemeIcon('package');
        nodes.push(appNode);

        // Logcat Status
        const logcatNode = new TreeNode(
            `Logcat: ${this.isLogcatRunning ? 'Running' : 'Stopped'}`,
            'status-item',
            vscode.TreeItemCollapsibleState.None
        );
        logcatNode.iconPath = new vscode.ThemeIcon(
            this.isLogcatRunning ? 'pulse' : 'circle-slash',
            this.isLogcatRunning ? new vscode.ThemeColor('charts.green') : undefined
        );
        nodes.push(logcatNode);

        // Gradle Status
        const gradleNode = new TreeNode(
            `Gradle: ${this.isGradleRunning ? 'Running' : 'Idle'}`,
            'status-item',
            vscode.TreeItemCollapsibleState.None
        );
        gradleNode.iconPath = new vscode.ThemeIcon(
            this.isGradleRunning ? 'loading~spin' : 'circle-slash',
            this.isGradleRunning ? new vscode.ThemeColor('charts.yellow') : undefined
        );
        nodes.push(gradleNode);

        return Promise.resolve(nodes);
    }
}

class TreeNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly type: TreeItemType,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly device?: AndroidDevice
    ) {
        super(label, collapsibleState);
    }
}
