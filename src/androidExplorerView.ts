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
                'No devices found',
                'no-devices',
                vscode.TreeItemCollapsibleState.None
            );
            noDevices.iconPath = new vscode.ThemeIcon('debug-disconnect', new vscode.ThemeColor('disabledForeground'));
            noDevices.tooltip = 'Connect an Android device or start an emulator';
            noDevices.description = 'Connect a device';
            nodes.push(noDevices);
        } else {
            for (const device of this.devices) {
                const isSelected = this.selectedDevice?.id === device.id;
                const label = device.label;
                
                const node = new TreeNode(
                    label,
                    'device',
                    vscode.TreeItemCollapsibleState.None,
                    device
                );

                // Set icon based on device type and state
                if (device.state !== 'device') {
                    node.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
                    node.tooltip = `⚠️ ${device.label}\nState: ${device.state}\nClick to try selecting anyway`;
                    node.description = device.state;
                } else if (device.isEmulator) {
                    node.iconPath = new vscode.ThemeIcon(
                        'vm',
                        isSelected ? new vscode.ThemeColor('testing.iconPassed') : new vscode.ThemeColor('symbolIcon.classForeground')
                    );
                    node.description = isSelected ? '✓ Active' : 'Emulator';
                } else {
                    node.iconPath = new vscode.ThemeIcon(
                        'device-mobile',
                        isSelected ? new vscode.ThemeColor('testing.iconPassed') : new vscode.ThemeColor('symbolIcon.variableForeground')
                    );
                    node.description = isSelected ? '✓ Active' : 'Physical';
                }

                node.tooltip = isSelected 
                    ? `✓ ${device.label} (Active)\n${device.isEmulator ? 'Emulator' : 'Physical Device'}\nCurrently selected for debugging`
                    : `${device.label}\n${device.isEmulator ? 'Emulator' : 'Physical Device'}\nClick to select this device`;

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
            'Refresh Device List',
            'refresh',
            vscode.TreeItemCollapsibleState.None
        );
        refreshNode.iconPath = new vscode.ThemeIcon('sync', new vscode.ThemeColor('symbolIcon.variableForeground'));
        refreshNode.tooltip = 'Scan for connected Android devices and emulators';
        refreshNode.description = `${this.devices.length} found`;
        refreshNode.command = {
            command: 'android-linter.refreshDevices',
            title: 'Refresh'
        };
        nodes.push(refreshNode);

        return nodes;
    }

    private getActionNodes(): Promise<TreeNode[]> {
        const nodes: TreeNode[] = [];

        // Primary Actions
        const runNode = new TreeNode('Run App', 'action', vscode.TreeItemCollapsibleState.None);
        runNode.iconPath = new vscode.ThemeIcon('play', new vscode.ThemeColor('testing.iconPassed'));
        runNode.command = {
            command: 'android-linter.launchOnDevice',
            title: 'Run App'
        };
        runNode.tooltip = 'Build & Run (Install Debug)';
        nodes.push(runNode);

        const stopNode = new TreeNode('Stop App', 'action', vscode.TreeItemCollapsibleState.None);
        stopNode.iconPath = new vscode.ThemeIcon('stop-circle', new vscode.ThemeColor('problemsErrorIcon.foreground'));
        stopNode.command = {
            command: 'android-linter.stopApp',
            title: 'Stop App'
        };
        stopNode.tooltip = 'Force Stop Application';
        nodes.push(stopNode);

        // Logcat Toggle
        if (this.isLogcatRunning) {
            const stopLogcatNode = new TreeNode(
                'Stop Logcat',
                'action',
                vscode.TreeItemCollapsibleState.None
            );
            stopLogcatNode.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.red'));
            stopLogcatNode.description = 'Recording';
            stopLogcatNode.command = {
                command: 'android-linter.stopLogcat',
                title: 'Stop Logcat'
            };
            nodes.push(stopLogcatNode);
        } else {
            const startLogcatNode = new TreeNode(
                'Open Logcat',
                'action',
                vscode.TreeItemCollapsibleState.None
            );
            startLogcatNode.iconPath = new vscode.ThemeIcon('output');
            startLogcatNode.command = {
                command: 'android-linter.showLogcat',
                title: 'Start Logcat'
            };
            nodes.push(startLogcatNode);
        }

        // Wireless Debugging Sub-section (using visual separator logic or just appending)
        // Since TreeView doesn't support true separators, we just list them.
        
        const connectWifiNode = new TreeNode('Connect via Wi-Fi', 'action', vscode.TreeItemCollapsibleState.None);
        connectWifiNode.iconPath = new vscode.ThemeIcon('rss');
        connectWifiNode.description = 'IP:Port';
        connectWifiNode.command = {
            command: 'android-linter.adbConnect',
            title: 'Connect via Wi-Fi'
        };
        nodes.push(connectWifiNode);

        const pairWifiNode = new TreeNode('Pair via Wi-Fi', 'action', vscode.TreeItemCollapsibleState.None);
        pairWifiNode.iconPath = new vscode.ThemeIcon('link');
        pairWifiNode.description = 'Pairing Code';
        pairWifiNode.command = {
            command: 'android-linter.adbPair',
            title: 'Pair via Wi-Fi'
        };
        nodes.push(pairWifiNode);

        // Secondary / Maintenance Actions
        const cleanNode = new TreeNode('Clear Lint Results', 'action', vscode.TreeItemCollapsibleState.None);
        cleanNode.iconPath = new vscode.ThemeIcon('clear-all');
        cleanNode.command = {
            command: 'android-linter.clearDiagnostics',
            title: 'Clear'
        };
        nodes.push(cleanNode);

        return Promise.resolve(nodes);
    }

    private getStatusNodes(): Promise<TreeNode[]> {
        const nodes: TreeNode[] = [];

        // Selected Device
        const deviceNode = new TreeNode(
            'Selected Device',
            'status-item',
            vscode.TreeItemCollapsibleState.None
        );
        if (this.selectedDevice) {
            deviceNode.iconPath = new vscode.ThemeIcon('check-all', new vscode.ThemeColor('testing.iconPassed'));
            deviceNode.description = this.selectedDevice.label;
            deviceNode.tooltip = `✓ Active device: ${this.selectedDevice.label}\n${this.selectedDevice.isEmulator ? 'Android Emulator' : 'Physical Device'}`;
        } else {
            deviceNode.iconPath = new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('problemsWarningIcon.foreground'));
            deviceNode.description = 'None';
            deviceNode.tooltip = '⚠️ No device selected\nSelect a device from the list above';
        }
        nodes.push(deviceNode);

        // App ID
        const appNode = new TreeNode(
            'Application ID',
            'status-item',
            vscode.TreeItemCollapsibleState.None
        );
        if (this.currentAppId) {
            appNode.iconPath = new vscode.ThemeIcon('package', new vscode.ThemeColor('symbolIcon.packageForeground'));
            appNode.description = this.currentAppId;
            appNode.tooltip = `📦 Current app package:\n${this.currentAppId}`;
        } else {
            appNode.iconPath = new vscode.ThemeIcon('question', new vscode.ThemeColor('disabledForeground'));
            appNode.description = 'Not detected';
            appNode.tooltip = 'ℹ️ Application ID not detected\nBuild the project to detect package name';
        }
        nodes.push(appNode);

        // Logcat Status
        const logcatNode = new TreeNode(
            'Logcat Stream',
            'status-item',
            vscode.TreeItemCollapsibleState.None
        );
        if (this.isLogcatRunning) {
            logcatNode.iconPath = new vscode.ThemeIcon('radio-tower', new vscode.ThemeColor('testing.iconPassed'));
            logcatNode.description = '● Active';
            logcatNode.tooltip = '📡 Logcat is actively streaming device logs\nClick "Stop Logcat" to stop capture';
        } else {
            logcatNode.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('disabledForeground'));
            logcatNode.description = 'Inactive';
            logcatNode.tooltip = '⭕ Logcat is not running\nClick "Start Logcat" to begin capturing logs';
        }
        nodes.push(logcatNode);

        // Gradle Status
        const gradleNode = new TreeNode(
            'Gradle Build',
            'status-item',
            vscode.TreeItemCollapsibleState.None
        );
        if (this.isGradleRunning) {
            gradleNode.iconPath = new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.yellow'));
            gradleNode.description = '⚙️ Building...';
            gradleNode.tooltip = '⚙️ Gradle build in progress\nThis may take a few moments';
        } else {
            gradleNode.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('symbolIcon.constructorForeground'));
            gradleNode.description = 'Ready';
            gradleNode.tooltip = '✓ Gradle is ready\nNo builds currently running';
        }
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
