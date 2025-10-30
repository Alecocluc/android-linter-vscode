import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { LintIssue } from './diagnosticProvider';
import { LintReportParser } from './lintReportParser';

const execAsync = promisify(exec);

export class GradleLintRunner implements vscode.Disposable {
    private parser: LintReportParser;
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel?: vscode.OutputChannel) {
        this.parser = new LintReportParser(outputChannel);
        this.outputChannel = outputChannel || vscode.window.createOutputChannel('Android Linter');
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
        const gradlePath = config.get<string>('gradlePath') || './gradlew';
        const timeout = config.get<number>('lintTimeout') || 60000;

        // Determine the correct gradle wrapper command
        const isWindows = process.platform === 'win32';
        const gradleCmd = isWindows ? 'gradlew.bat' : './gradlew';
        const fullGradlePath = path.join(workspaceRoot, gradleCmd);

        this.log(`🔧 Looking for Gradle wrapper at: ${fullGradlePath}`);

        // Check if gradlew exists
        if (!fs.existsSync(fullGradlePath)) {
            const error = `Gradle wrapper not found at ${fullGradlePath}`;
            this.log(`❌ ${error}`);
            throw new Error(error);
        }

        this.log(`✅ Found Gradle wrapper`);

        // Run lint task with XML report output
        const lintCmd = `"${fullGradlePath}" lint --continue`;
        this.log(`⚙️ Running command: ${lintCmd}`);
        
        try {
            const { stdout, stderr } = await execAsync(lintCmd, {
                cwd: workspaceRoot,
                timeout: timeout,
                maxBuffer: 10 * 1024 * 1024 // 10MB buffer
            });

            if (stdout) {
                this.log(`📤 Gradle output: ${stdout.substring(0, 500)}`);
            }
            if (stderr) {
                this.log(`⚠️ Gradle stderr: ${stderr.substring(0, 500)}`);
            }

            if (cancellationToken?.isCancellationRequested) {
                this.log(`🛑 Lint cancelled`);
                return [];
            }

            // Parse the lint report
            return await this.parseLintResults(workspaceRoot);
        } catch (error: any) {
            // Lint command may exit with non-zero even when successful
            // if it finds issues, so we still try to parse results
            this.log(`⚠️ Gradle command exited with error (this is normal if lint found issues)`);
            this.log(`   Error: ${error.message}`);
            
            // Check if there are compilation errors in the output
            const errorOutput = (error.stdout || '') + '\n' + (error.stderr || '');
            const compilationErrors = this.parseCompilationErrors(errorOutput, workspaceRoot);
            
            if (compilationErrors.length > 0) {
                this.log(`🔴 Found ${compilationErrors.length} compilation errors in lint output`);
                return compilationErrors;
            }
            
            try {
                return await this.parseLintResults(workspaceRoot);
            } catch (parseError) {
                throw new Error(
                    `Lint execution failed: ${error.message || String(error)}`
                );
            }
        }
    }

    private async parseLintResults(workspaceRoot: string): Promise<LintIssue[]> {
        // Look for lint report XML files
        const possibleReportPaths = [
            path.join(workspaceRoot, 'app', 'build', 'reports', 'lint-results.xml'),
            path.join(workspaceRoot, 'build', 'reports', 'lint-results.xml'),
            path.join(workspaceRoot, 'app', 'build', 'reports', 'lint-results-debug.xml'),
        ];

        this.log(`🔍 Looking for lint reports...`);

        // Try to find and parse the first available report
        for (const reportPath of possibleReportPaths) {
            this.log(`   Checking: ${reportPath}`);
            if (fs.existsSync(reportPath)) {
                this.log(`   ✅ Found XML report: ${reportPath}`);
                const xmlContent = fs.readFileSync(reportPath, 'utf-8');
                this.log(`   📄 Report size: ${xmlContent.length} bytes`);
                
                // Log first 500 chars of XML to debug
                this.log(`   📋 XML preview: ${xmlContent.substring(0, 500)}...`);
                
                const parsedIssues = await this.parser.parseXmlReport(xmlContent, workspaceRoot);
                this.log(`   🎯 Parser returned ${parsedIssues.length} issues`);
                
                return parsedIssues;
            }
        }

        // If no XML report found, check for JSON or SARIF
        const jsonReportPath = path.join(workspaceRoot, 'app', 'build', 'reports', 'lint-results.json');
        this.log(`   Checking: ${jsonReportPath}`);
        if (fs.existsSync(jsonReportPath)) {
            this.log(`   ✅ Found JSON report: ${jsonReportPath}`);
            const jsonContent = fs.readFileSync(jsonReportPath, 'utf-8');
            return this.parser.parseJsonReport(jsonContent, workspaceRoot);
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
