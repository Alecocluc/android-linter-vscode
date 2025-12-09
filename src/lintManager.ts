import * as vscode from 'vscode';
import * as path from 'path';
import { DiagnosticProvider, LintIssue } from './diagnosticProvider';
import { HybridLintRunner } from './hybridLintRunner';
import { GradleProcessManager } from './gradleProcessManager';
import { CONFIG_NAMESPACE, CONFIG_KEYS, OUTPUT_CHANNELS } from './constants';
import { Logger } from './logger';

export class LintManager implements vscode.Disposable {
    private diagnosticProvider: DiagnosticProvider;
    private lintRunner: HybridLintRunner;
    private logger: Logger;
    private pendingLints: Map<string, { document: vscode.TextDocument; requestId: number }> = new Map();
    private queuePromise: Promise<void> | undefined;
    private isDisposed = false;
    private latestRequestId = 0;
    private extensionPath: string;

    constructor(
        diagnosticProvider: DiagnosticProvider,
        gradleManager: GradleProcessManager,
        extensionPath: string,
        outputChannel?: vscode.OutputChannel
    ) {
        this.diagnosticProvider = diagnosticProvider;
        this.extensionPath = extensionPath;
        const channel = outputChannel || vscode.window.createOutputChannel(OUTPUT_CHANNELS.MAIN);
        this.logger = Logger.create(channel, 'LintManager');
        this.lintRunner = new HybridLintRunner(extensionPath, gradleManager, channel);
    }

    /**
     * Initialize the lint server for the current workspace
     */
    public async initializeLintServer(): Promise<boolean> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return false;
        }

        const workspaceFolder = workspaceFolders[0];
        return this.lintRunner.initializeForProject(workspaceFolder.uri.fsPath);
    }

    /**
     * Check if fast mode (lint server) is active
     */
    public isFastModeActive(): boolean {
        return this.lintRunner.isFastModeActive();
    }

    /**
     * Get the current lint runner status
     */
    public getLintStatus(): {
        mode: string;
        serverAvailable: boolean;
        serverInitialized: boolean;
        fastModeActive: boolean;
    } {
        return this.lintRunner.getStatus();
    }

    /**
     * Force refresh the lint server cache
     */
    public async forceRefresh(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        await this.lintRunner.forceRefresh(workspaceFolders[0].uri.fsPath);
    }

    public async lintFile(document: vscode.TextDocument): Promise<void> {
        if (this.isDisposed) {
            return;
        }

        const filePath = document.uri.fsPath;
        const requestId = ++this.latestRequestId;

        // Keep only the most recent request so users get fresh diagnostics quickly
        this.pendingLints.clear();
        this.pendingLints.set(filePath, { document, requestId });

        if (!this.queuePromise) {
            this.queuePromise = this.processQueue();
        }

        await this.queuePromise;
    }

    private async processQueue(): Promise<void> {
        while (this.pendingLints.size > 0) {
            const iterator = this.pendingLints.entries().next();
            if (iterator.done) {
                break;
            }

            const [filePath, pending] = iterator.value;
            this.pendingLints.delete(filePath);

            try {
                await this.doLintFile(pending.document, pending.requestId);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                this.logger.error(`Lint failed for ${filePath}: ${errorMsg}`);
            }
        }

        this.queuePromise = undefined;
    }

    private async doLintFile(document: vscode.TextDocument, requestId: number): Promise<void> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
            this.logger.warn('No workspace folder found for file');
            return;
        }

        this.logger.debug(`Starting lint for: ${document.fileName}`);
        this.logger.log(`   Workspace: ${workspaceFolder.uri.fsPath}`);

        let issues: LintIssue[] = [];
        let errorCount = 0;
        let warningCount = 0;

        try {
            // Show progress
            const progressTitle = this.lintRunner.isFastModeActive() 
                ? `⚡ Analyzing ${path.basename(document.fileName)}...`
                : `Linting ${path.basename(document.fileName)}...`;
            
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Window,
                    title: progressTitle,
                    cancellable: false
                },
                async () => {
                    // Run Android Lint using hybrid runner (server or Gradle)
                    this.logger.log(`Running Android Lint analysis...`);
                    issues = await this.lintRunner.lintFile(
                        workspaceFolder.uri.fsPath,
                        document.uri.fsPath,
                        document.getText()
                    );
                    
                    // Count errors vs warnings
                    errorCount = issues.filter(i => i.severity === 'error').length;
                    warningCount = issues.filter(i => i.severity === 'warning').length;
                    
                    this.logger.success(`Analysis completed: ${errorCount} error(s), ${warningCount} warning(s)`);
                }
            );

            if (!this.shouldApplyResult(requestId)) {
                this.logger.log('⚪ Lint result discarded because a newer request is pending');
                return;
            }

            // Clear and add all issues
            this.diagnosticProvider.clear();

            if (issues.length > 0) {
                this.logger.log(`📊 Adding ${issues.length} issues to Problems panel...`);
                this.diagnosticProvider.addIssues(issues);
                this.logger.success('Issues added to Problems panel');

                if (errorCount > 0) {
                    vscode.window.showWarningMessage(
                        `Android Lint: Found ${errorCount} error(s)` + (warningCount > 0 ? ` and ${warningCount} warning(s)` : '')
                    );
                } else if (warningCount > 0) {
                    vscode.window.showInformationMessage(
                        `Android Lint: Found ${warningCount} warning(s)`
                    );
                }
            } else {
                vscode.window.showInformationMessage('Android Lint: No issues found! ✓');
            }
        } catch (error) {
            const errorMsg = `Failed to lint file: ${error instanceof Error ? error.message : String(error)}`;
            this.logger.error(errorMsg);
            // Error notification already shown in GradleLintRunner, don't duplicate
        }
    }

    public async lintProject(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage('No workspace folder found');
            return;
        }

        const workspaceFolder = workspaceFolders[0];

        try {
            const progressTitle = this.lintRunner.isFastModeActive()
                ? '⚡ Fast analyzing entire project...'
                : 'Running Android Lint on entire project...';
            
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: progressTitle,
                    cancellable: true
                },
                async (progress, token) => {
                    // Clear existing diagnostics
                    this.diagnosticProvider.clear();

                    // Run full project lint using hybrid runner
                    const issues = await this.lintRunner.lintProject(
                        workspaceFolder.uri.fsPath,
                        token
                    );

                    if (token.isCancellationRequested) {
                        if (this.queuePromise) {
                            await this.queuePromise;
                        }

                        return;
                    }

                    // Update diagnostics
                    if (issues.length > 0) {
                        this.diagnosticProvider.addIssues(issues);
                        vscode.window.showInformationMessage(
                            `Android Lint found ${issues.length} issue(s)`
                        );
                    } else {
                        vscode.window.showInformationMessage('No lint issues found!');
                    }
                }
            );
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to lint project: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    public dispose(): void {
        this.lintRunner.dispose();
        this.pendingLints.clear();
        this.isDisposed = true;
    }

    private shouldApplyResult(requestId: number): boolean {
        return !this.isDisposed && requestId === this.latestRequestId;
    }
}
