import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DiagnosticProvider, LintIssue } from './diagnosticProvider';
import { GradleLintRunner } from './gradleLintRunner';

export class LintManager implements vscode.Disposable {
    private diagnosticProvider: DiagnosticProvider;
    private gradleLintRunner: GradleLintRunner;
    private runningLints: Map<string, Promise<void>> = new Map();
    private outputChannel: vscode.OutputChannel;

    constructor(diagnosticProvider: DiagnosticProvider, outputChannel?: vscode.OutputChannel) {
        this.diagnosticProvider = diagnosticProvider;
        this.outputChannel = outputChannel || vscode.window.createOutputChannel('Android Linter');
        this.gradleLintRunner = new GradleLintRunner(this.outputChannel);
    }

    private log(message: string): void {
        const config = vscode.workspace.getConfiguration('android-linter');
        if (config.get<boolean>('verboseLogging', true)) {
            this.outputChannel.appendLine(message);
        }
    }

    public async lintFile(document: vscode.TextDocument): Promise<void> {
        const filePath = document.uri.fsPath;

        // Prevent duplicate lint runs for the same file
        if (this.runningLints.has(filePath)) {
            return this.runningLints.get(filePath);
        }

        const lintPromise = this.doLintFile(document);
        this.runningLints.set(filePath, lintPromise);

        try {
            await lintPromise;
        } finally {
            this.runningLints.delete(filePath);
        }
    }

    private async doLintFile(document: vscode.TextDocument): Promise<void> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
            this.log('⚠️ No workspace folder found for file');
            return;
        }

        this.log(`\n🔍 Starting lint for: ${document.fileName}`);
        this.log(`   Workspace: ${workspaceFolder.uri.fsPath}`);

        try {
            // Show progress
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Window,
                    title: `Linting ${path.basename(document.fileName)}...`,
                    cancellable: false
                },
                async () => {
                    const allIssues: LintIssue[] = [];
                    
                    // Run Android Lint (which also catches compilation errors)
                    this.log(`\n📍 Running Android Lint and compilation check...`);
                    const lintIssues = await this.gradleLintRunner.lintFile(
                        workspaceFolder.uri.fsPath,
                        document.uri.fsPath
                    );
                    allIssues.push(...lintIssues);
                    
                    // Count errors vs warnings
                    const errors = lintIssues.filter(i => i.severity === 'error');
                    const warnings = lintIssues.filter(i => i.severity === 'warning');
                    
                    this.log(`\n✅ Analysis completed: ${errors.length} error(s), ${warnings.length} warning(s)`);
                    
                    // Clear and add all issues
                    this.diagnosticProvider.clear();
                    
                    if (allIssues.length > 0) {
                        this.log(`📊 Adding ${allIssues.length} issues to Problems panel...`);
                        this.diagnosticProvider.addIssues(allIssues);
                        this.log(`✅ Issues added to Problems panel`);
                    }
                }
            );
        } catch (error) {
            const errorMsg = `Failed to lint file: ${error instanceof Error ? error.message : String(error)}`;
            this.log(`❌ ${errorMsg}`);
            vscode.window.showErrorMessage(errorMsg);
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
    }
}
