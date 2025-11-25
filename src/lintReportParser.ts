import * as vscode from 'vscode';
import * as path from 'path';
import { createReadStream } from 'fs';
import { ReadStream } from 'fs';
import { createStream, QualifiedTag, SAXStream } from 'sax';
import { LintIssue, QuickFix } from './diagnosticProvider';
import { Logger } from './logger';

export class LintReportParser {
    private logger?: Logger;

    constructor(outputChannel?: vscode.OutputChannel) {
        if (outputChannel) {
            this.logger = Logger.create(outputChannel);
        }
    }

    private log(message: string) {
        this.logger?.log(`[Parser] ${message}`);
    }
    public async parseXmlReport(reportPath: string, workspaceRoot: string): Promise<LintIssue[]> {
        const issues: LintIssue[] = [];
        const seenIssues = new Set<string>();

        this.log(`Starting XML streaming parse: ${reportPath}`);

        return await new Promise<LintIssue[]>((resolve, reject) => {
            let currentIssue: { id: string; severity: string; message: string; category?: string; quickfix?: string } | null = null;
            let locationCaptured = false;
            const parser: SAXStream = createStream(true, { trim: false, normalize: false });
            let stream: ReadStream | undefined;
            let isRejected = false;
            const pushIssue = (locationAttrs: Record<string, string>) => {
                if (!currentIssue || !locationAttrs.file) {
                    return;
                }

                const filePath = path.isAbsolute(locationAttrs.file)
                    ? locationAttrs.file
                    : path.join(workspaceRoot, locationAttrs.file);

                const uniqueKey = `${filePath}:${locationAttrs.line || '1'}:${locationAttrs.column || '1'}:${currentIssue.id}:${currentIssue.message}`;
                if (seenIssues.has(uniqueKey)) {
                    return;
                }
                seenIssues.add(uniqueKey);

                const lintIssue: LintIssue = {
                    file: filePath,
                    line: parseInt(locationAttrs.line || '1', 10),
                    column: parseInt(locationAttrs.column || '1', 10),
                    severity: this.mapSeverity(currentIssue.severity),
                    message: currentIssue.message || 'Unknown issue',
                    source: 'Android Lint',
                    id: currentIssue.id || 'UnknownId',
                    category: currentIssue.category || 'General',
                    quickFix: this.extractQuickFix(currentIssue.id, currentIssue.message, currentIssue.quickfix)
                };

                this.log(`Created lint issue: ${lintIssue.id} in ${path.basename(lintIssue.file)}:${lintIssue.line}`);
                issues.push(lintIssue);
            };

            parser.on('opentag', (node: QualifiedTag) => {
                if (node.name === 'issue') {
                    const attrs = node.attributes as Record<string, string>;
                    currentIssue = {
                        id: attrs.id || 'UnknownId',
                        severity: attrs.severity || 'information',
                        message: attrs.message || 'Unknown issue',
                        category: attrs.category,
                        quickfix: attrs.quickfix
                    };
                    locationCaptured = false;
                    return;
                }

                if (node.name === 'location' && currentIssue && !locationCaptured) {
                    const attrs = node.attributes as Record<string, string>;
                    pushIssue(attrs);
                    locationCaptured = true;
                }
            });

            parser.on('closetag', (tagName: string) => {
                if (tagName === 'issue') {
                    currentIssue = null;
                    locationCaptured = false;
                }
            });

            parser.on('error', (error: Error) => {
                this.log(`Failed to parse XML lint report: ${error}`);
                if (!isRejected) {
                    isRejected = true;
                    parser.removeAllListeners?.();
                    stream?.destroy(error);
                    reject(error);
                }
            });

            parser.on('end', () => {
                this.log(`Total issues parsed: ${issues.length}`);
                if (!isRejected) {
                    resolve(issues);
                }
            });

            stream = createReadStream(reportPath, { encoding: 'utf8' });
            stream.on('error', (error) => {
                this.log(`Failed to read lint report: ${error}`);
                if (!isRejected) {
                    isRejected = true;
                    reject(error);
                }
            });

            stream.pipe(parser);
        });
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
                    quickFix: this.extractQuickFix(issue.id, issue.message, issue.quickfix)
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

    private extractQuickFix(issueId: string, message: string, quickFixReplacement?: string): QuickFix | undefined {
        if (quickFixReplacement) {
            return {
                title: 'Apply suggested fix',
                replacement: quickFixReplacement
            };
        }

        return this.getCommonQuickFix(issueId, message);
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
