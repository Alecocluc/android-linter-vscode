import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LintIssue } from './diagnosticProvider';
import { LintReportParser } from './lintReportParser';
import { GradleCommandError, GradleProcessManager } from './gradleProcessManager';

export class GradleLintRunner implements vscode.Disposable {
    private parser: LintReportParser;
    private outputChannel: vscode.OutputChannel;
    private gradleManager: GradleProcessManager;

    constructor(gradleManager: GradleProcessManager, outputChannel?: vscode.OutputChannel) {
        this.parser = new LintReportParser(outputChannel);
        this.outputChannel = outputChannel || vscode.window.createOutputChannel('Android Linter');
        this.gradleManager = gradleManager;
    }

    private log(message: string): void {
        const config = vscode.workspace.getConfiguration('android-linter');
        if (config.get<boolean>('verboseLogging', true)) {
            this.outputChannel.appendLine(message);
        }
    }

    public async lintFile(workspaceRoot: string, filePath: string): Promise<LintIssue[]> {
        // For file-specific linting, we'll run a full lint and return ALL results
        // Android Gradle doesn't support per-file linting out of the box
        // So we run full project lint and show all issues
        const allIssues = await this.runGradleLint(workspaceRoot);
        
        this.log(`   📊 Found ${allIssues.length} total issues in project`);
        this.log(`   🎯 Returning all issues (not just for ${filePath})`);
        
        // Return ALL issues, not just for this file
        // This matches Android Studio behavior where opening any file shows all project issues
        return allIssues;
    }

    public async lintProject(
        workspaceRoot: string,
        cancellationToken?: vscode.CancellationToken
    ): Promise<LintIssue[]> {
        return this.runGradleLint(workspaceRoot, cancellationToken);
    }

    private async runGradleLint(
        workspaceRoot: string,
        cancellationToken?: vscode.CancellationToken
    ): Promise<LintIssue[]> {
        const config = vscode.workspace.getConfiguration('android-linter');
        const timeout = config.get<number>('lintTimeout') || 600000;
        const lintScope = config.get<string>('lintScope') || 'module';
        const lintModule = config.get<string>('lintModule') || 'app';

        // Optimization settings
        const lintTaskName = config.get<string>('lintTask') || 'lintDebug';
        const useOffline = config.get<boolean>('lintOffline', false);
        const fastMode = config.get<boolean>('lintFastMode', true);

        // Determine the full lint task
        let lintTask: string;
        if (lintScope === 'project') {
            lintTask = lintTaskName;
            this.log(`🔧 Starting Gradle lint task: ${lintTask} (full project)`);
        } else {
            lintTask = `:${lintModule}:${lintTaskName}`;
            this.log(`🔧 Starting Gradle lint task: ${lintTask} (module: ${lintModule})`);
        }

        const args = [lintTask];

        // Add optimization flags
        if (useOffline) {
            args.push('--offline');
        }

        if (fastMode) {
            // these properties speed up lint significantly by skipping downstream dependency checks
            args.push('-Pandroid.lintOptions.checkDependencies=false');
        }

        // Always continue on error so we get the report
        args.push('--continue');

        try {
            const result = await this.gradleManager.runCommand(
                workspaceRoot,
                args,
                {
                    timeout,
                    cancellationToken
                }
            );

            if (result.stdout) {
                this.log(`📤 Gradle output: ${result.stdout.substring(0, 500)}`);
            }
            if (result.stderr) {
                this.log(`⚠️ Gradle stderr: ${result.stderr.substring(0, 500)}`);
            }

            if (cancellationToken?.isCancellationRequested) {
                this.log('🛑 Lint cancelled');
                return [];
            }

            return await this.parseLintResults(workspaceRoot, lintTaskName);
        } catch (error: any) {
            // Lint command may exit with non-zero even when successful
            // if it finds issues, so we still try to parse results
            this.log(`⚠️ Gradle command exited with error (this is normal if lint found issues)`);
            this.log(`   Error: ${error.message}`);
            
            // Check if there are compilation errors in the output
            const stdout = error instanceof GradleCommandError ? error.stdout : error.stdout || '';
            const stderr = error instanceof GradleCommandError ? error.stderr : error.stderr || '';
            const errorOutput = `${stdout}\n${stderr}`;
            
            // Check for common Gradle setup errors
            if (errorOutput.includes('SDK location not found') || errorOutput.includes('ANDROID_HOME')) {
                const errorMsg = 'Android SDK not found. Please set ANDROID_HOME or configure local.properties';
                this.log(`❌ ${errorMsg}`);
                vscode.window.showErrorMessage(`Android Linter: ${errorMsg}`);
                throw new Error(errorMsg);
            }
            
            if (errorOutput.includes('Failed to install the following SDK components')) {
                const sdkMatch = errorOutput.match(/platforms;android-(\d+)/);
                const version = sdkMatch ? sdkMatch[1] : 'unknown';
                const errorMsg = `Missing Android SDK Platform ${version}. Install it using Android Studio SDK Manager.`;
                this.log(`❌ ${errorMsg}`);
                vscode.window.showErrorMessage(`Android Linter: ${errorMsg}`);
                throw new Error(errorMsg);
            }
            
            if (errorOutput.includes('Could not resolve') || errorOutput.includes('Could not download')) {
                const errorMsg = 'Gradle dependency resolution failed. Check your internet connection and gradle configuration.';
                this.log(`❌ ${errorMsg}`);
                vscode.window.showErrorMessage(`Android Linter: ${errorMsg}`);
                throw new Error(errorMsg);
            }
            
            const compilationIssues = this.parseCompilationErrors(errorOutput, workspaceRoot);
            const compilationErrors = compilationIssues.filter(issue => issue.severity === 'error');
            const compilationWarnings = compilationIssues.filter(issue => issue.severity === 'warning');
            
            if (compilationErrors.length > 0) {
                this.log(`🔴 Found ${compilationErrors.length} compilation errors in lint output`);
                // Return only compilation errors, don't try to parse lint report
                // because the build failed before lint could complete
                return compilationErrors;
            }
            
            try {
                const results = await this.parseLintResults(workspaceRoot, lintTaskName);
                
                // If we found compilation warnings, merge them with lint results
                if (compilationWarnings.length > 0) {
                    this.log(`🔴 Found ${compilationWarnings.length} compilation warnings in lint output`);
                    return [...compilationWarnings, ...results];
                }
                
                return results;
                
                // If no results found but gradle failed, it's an actual error
                const exitCode = error instanceof GradleCommandError ? error.exitCode : error.code;
                if (results.length === 0 && exitCode !== 0) {
                    const errorMsg = 'Gradle lint failed without generating reports. Check the Output panel for details.';
                    this.log(`❌ ${errorMsg}`);
                    this.log(`   Full error: ${errorOutput.substring(0, 1000)}`);
                    vscode.window.showErrorMessage(`Android Linter: ${errorMsg}`);
                    throw new Error(errorMsg);
                }
                
                return results;
            } catch (parseError: any) {
                const errorMsg = `Lint execution failed: ${error.message || String(error)}`;
                vscode.window.showErrorMessage(`Android Linter: ${errorMsg}`);
                throw new Error(errorMsg);
            }
        }
    }

    private async parseLintResults(workspaceRoot: string, lintTaskName?: string): Promise<LintIssue[]> {
        const config = vscode.workspace.getConfiguration('android-linter');
        const lintModule = config.get<string>('lintModule') || 'app';

        // Try to derive report name from task name
        // e.g. lintDebug -> lint-results-debug.xml
        let derivedReportName = 'lint-results.xml';
        if (lintTaskName && lintTaskName.toLowerCase().startsWith('lint')) {
            const variant = lintTaskName.substring(4).toLowerCase();
            if (variant) {
                derivedReportName = `lint-results-${variant}.xml`;
            }
        }

        // Look for lint report XML files
        const possibleReportPaths = [
            // Prioritize the specific variant report
            path.join(workspaceRoot, lintModule, 'build', 'reports', derivedReportName),
            path.join(workspaceRoot, 'app', 'build', 'reports', derivedReportName),
            path.join(workspaceRoot, 'build', 'reports', derivedReportName),

            // Fallbacks
            path.join(workspaceRoot, lintModule, 'build', 'reports', 'lint-results.xml'),
            path.join(workspaceRoot, lintModule, 'build', 'reports', 'lint-results-debug.xml'),
            path.join(workspaceRoot, 'app', 'build', 'reports', 'lint-results.xml'),
            path.join(workspaceRoot, 'build', 'reports', 'lint-results.xml'),
            path.join(workspaceRoot, 'app', 'build', 'reports', 'lint-results-debug.xml'),
        ];

        this.log(`🔍 Looking for lint reports (expecting: ${derivedReportName})...`);

        // Try to find and parse the first available report
        for (const reportPath of possibleReportPaths) {
            // this.log(`   Checking: ${reportPath}`); // Too verbose
            if (fs.existsSync(reportPath)) {
                this.log(`   ✅ Found XML report: ${reportPath}`);
                const stats = fs.statSync(reportPath);
                this.log(`   📄 Report size: ${stats.size} bytes`);

                const parsedIssues = await this.parser.parseXmlReport(reportPath, workspaceRoot);
                this.log(`   🎯 Parser returned ${parsedIssues.length} issues`);
                
                return parsedIssues;
            }
        }

        // If no XML report found, check for JSON or SARIF
        const possibleJsonPaths = [
            path.join(workspaceRoot, lintModule, 'build', 'reports', 'lint-results.json'),
            path.join(workspaceRoot, 'app', 'build', 'reports', 'lint-results.json'),
        ];

        for (const jsonReportPath of possibleJsonPaths) {
            this.log(`   Checking: ${jsonReportPath}`);
            if (fs.existsSync(jsonReportPath)) {
                this.log(`   ✅ Found JSON report: ${jsonReportPath}`);
                const jsonContent = fs.readFileSync(jsonReportPath, 'utf-8');
                return this.parser.parseJsonReport(jsonContent, workspaceRoot);
            }
        }

        // No reports found
        this.log(`   ❌ No lint reports found`);
        return [];
    }

    private parseCompilationErrors(output: string, workspaceRoot: string): LintIssue[] {
        const issues: LintIssue[] = [];
        
        // Kotlin error format:
        // e: file:///C:/path/to/file.kt:257:13 Error message here.
        // w: file:///C:/path/to/file.kt:100:5 Warning message here.
        
        const errorPattern = /^([ew]):\s+file:\/\/\/(.+?):(\d+):(\d+)\s+(.+)$/gm;
        
        let match;
        while ((match = errorPattern.exec(output)) !== null) {
            const [, severity, filePath, line, column, message] = match;
            
            // Convert file:/// URL to local path
            const localPath = filePath.replace(/\//g, path.sep);
            
            const issue: LintIssue = {
                file: localPath,
                line: parseInt(line, 10),
                column: parseInt(column, 10),
                severity: severity === 'e' ? 'error' : 'warning',
                message: message.trim(),
                source: 'Kotlin Compiler',
                id: 'KotlinCompilationError',
                category: 'Compilation'
            };
            
            issues.push(issue);
            this.log(`   🔴 ${severity === 'e' ? 'Error' : 'Warning'}: ${path.basename(localPath)}:${line} - ${message.substring(0, 80)}`);
        }
        
        return issues;
    }

    public dispose(): void {
        // Cleanup if needed
    }
}
