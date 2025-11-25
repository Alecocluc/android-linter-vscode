import * as vscode from 'vscode';
import { GradleProcessManager } from './gradleProcessManager';
import { Logger } from './logger';

export class GradleTaskProvider implements vscode.TreeDataProvider<GradleTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<GradleTreeItem | undefined | null | void> = new vscode.EventEmitter<GradleTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<GradleTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private cachedTasks: Map<string, GradleTask[]> = new Map();
    private isRefreshing = false;
    private logger?: Logger;

    constructor(
        private readonly gradleManager: GradleProcessManager,
        private readonly workspaceRoot: string,
        outputChannel?: vscode.OutputChannel
    ) {
        if (outputChannel) {
            this.logger = Logger.create(outputChannel);
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: GradleTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: GradleTreeItem): Promise<GradleTreeItem[]> {
        if (!element) {
            // Root: Groups
            const tasks = await this.getTasks();
            if (tasks.size === 0) {
                 if (this.isRefreshing) {
                     return [new GradleTreeItem('Loading tasks...', 'status', vscode.TreeItemCollapsibleState.None)];
                 }
                 return [new GradleTreeItem('No tasks found. Click refresh.', 'status', vscode.TreeItemCollapsibleState.None)];
            }
            
            return Array.from(tasks.keys()).map(group => 
                new GradleTreeItem(group, 'group', vscode.TreeItemCollapsibleState.Collapsed)
            );
        } else if (element.type === 'group') {
            // Children: Tasks in group
            const groupTasks = this.cachedTasks.get(element.label as string) || [];
            return groupTasks.map(task => 
                new GradleTreeItem(task.name, 'task', vscode.TreeItemCollapsibleState.None, task.description)
            );
        }

        return [];
    }

    async refreshTasks(): Promise<void> {
        this.isRefreshing = true;
        this.refresh();
        
        try {
            const { stdout } = await this.gradleManager.runCommand(
                this.workspaceRoot,
                ['tasks', '--all', '--console=plain'], 
                { timeout: 60000 } // 1 minute timeout for task listing
            );
            
            this.parseTasks(stdout);
        } catch (error) {
            vscode.window.showErrorMessage('Failed to refresh Gradle tasks');
            this.logger?.error(`Failed to refresh Gradle tasks: ${error}`);
        } finally {
            this.isRefreshing = false;
            this.refresh();
        }
    }

    private async getTasks(): Promise<Map<string, GradleTask[]>> {
        if (this.cachedTasks.size === 0 && !this.isRefreshing) {
            await this.refreshTasks();
        }
        return this.cachedTasks;
    }

    private parseTasks(output: string): void {
        this.cachedTasks.clear();
        
        const lines = output.split(/\r?\n/);
        let currentGroup = 'Other tasks';
        
        // Regex to identify headers like "Build tasks"
        // They are usually followed by "-----------"
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const nextLine = lines[i + 1] || '';
            
            if (line.trim().length === 0) continue;

            if (nextLine.trim().startsWith('------')) {
                currentGroup = line.trim();
                i++; // Skip separator
                continue;
            }

            // Task line: "taskName - Description"
            // or just "taskName"
            const match = line.match(/^(\w+)(?:\s+-\s+(.*))?$/);
            if (match) {
                const name = match[1];
                const desc = match[2] || '';
                
                if (!this.cachedTasks.has(currentGroup)) {
                    this.cachedTasks.set(currentGroup, []);
                }
                this.cachedTasks.get(currentGroup)!.push({ name, description: desc });
            }
        }
    }
}

interface GradleTask {
    name: string;
    description: string;
}

export class GradleTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly type: 'group' | 'task' | 'status',
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly description?: string
    ) {
        super(label, collapsibleState);
        this.contextValue = type;
        
        if (type === 'task') {
            this.tooltip = description || label;
            this.iconPath = new vscode.ThemeIcon('gear');
            this.command = {
                command: 'android-linter.runGradleTask',
                title: 'Run Task',
                arguments: [label]
            };
        } else if (type === 'group') {
            this.iconPath = new vscode.ThemeIcon('folder');
        }
    }
}
