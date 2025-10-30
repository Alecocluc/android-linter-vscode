import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { LintIssue } from './diagnosticProvider';

const execAsync = promisify(exec);

export class KotlinCompiler implements vscode.Disposable {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel?: vscode.OutputChannel) {
        this.outputChannel = outputChannel || vscode.window.createOutputChannel('Android Linter');
    }

    public async compileKotlin(workspaceRoot: string): Promise<LintIssue[]> {
        const issues: LintIssue[] = [];

        try {
            this.outputChannel.appendLine(`🔨 Compiling Kotlin code...`);
            
            const isWindows = process.platform === 'win32';
            const gradleCmd = isWindows ? 'gradlew.bat' : './gradlew';
            const fullGradlePath = path.join(workspaceRoot, gradleCmd);
            
            const compileCmd = `"${fullGradlePath}" compileDebugKotlin --continue`;
            this.outputChannel.appendLine(`⚙️ Running: ${compileCmd}`);

            try {
                const result = await execAsync(compileCmd, {
                    cwd: workspaceRoot,
                    timeout: 120000, // 2 minutes
                    maxBuffer: 10 * 1024 * 1024
                });
                
                // Even on success, check stdout/stderr for warnings
                const output = result.stdout + '\n' + result.stderr;
                const parsedIssues = this.parseKotlinErrors(output, workspaceRoot);
                issues.push(...parsedIssues);
                
                if (parsedIssues.length === 0) {
                    this.outputChannel.appendLine(`✅ Compilation successful - no errors`);
                } else {
                    this.outputChannel.appendLine(`⚠️ Found ${parsedIssues.length} issue(s) during compilation`);
                }
            } catch (error: any) {
                // Compilation errors are in stdout and stderr
                const output = (error.stdout || '') + '\n' + (error.stderr || '') + '\n' + (error.message || '');
                this.outputChannel.appendLine(`📋 Compilation failed, parsing errors...`);
                
                // Parse Kotlin compilation errors
                const parsedIssues = this.parseKotlinErrors(output, workspaceRoot);
                issues.push(...parsedIssues);
                
                this.outputChannel.appendLine(`🔴 Found ${parsedIssues.length} compilation error(s)`);
            }
        } catch (error) {
            this.outputChannel.appendLine(`❌ Compilation failed: ${error}`);
        }

        return issues;
    }

    private parseKotlinErrors(output: string, workspaceRoot: string): LintIssue[] {
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
            this.outputChannel.appendLine(`   🔴 ${severity === 'e' ? 'Error' : 'Warning'}: ${path.basename(localPath)}:${line} - ${message.substring(0, 80)}`);
        }
        
        return issues;
    }

    public dispose(): void {
        // Cleanup if needed
    }
}
