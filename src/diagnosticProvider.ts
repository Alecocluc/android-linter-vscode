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
            const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === file);

            for (const issue of fileIssues) {
                if (!this.shouldShowSeverity(issue.severity)) {
                    continue;
                }

                const line = Math.max(0, issue.line - 1); // VS Code is 0-indexed
                const column = Math.max(0, issue.column - 1);
                let range = new vscode.Range(line, column, line, column + 1);

                if (doc) {
                    const lineText = doc.lineAt(line).text;
                    const wordRange = doc.getWordRangeAtPosition(new vscode.Position(line, column));
                    if (wordRange) {
                        range = wordRange;
                    } else {
                        // Fallback for when no word is at the position, e.g., for a whole line issue
                        range = new vscode.Range(line, 0, line, lineText.length);
                    }
                }

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
        const severityMap: Record<string, vscode.DiagnosticSeverity> = {
            error: vscode.DiagnosticSeverity.Error,
            fatal: vscode.DiagnosticSeverity.Error,
            warning: vscode.DiagnosticSeverity.Warning,
            information: vscode.DiagnosticSeverity.Information,
            informational: vscode.DiagnosticSeverity.Information,
        };
        return severityMap[severity.toLowerCase()] ?? vscode.DiagnosticSeverity.Hint;
    }

    private shouldShowSeverity(severity: string): boolean {
        const config = vscode.workspace.getConfiguration('android-linter');
        const showSeverity = new Set(config.get<string[]>('showSeverity') || ['Error', 'Warning', 'Information']);

        const severityMap: Record<string, string> = {
            error: 'Error',
            fatal: 'Error',
            warning: 'Warning',
            information: 'Information',
            informational: 'Information',
        };

        const mappedSeverity = severityMap[severity.toLowerCase()] || 'Information';
        return showSeverity.has(mappedSeverity);
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
        this.issueMap.clear();
    }
}
