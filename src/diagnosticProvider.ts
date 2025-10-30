import * as vscode from 'vscode';

export interface LintIssue {
    file: string;
    line: number;
    column: number;
    severity: 'error' | 'warning' | 'information';
    message: string;
    source: string;
    id: string;
    category: string;
    quickFix?: QuickFix;
}

export interface QuickFix {
    title: string;
    replacement?: string;
    lineToReplace?: number;
}

export class DiagnosticProvider implements vscode.Disposable {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private issueMap: Map<string, LintIssue[]> = new Map();

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('android-linter');
    }

    public addIssues(issues: LintIssue[]): void {
        // Group issues by file
        const issuesByFile = new Map<string, LintIssue[]>();
        
        for (const issue of issues) {
            if (!issuesByFile.has(issue.file)) {
                issuesByFile.set(issue.file, []);
            }
            issuesByFile.get(issue.file)!.push(issue);
        }

        // Convert to diagnostics and add to collection
        issuesByFile.forEach((fileIssues, file) => {
            const uri = vscode.Uri.file(file);
            const diagnostics: vscode.Diagnostic[] = [];

            for (const issue of fileIssues) {
                if (!this.shouldShowSeverity(issue.severity)) {
                    continue;
                }

                const line = Math.max(0, issue.line - 1); // VS Code is 0-indexed
                const column = Math.max(0, issue.column - 1);
                const range = new vscode.Range(
                    line,
                    column,
                    line,
                    column + 1
                );

                const diagnostic = new vscode.Diagnostic(
                    range,
                    issue.message,
                    this.getSeverity(issue.severity)
                );

                diagnostic.source = `Android Lint (${issue.id})`;
                diagnostic.code = issue.id;

                diagnostics.push(diagnostic);
            }

            this.diagnosticCollection.set(uri, diagnostics);
            this.issueMap.set(file, fileIssues);
        });
    }

    public clearFile(file: string): void {
        const uri = vscode.Uri.file(file);
        this.diagnosticCollection.delete(uri);
        this.issueMap.delete(file);
    }

    public clear(): void {
        this.diagnosticCollection.clear();
        this.issueMap.clear();
    }

    public getIssuesForFile(file: string): LintIssue[] {
        return this.issueMap.get(file) || [];
    }

    private getSeverity(severity: string): vscode.DiagnosticSeverity {
        switch (severity.toLowerCase()) {
            case 'error':
            case 'fatal':
                return vscode.DiagnosticSeverity.Error;
            case 'warning':
                return vscode.DiagnosticSeverity.Warning;
            case 'information':
            case 'informational':
                return vscode.DiagnosticSeverity.Information;
            default:
                return vscode.DiagnosticSeverity.Hint;
        }
    }

    private shouldShowSeverity(severity: string): boolean {
        const config = vscode.workspace.getConfiguration('android-linter');
        const showSeverity = config.get<string[]>('showSeverity') || ['Error', 'Warning', 'Information'];
        
        const severityMap: Record<string, string> = {
            'error': 'Error',
            'fatal': 'Error',
            'warning': 'Warning',
            'information': 'Information',
            'informational': 'Information'
        };

        const mappedSeverity = severityMap[severity.toLowerCase()] || 'Information';
        return showSeverity.includes(mappedSeverity);
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
        this.issueMap.clear();
    }
}
