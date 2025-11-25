import * as vscode from 'vscode';
import * as path from 'path';
import { DiagnosticProvider, LintIssue } from './diagnosticProvider';
import { GradleLintRunner } from './gradleLintRunner';
import { GradleProcessManager } from './gradleProcessManager';
import { CONFIG_NAMESPACE, CONFIG_KEYS, OUTPUT_CHANNELS } from './constants';
import { Logger } from './logger';

export class LintManager implements vscode.Disposable {
    private diagnosticProvider: DiagnosticProvider;
    private gradleLintRunner: GradleLintRunner;
    private logger: Logger;
    private pendingLints: Map<string, { document: vscode.TextDocument; requestId: number }> = new Map();
    private queuePromise: Promise<void> | undefined;
    private isDisposed = false;
    private latestRequestId = 0;

    constructor(
        diagnosticProvider: DiagnosticProvider,
        gradleManager: GradleProcessManager,
        outputChannel?: vscode.OutputChannel
    ) {
        this.diagnosticProvider = diagnosticProvider;
        const channel = outputChannel || vscode.window.createOutputChannel(OUTPUT_CHANNELS.MAIN);
        this.logger = Logger.create(channel, 'LintManager');
        this.gradleLintRunner = new GradleLintRunner(gradleManager, channel);
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
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Window,
                    title: `Linting ${path.basename(document.fileName)}...`,
                    cancellable: false
                },
                async () => {
                    // Run Android Lint (which also catches compilation errors)
                    this.logger.log(`Running Android Lint and compilation check...`);
                    issues = await this.gradleLintRunner.lintFile(
                        workspaceFolder.uri.fsPath,
                        document.uri.fsPath
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
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Running Android Lint on entire project...',
                    cancellable: true
                },
                async (progress, token) => {
                    // Clear existing diagnostics
                    this.diagnosticProvider.clear();

                    // Run full project lint
                    const issues = await this.gradleLintRunner.lintProject(
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
        this.gradleLintRunner.dispose();
        this.pendingLints.clear();
        this.isDisposed = true;
    }

    private shouldApplyResult(requestId: number): boolean {
        return !this.isDisposed && requestId === this.latestRequestId;
    }
}
