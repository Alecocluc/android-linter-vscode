import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../logger';
import { CONFIG_NAMESPACE } from '../constants';

/**
 * Manages build variants (build types × product flavors).
 * 
 * Provides:
 * - Parse build.gradle for variant definitions
 * - Status bar variant selector
 * - Notify the language server when variant changes
 * - Persist selected variant per workspace
 */
export class VariantManager implements vscode.Disposable {
    private logger: Logger;
    private statusBarItem: vscode.StatusBarItem;
    private currentVariant: string = 'debug';
    private availableVariants: string[] = ['debug', 'release'];
    private context: vscode.ExtensionContext;
    private onVariantChangedCallbacks: Array<(variant: string) => void> = [];

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.logger = Logger.getInstance();
        
        // Create status bar item
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
        this.statusBarItem.command = 'android-linter.selectVariant';
        this.updateStatusBar();
        this.statusBarItem.show();
        
        // Restore persisted variant
        const savedVariant = context.workspaceState.get<string>('selectedBuildVariant');
        if (savedVariant) {
            this.currentVariant = savedVariant;
            this.updateStatusBar();
        }
    }

    /**
     * Initialize by scanning build.gradle for variant definitions.
     */
    async initialize(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;
        
        const rootDir = workspaceFolders[0].uri.fsPath;
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const moduleName = config.get<string>('launchModule', 'app');
        
        const buildFiles = [
            path.join(rootDir, moduleName, 'build.gradle.kts'),
            path.join(rootDir, moduleName, 'build.gradle'),
        ];
        
        for (const buildFile of buildFiles) {
            if (fs.existsSync(buildFile)) {
                const content = fs.readFileSync(buildFile, 'utf8');
                this.parseVariants(content);
                break;
            }
        }
        
        this.updateStatusBar();
        this.logger.success(`Build variants: [${this.availableVariants.join(', ')}] (selected: ${this.currentVariant})`);
    }

    /**
     * Parse build.gradle content for build types and product flavors.
     */
    private parseVariants(content: string): void {
        const buildTypes = new Set<string>(['debug', 'release']);
        const productFlavors: string[] = [];
        
        // Extract build types
        const buildTypesBlock = this.extractBlock(content, 'buildTypes');
        if (buildTypesBlock) {
            // KTS: getByName("name") or create("name")
            const ktsRegex = /(?:getByName|create)\s*\(\s*["'](\w+)["']\s*\)/g;
            let match;
            while ((match = ktsRegex.exec(buildTypesBlock)) !== null) {
                buildTypes.add(match[1]);
            }
            
            // Groovy: name { }
            const groovyRegex = /^\s*(\w+)\s*\{/gm;
            while ((match = groovyRegex.exec(buildTypesBlock)) !== null) {
                const name = match[1];
                if (!['buildTypes', 'getByName', 'create', 'named', 'register', 'all'].includes(name)) {
                    buildTypes.add(name);
                }
            }
        }
        
        // Extract product flavors
        const flavorsBlock = this.extractBlock(content, 'productFlavors');
        if (flavorsBlock) {
            const ktsRegex = /(?:getByName|create)\s*\(\s*["'](\w+)["']\s*\)/g;
            let match;
            while ((match = ktsRegex.exec(flavorsBlock)) !== null) {
                productFlavors.push(match[1]);
            }
            
            const groovyRegex = /^\s*(\w+)\s*\{/gm;
            while ((match = groovyRegex.exec(flavorsBlock)) !== null) {
                const name = match[1];
                if (!['productFlavors', 'getByName', 'create', 'named', 'register', 'all', 'dimension', 'flavorDimensions'].includes(name)) {
                    productFlavors.push(name);
                }
            }
        }
        
        // Build variant matrix
        if (productFlavors.length > 0) {
            this.availableVariants = [];
            for (const flavor of productFlavors) {
                for (const buildType of buildTypes) {
                    this.availableVariants.push(`${flavor}${buildType.charAt(0).toUpperCase()}${buildType.slice(1)}`);
                }
            }
        } else {
            this.availableVariants = Array.from(buildTypes);
        }
    }

    /**
     * Show a quick pick to select a build variant.
     */
    async selectVariant(): Promise<string | undefined> {
        const selection = await vscode.window.showQuickPick(
            this.availableVariants.map(v => ({
                label: v,
                description: v === this.currentVariant ? '(current)' : '',
                picked: v === this.currentVariant
            })),
            { placeHolder: 'Select build variant', title: 'Build Variant' }
        );
        
        if (selection) {
            this.currentVariant = selection.label;
            this.updateStatusBar();
            await this.context.workspaceState.update('selectedBuildVariant', this.currentVariant);
            
            this.logger.success(`Build variant changed to: ${this.currentVariant}`);
            
            // Notify listeners
            for (const cb of this.onVariantChangedCallbacks) {
                cb(this.currentVariant);
            }
            
            return this.currentVariant;
        }
        
        return undefined;
    }

    /**
     * Get the current build variant.
     */
    getCurrentVariant(): string {
        return this.currentVariant;
    }

    /**
     * Get available build variants.
     */
    getAvailableVariants(): string[] {
        return [...this.availableVariants];
    }

    /**
     * Get the Gradle lint task name for the current variant.
     */
    getLintTask(): string {
        return `lint${this.currentVariant.charAt(0).toUpperCase()}${this.currentVariant.slice(1)}`;
    }

    /**
     * Get the Gradle install task name for the current variant.
     */
    getInstallTask(): string {
        return `install${this.currentVariant.charAt(0).toUpperCase()}${this.currentVariant.slice(1)}`;
    }

    /**
     * Register a callback for variant changes.
     */
    onVariantChanged(callback: (variant: string) => void): void {
        this.onVariantChangedCallbacks.push(callback);
    }

    private updateStatusBar(): void {
        this.statusBarItem.text = `$(symbol-enum) ${this.currentVariant}`;
        this.statusBarItem.tooltip = `Build Variant: ${this.currentVariant}\nClick to change`;
    }

    private extractBlock(content: string, blockName: string): string | undefined {
        const regex = new RegExp(`${blockName}\\s*\\{`);
        const match = regex.exec(content);
        if (!match) return undefined;
        
        let depth = 0;
        let started = false;
        const start = match.index + match[0].length;
        
        for (let i = start; i < content.length; i++) {
            if (content[i] === '{') {
                depth++;
                started = true;
            } else if (content[i] === '}') {
                if (!started) {
                    return content.substring(start, i);
                }
                depth--;
                if (depth < 0) {
                    return content.substring(start, i);
                }
            }
        }
        
        return undefined;
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}
