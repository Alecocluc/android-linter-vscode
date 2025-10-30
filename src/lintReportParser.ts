import * as path from 'path';
import { parseStringPromise } from 'xml2js';
import { LintIssue, QuickFix } from './diagnosticProvider';

export class LintReportParser {
    private outputChannel?: any;

    constructor(outputChannel?: any) {
        this.outputChannel = outputChannel;
    }

    private log(message: string) {
        if (this.outputChannel) {
            this.outputChannel.appendLine(`   [Parser] ${message}`);
        }
        console.log(`[Parser] ${message}`);
    }
    public async parseXmlReport(xmlContent: string, workspaceRoot: string): Promise<LintIssue[]> {
        const issues: LintIssue[] = [];

        try {
            this.log(`Starting XML parsing...`);
            const result = await parseStringPromise(xmlContent);
            
            this.log(`Parsed XML result structure: ${Object.keys(result).join(', ')}`);
            
            if (!result.issues) {
                this.log(`No 'issues' property found in result`);
                return issues;
            }

            this.log(`Issues property found. Keys: ${Object.keys(result.issues).join(', ')}`);

            if (!result.issues.issue) {
                this.log(`No 'issue' property found in result.issues`);
                return issues;
            }

            const issueList = Array.isArray(result.issues.issue) 
                ? result.issues.issue 
                : [result.issues.issue];

            this.log(`Processing ${issueList.length} issues from XML`);

            for (let i = 0; i < issueList.length; i++) {
                const issue = issueList[i];
                this.log(`Processing issue ${i + 1}: ID=${issue.$?.id}, Severity=${issue.$?.severity}`);
                
                const locations = issue.location;
                if (!locations || locations.length === 0) {
                    this.log(`Issue ${i + 1} has no location, skipping`);
                    continue;
                }

                const location = Array.isArray(locations) ? locations[0] : locations;
                const attrs = location.$;

                if (!attrs || !attrs.file) {
                    this.log(`Issue ${i + 1} location has no file attribute, skipping`);
                    continue;
                }

                const filePath = path.isAbsolute(attrs.file) 
                    ? attrs.file 
                    : path.join(workspaceRoot, attrs.file);

                const lintIssue: LintIssue = {
                    file: filePath,
                    line: parseInt(attrs.line || '1', 10),
                    column: parseInt(attrs.column || '1', 10),
                    severity: this.mapSeverity(issue.$.severity),
                    message: issue.$.message || 'Unknown issue',
                    source: 'Android Lint',
                    id: issue.$.id || 'UnknownId',
                    category: issue.$.category || 'General',
                    quickFix: this.extractQuickFix(issue)
                };

                this.log(`Created lint issue ${i + 1}: ${lintIssue.id} in ${path.basename(lintIssue.file)}:${lintIssue.line}`);
                issues.push(lintIssue);
            }
        } catch (error) {
            this.log(`Failed to parse XML lint report: ${error}`);
        }

        this.log(`Total issues parsed: ${issues.length}`);
        return issues;
    }

    public parseJsonReport(jsonContent: string, workspaceRoot: string): LintIssue[] {
        const issues: LintIssue[] = [];

        try {
            const report = JSON.parse(jsonContent);
            
            // Handle different JSON report formats
            const issueList = report.issues || report;

            for (const issue of issueList) {
                if (!issue.location || !issue.location.file) {
                    continue;
                }

                const filePath = path.isAbsolute(issue.location.file)
                    ? issue.location.file
                    : path.join(workspaceRoot, issue.location.file);

                const lintIssue: LintIssue = {
                    file: filePath,
                    line: issue.location.line || 1,
                    column: issue.location.column || 1,
                    severity: this.mapSeverity(issue.severity),
                    message: issue.message || 'Unknown issue',
                    source: 'Android Lint',
                    id: issue.id || 'UnknownId',
                    category: issue.category || 'General',
                    quickFix: this.extractQuickFixFromJson(issue)
                };

                issues.push(lintIssue);
            }
        } catch (error) {
            this.log(`Failed to parse JSON lint report: ${error}`);
        }

        return issues;
    }

    private mapSeverity(severity: string): 'error' | 'warning' | 'information' {
        const severityLower = (severity || '').toLowerCase();
        
        switch (severityLower) {
            case 'error':
            case 'fatal':
                return 'error';
            case 'warning':
                return 'warning';
            case 'information':
            case 'informational':
            default:
                return 'information';
        }
    }

    private extractQuickFix(issue: any): QuickFix | undefined {
        // Check if issue has a quick fix suggestion
        if (issue.$ && issue.$.quickfix) {
            return {
                title: 'Apply suggested fix',
                replacement: issue.$.quickfix
            };
        }

        // Common Android Lint quick fixes based on issue ID
        return this.getCommonQuickFix(issue.$.id, issue.$.message);
    }

    private extractQuickFixFromJson(issue: any): QuickFix | undefined {
        if (issue.quickfix) {
            return {
                title: 'Apply suggested fix',
                replacement: issue.quickfix
            };
        }

        return this.getCommonQuickFix(issue.id, issue.message);
    }

    private getCommonQuickFix(issueId: string, message: string): QuickFix | undefined {
        // Define common quick fixes based on lint issue IDs
        const quickFixes: Record<string, QuickFix> = {
            'HardcodedText': {
                title: 'Extract string resource'
            },
            'UnusedResources': {
                title: 'Remove unused resource'
            },
            'ObsoleteLayoutParam': {
                title: 'Remove obsolete layout parameter'
            },
            'UseCompoundDrawables': {
                title: 'Convert to compound drawable'
            },
            'ContentDescription': {
                title: 'Add content description'
            },
            'SetTextI18n': {
                title: 'Use string resource instead'
            },
            'RtlHardcoded': {
                title: 'Use start/end instead of left/right'
            },
            'UnusedImport': {
                title: 'Remove unused import'
            },
            'Deprecated': {
                title: 'Replace with recommended alternative'
            }
        };

        return quickFixes[issueId];
    }
}
