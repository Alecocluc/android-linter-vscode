import * as vscode from 'vscode';
import * as path from 'path';
import { LintIssue } from './diagnosticProvider';
import { GradleLintRunner } from './gradleLintRunner';
import { LintServerClient, getLintServerClient } from './lintServerClient';
import { GradleProcessManager } from './gradleProcessManager';
import { CONFIG_NAMESPACE } from './constants';
import { Logger } from './logger';

/**
 * Modes for lint analysis
 */
export type LintMode = 'auto' | 'server' | 'gradle';

/**
 * Hybrid lint runner that can use either the fast lint server or Gradle-based linting.
 * 
 * The lint server provides near-instant analysis similar to Android Studio,
 * while Gradle-based linting is more accurate but slower.
 */
export class HybridLintRunner implements vscode.Disposable {
    private gradleRunner: GradleLintRunner;
    private serverClient: LintServerClient | null = null;
    private logger: Logger;
    private extensionPath: string;
    private serverInitialized = false;
    private serverAvailable = false;

    constructor(
        extensionPath: string,
        gradleManager: GradleProcessManager,
        outputChannel?: vscode.OutputChannel
    ) {
        this.extensionPath = extensionPath;
        const channel = outputChannel || vscode.window.createOutputChannel('Android Linter');
        this.logger = Logger.create(channel, 'HybridLint');
        this.gradleRunner = new GradleLintRunner(gradleManager, channel);
        
        // Check if lint server is available
        this.initializeLintServer(channel);
    }

    private async initializeLintServer(outputChannel: vscode.OutputChannel) {
        this.serverClient = getLintServerClient(this.extensionPath, outputChannel);
        this.serverAvailable = this.serverClient.isAvailable();
        
        if (this.serverAvailable) {
            this.logger.success('Lint server JAR found - fast mode available');
        } else {
            this.logger.log('Lint server not available - using Gradle fallback');
            this.logger.log('To enable fast mode, build the lint server:');
            this.logger.log('  cd lint-server && ./gradlew shadowJar');
        }
    }

    /**
     * Get the current lint mode setting
     */
    private getLintMode(): LintMode {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        return config.get<LintMode>('lintMode') || 'auto';
    }

    /**
     * Check if we should use the lint server
     */
    private shouldUseLintServer(): boolean {
        const mode = this.getLintMode();
        
        if (mode === 'gradle') {
            return false;
        }
        
        if (mode === 'server') {
            return this.serverAvailable;
        }
        
        // Auto mode: prefer server if available
        return this.serverAvailable;
    }

    /**
     * Initialize the lint server for a project
     */
    public async initializeForProject(workspaceRoot: string): Promise<boolean> {
        if (!this.shouldUseLintServer() || !this.serverClient) {
            return false;
        }

        if (this.serverInitialized) {
            return true;
        }

        this.logger.log(`Initializing lint server for: ${workspaceRoot}`);
        
        try {
            const success = await this.serverClient.initialize(workspaceRoot);
            this.serverInitialized = success;
            
            if (success) {
                this.logger.success('Lint server initialized - fast analysis enabled');
                vscode.window.showInformationMessage('Android Lint: Fast mode enabled!');
            } else {
                this.logger.warn('Lint server initialization failed, falling back to Gradle');
            }
            
            return success;
        } catch (error) {
            this.logger.error(`Lint server init error: ${error}`);
            return false;
        }
    }

    /**
     * Lint a single file using the best available method
     */
    public async lintFile(
        workspaceRoot: string,
        filePath: string,
        fileContent?: string,
        cancellationToken?: vscode.CancellationToken
    ): Promise<LintIssue[]> {
        const startTime = Date.now();
        
        // Try lint server first
        if (this.shouldUseLintServer() && this.serverClient) {
            if (!this.serverInitialized) {
                await this.initializeForProject(workspaceRoot);
            }

            if (this.serverInitialized) {
                try {
                    this.logger.log(`⚡ Fast analyzing: ${path.basename(filePath)}`);
                    const issues = await this.serverClient.analyzeFile(filePath, fileContent);
                    const elapsed = Date.now() - startTime;
                    this.logger.success(`⚡ Fast analysis complete: ${issues.length} issues in ${elapsed}ms`);
                    return issues;
                } catch (error) {
                    this.logger.warn(`Lint server analysis failed, falling back to Gradle: ${error}`);
                }
            }
        }

        // Fall back to Gradle
        this.logger.log(`🐢 Using Gradle lint (slower)`);
        // Gradle lint always reads from disk, so we can't support dirty content there easily
        return this.gradleRunner.lintFile(workspaceRoot, filePath);
    }

    /**
     * Lint the entire project
     */
    public async lintProject(
        workspaceRoot: string,
        cancellationToken?: vscode.CancellationToken
    ): Promise<LintIssue[]> {
        const startTime = Date.now();
        
        // Try lint server first
        if (this.shouldUseLintServer() && this.serverClient) {
            if (!this.serverInitialized) {
                await this.initializeForProject(workspaceRoot);
            }

            if (this.serverInitialized) {
                try {
                    this.logger.log(`⚡ Fast analyzing project`);
                    const issues = await this.serverClient.analyzeProject();
                    const elapsed = Date.now() - startTime;
                    this.logger.success(`⚡ Fast project analysis: ${issues.length} issues in ${elapsed}ms`);
                    return issues;
                } catch (error) {
                    this.logger.warn(`Lint server project analysis failed, falling back to Gradle: ${error}`);
                }
            }
        }

        // Fall back to Gradle
        this.logger.log(`🐢 Using Gradle project lint (slower)`);
        return this.gradleRunner.lintProject(workspaceRoot, cancellationToken);
    }

    /**
     * Force refresh - clear cache and re-initialize
     */
    public async forceRefresh(workspaceRoot: string): Promise<void> {
        if (this.serverClient) {
            await this.serverClient.clearCache();
            this.serverInitialized = false;
            await this.initializeForProject(workspaceRoot);
        }
    }

    /**
     * Check if fast mode (lint server) is active
     */
    public isFastModeActive(): boolean {
        return this.serverInitialized && this.serverAvailable;
    }

    /**
     * Get status information about the lint runner
     */
    public getStatus(): {
        mode: LintMode;
        serverAvailable: boolean;
        serverInitialized: boolean;
        fastModeActive: boolean;
    } {
        return {
            mode: this.getLintMode(),
            serverAvailable: this.serverAvailable,
            serverInitialized: this.serverInitialized,
            fastModeActive: this.isFastModeActive()
        };
    }

    public dispose(): void {
        this.gradleRunner.dispose();
        // Don't dispose the server client here - it's a singleton
    }
}
