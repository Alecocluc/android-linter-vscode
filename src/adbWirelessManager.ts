import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Logger } from './logger';

const execFileAsync = promisify(execFile);

export class AdbWirelessManager {
    private readonly logger: Logger;

    constructor(
        outputChannel: vscode.OutputChannel,
        private readonly adbPath: string
    ) {
        this.logger = Logger.create(outputChannel);
    }

    public async connect(): Promise<void> {
        const ipPort = await vscode.window.showInputBox({
            title: 'Connect to Device (Wireless)',
            placeHolder: '192.168.1.5:5555',
            prompt: 'Enter the IP address and port found in Developer Options > Wireless Debugging.',
            ignoreFocusOut: true
        });

        if (!ipPort) {
            return;
        }

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Connecting to ${ipPort}...`,
            }, async () => {
                await execFileAsync(this.adbPath, ['connect', ipPort], { timeout: 10000 });
            });
            vscode.window.showInformationMessage(`Successfully connected to ${ipPort}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`ADB Connect failed: ${message}`);
            vscode.window.showErrorMessage(`Failed to connect to ${ipPort}. Check the Output channel for details.`);
        }
    }

    public async pair(): Promise<void> {
        const ipPort = await vscode.window.showInputBox({
            title: 'Pair Device (Wireless)',
            placeHolder: '192.168.1.5:12345',
            prompt: 'Enter the pairing IP address and port from Developer Options > Wireless Debugging > Pair with pairing code.',
            ignoreFocusOut: true
        });

        if (!ipPort) {
            return;
        }

        const code = await vscode.window.showInputBox({
            title: 'Enter Pairing Code',
            placeHolder: '123456',
            prompt: 'Enter the 6-digit Wi-Fi pairing code.',
            ignoreFocusOut: true
        });

        if (!code) {
            return;
        }

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Pairing with ${ipPort}...`,
            }, async () => {
                await execFileAsync(this.adbPath, ['pair', ipPort, code], { timeout: 10000 });
            });
            vscode.window.showInformationMessage(`Successfully paired with ${ipPort}`);
            
            const result = await vscode.window.showInformationMessage(
                'Pairing successful. Do you want to connect now?',
                'Yes', 'No'
            );
            
            if (result === 'Yes') {
                await this.connect();
            }

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`ADB Pair failed: ${message}`);
            vscode.window.showErrorMessage(`Failed to pair with ${ipPort}. Check the Output channel for details.`);
        }
    }
}
