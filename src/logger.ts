import * as vscode from 'vscode';
import { CONFIG_NAMESPACE, CONFIG_KEYS, OUTPUT_CHANNELS } from './constants';

/**
 * Centralized logger for the Android Linter extension.
 * Respects the verboseLogging configuration setting.
 */
export class Logger {
    private static instance: Logger | undefined;
    private outputChannel: vscode.OutputChannel;
    private prefix: string;

    private constructor(outputChannel: vscode.OutputChannel, prefix: string = '') {
        this.outputChannel = outputChannel;
        this.prefix = prefix;
    }

    /**
     * Get the singleton logger instance for the main output channel.
     */
    public static getInstance(): Logger {
        if (!Logger.instance) {
            const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNELS.MAIN);
            Logger.instance = new Logger(outputChannel);
        }
        return Logger.instance;
    }

    /**
     * Create a logger with a specific output channel (e.g., for Logcat).
     */
    public static create(outputChannel: vscode.OutputChannel, prefix: string = ''): Logger {
        return new Logger(outputChannel, prefix);
    }

    /**
     * Create a child logger with a prefix (for sub-components).
     */
    public withPrefix(prefix: string): Logger {
        return new Logger(this.outputChannel, prefix);
    }

    /**
     * Check if verbose logging is enabled.
     */
    private isVerbose(): boolean {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        return config.get<boolean>(CONFIG_KEYS.VERBOSE_LOGGING, true);
    }

    /**
     * Get the output channel for direct access if needed.
     */
    public getOutputChannel(): vscode.OutputChannel {
        return this.outputChannel;
    }

    /**
     * Show the output channel in the UI.
     */
    public show(preserveFocus: boolean = true): void {
        this.outputChannel.show(preserveFocus);
    }

    /**
     * Log a message (respects verbose setting).
     */
    public log(message: string): void {
        if (this.isVerbose()) {
            const formattedMessage = this.prefix ? `[${this.prefix}] ${message}` : message;
            this.outputChannel.appendLine(formattedMessage);
        }
    }

    /**
     * Log a message regardless of verbose setting (for important messages).
     */
    public always(message: string): void {
        const formattedMessage = this.prefix ? `[${this.prefix}] ${message}` : message;
        this.outputChannel.appendLine(formattedMessage);
    }

    /**
     * Log an info message with icon.
     */
    public info(message: string): void {
        this.log(`ℹ️ ${message}`);
    }

    /**
     * Log a success message with icon.
     */
    public success(message: string): void {
        this.log(`✅ ${message}`);
    }

    /**
     * Log a warning message with icon.
     */
    public warn(message: string): void {
        this.log(`⚠️ ${message}`);
    }

    /**
     * Log an error message with icon (always shown).
     */
    public error(message: string): void {
        this.always(`❌ ${message}`);
    }

    /**
     * Log a debug message with icon.
     */
    public debug(message: string): void {
        this.log(`🔍 ${message}`);
    }

    /**
     * Log a start/running message with icon.
     */
    public start(message: string): void {
        this.log(`🚀 ${message}`);
    }

    /**
     * Log a stop message with icon.
     */
    public stop(message: string): void {
        this.log(`🛑 ${message}`);
    }

    /**
     * Log a file-related message with icon.
     */
    public file(message: string): void {
        this.log(`📄 ${message}`);
    }

    /**
     * Log a folder-related message with icon.
     */
    public folder(message: string): void {
        this.log(`📁 ${message}`);
    }

    /**
     * Log a gradle/build message with icon.
     */
    public build(message: string): void {
        this.log(`⚙️ ${message}`);
    }

    /**
     * Log output without adding a newline (for streaming output).
     */
    public append(text: string): void {
        if (this.isVerbose()) {
            this.outputChannel.append(text);
        }
    }

    /**
     * Append output regardless of verbose setting.
     */
    public appendAlways(text: string): void {
        this.outputChannel.append(text);
    }

    /**
     * Clear the output channel.
     */
    public clear(): void {
        this.outputChannel.clear();
    }

    /**
     * Dispose the logger and output channel.
     */
    public dispose(): void {
        this.outputChannel.dispose();
        if (Logger.instance === this) {
            Logger.instance = undefined;
        }
    }
}

/**
 * Get the default logger instance.
 * Convenience function to avoid importing the class.
 */
export function getLogger(): Logger {
    return Logger.getInstance();
}
