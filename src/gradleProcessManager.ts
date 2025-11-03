import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

export interface GradleCommandOptions {
    timeout?: number;
    cancellationToken?: vscode.CancellationToken;
    env?: NodeJS.ProcessEnv;
    silent?: boolean;
}

export interface GradleCommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export class GradleCommandError extends Error {
    public readonly exitCode: number;
    public readonly stdout: string;
    public readonly stderr: string;
    public readonly timedOut: boolean;

    constructor(message: string, result: GradleCommandResult, timedOut = false) {
        super(message);
        this.exitCode = result.exitCode;
        this.stdout = result.stdout;
        this.stderr = result.stderr;
        this.timedOut = timedOut;
    }
}

interface InternalCommandOptions extends GradleCommandOptions {
    manageIdle?: boolean;
}

interface WorkspaceState {
    runningCommands: number;
    stopTimer?: NodeJS.Timeout;
}

export class GradleProcessManager implements vscode.Disposable {
    private readonly outputChannel: vscode.OutputChannel;
    private readonly workspaceStates = new Map<string, WorkspaceState>();

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    public async runCommand(
        workspaceRoot: string,
        args: string[],
        options: GradleCommandOptions = {}
    ): Promise<GradleCommandResult> {
        return this.executeCommand(workspaceRoot, args, { ...options, manageIdle: true });
    }

    public async stopDaemons(workspaceRoot: string): Promise<void> {
        await this.executeCommand(workspaceRoot, ['--stop'], { silent: true, manageIdle: false });
    }

    public dispose(): void {
        for (const [, state] of this.workspaceStates.entries()) {
            if (state.stopTimer) {
                clearTimeout(state.stopTimer);
            }
        }
        this.workspaceStates.clear();
    }

    private async executeCommand(
        workspaceRoot: string,
        args: string[],
        options: InternalCommandOptions
    ): Promise<GradleCommandResult> {
        const gradleExecutable = this.resolveGradleExecutable(workspaceRoot);
        if (!gradleExecutable) {
            const errorMsg = 'Gradle wrapper not found in workspace. Set android-linter.gradlePath if using a custom location.';
            this.log(`❌ ${errorMsg}`);
            vscode.window.showErrorMessage(`Android Linter: ${errorMsg}`);
            throw new Error(errorMsg);
        }

        const state = this.getWorkspaceState(workspaceRoot);

        this.cancelScheduledStop(state);
        state.runningCommands += 1;

        const config = vscode.workspace.getConfiguration('android-linter');
        const jvmArgs = (config.get<string>('gradleJvmArgs') || '').trim();
        const stopOnIdle = config.get<boolean>('gradleStopDaemonsOnIdle', true);
        const idleTimeout = config.get<number>('gradleDaemonIdleTimeoutMs') || 300000;
        const maxWorkers = config.get<number>('gradleMaxWorkers') || 0;

        const finalArgs = [...args];
        if (maxWorkers > 0 && !finalArgs.includes('--max-workers')) {
            finalArgs.push(`--max-workers=${maxWorkers}`);
        }

        const env = { ...process.env, ...options.env };
        if (jvmArgs) {
            env.GRADLE_OPTS = env.GRADLE_OPTS ? `${env.GRADLE_OPTS} ${jvmArgs}` : jvmArgs;
        }

        const spawnOptions = {
            cwd: workspaceRoot,
            env,
            shell: process.platform === 'win32'
        };

        const commandLabel = `${path.basename(gradleExecutable)} ${finalArgs.join(' ')}`;
        if (!options.silent) {
            this.log(`⚙️ Running Gradle command: ${commandLabel}`);
        }

        // Quote the executable path if it contains spaces (Windows PowerShell)
        const quotedExecutable = gradleExecutable.includes(' ') && process.platform === 'win32'
            ? `"${gradleExecutable}"`
            : gradleExecutable;

        const result = await this.spawnGradleProcess(
            quotedExecutable,
            finalArgs,
            spawnOptions,
            options
        ).finally(() => {
            state.runningCommands = Math.max(0, state.runningCommands - 1);
            if (options.manageIdle && stopOnIdle && state.runningCommands === 0) {
                state.stopTimer = setTimeout(async () => {
                    try {
                        await this.executeCommand(workspaceRoot, ['--stop'], {
                            silent: true,
                            manageIdle: false
                        });
                        this.log('🛑 Stopped idle Gradle daemons');
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        this.log(`⚠️ Failed to stop Gradle daemons: ${message}`);
                    } finally {
                        this.cancelScheduledStop(state);
                    }
                }, idleTimeout);
            }
        });

        return result;
    }

    private spawnGradleProcess(
        executable: string,
        args: string[],
        spawnOptions: {
            cwd: string;
            env: NodeJS.ProcessEnv;
            shell: boolean;
        },
        options: InternalCommandOptions
    ): Promise<GradleCommandResult> {
        return new Promise<GradleCommandResult>((resolve, reject) => {
            const child: ChildProcess = spawn(executable, args, spawnOptions);

            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let cancelled = false;
            let timeoutHandle: NodeJS.Timeout | undefined;

            const cleanup = () => {
                child.stdout?.removeAllListeners();
                child.stderr?.removeAllListeners();
                child.removeAllListeners();
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                }
            };

            child.stdout?.on('data', (data: Buffer) => {
                const text = data.toString();
                stdout += text;
                if (!options.silent) {
                    this.outputChannel.append(text);
                }
            });

            child.stderr?.on('data', (data: Buffer) => {
                const text = data.toString();
                stderr += text;
                if (!options.silent) {
                    this.outputChannel.append(text);
                }
            });

            child.on('error', (error) => {
                cleanup();
                reject(error);
            });

            child.on('close', (code, signal) => {
                cleanup();
                const result: GradleCommandResult = {
                    stdout,
                    stderr,
                    exitCode: typeof code === 'number' ? code : -1
                };

                if (timedOut) {
                    reject(new GradleCommandError('Gradle command timed out', result, true));
                    return;
                }

                if (cancelled) {
                    reject(new GradleCommandError('Gradle command cancelled', result));
                    return;
                }

                if (signal) {
                    reject(new GradleCommandError(`Gradle command terminated by signal ${signal}`, result));
                    return;
                }

                if (result.exitCode !== 0) {
                    reject(new GradleCommandError('Gradle command failed', result));
                    return;
                }

                resolve(result);
            });

            if (options.timeout && options.timeout > 0) {
                timeoutHandle = setTimeout(() => {
                    timedOut = true;
                    if (!child.killed) {
                        if (process.platform === 'win32') {
                            child.kill();
                        } else {
                            child.kill('SIGKILL');
                        }
                    }
                }, options.timeout);
            }

            options.cancellationToken?.onCancellationRequested(() => {
                cancelled = true;
                if (!child.killed) {
                    if (process.platform === 'win32') {
                        child.kill();
                    } else {
                        child.kill('SIGINT');
                    }
                }
            });
        });
    }

    private resolveGradleExecutable(workspaceRoot: string): string | undefined {
        const config = vscode.workspace.getConfiguration('android-linter');
        let gradlePath = config.get<string>('gradlePath') || './gradlew';

        if (!path.isAbsolute(gradlePath)) {
            gradlePath = gradlePath.replace(/^\.\//, '');
            gradlePath = path.join(workspaceRoot, gradlePath);
        }

        const candidates: string[] = [gradlePath];

        if (process.platform === 'win32') {
            if (!gradlePath.endsWith('.bat')) {
                candidates.push(`${gradlePath}.bat`);
            }
        }

        const defaultWrapper = path.join(
            workspaceRoot,
            process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
        );

        if (!candidates.includes(defaultWrapper)) {
            candidates.push(defaultWrapper);
        }

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        return undefined;
    }

    private log(message: string): void {
        const config = vscode.workspace.getConfiguration('android-linter');
        if (config.get<boolean>('verboseLogging', true)) {
            this.outputChannel.appendLine(message);
        }
    }

    private getWorkspaceState(workspaceRoot: string): WorkspaceState {
        let state = this.workspaceStates.get(workspaceRoot);
        if (!state) {
            state = {
                runningCommands: 0
            };
            this.workspaceStates.set(workspaceRoot, state);
        }
        return state;
    }

    private cancelScheduledStop(state: WorkspaceState): void {
        if (state.stopTimer) {
            clearTimeout(state.stopTimer);
            state.stopTimer = undefined;
        }
    }
}