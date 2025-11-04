import * as vscode from 'vscode';
import { LogcatParser, ParsedLogEntry, LogLevel } from './logcatParser';

export class LogcatWebviewPanel {
    private static instance: LogcatWebviewPanel | undefined;
    private panel: vscode.WebviewPanel | undefined;
    private parser: LogcatParser;
    private logs: ParsedLogEntry[] = [];
    private readonly maxLogs: number = 10000;
    private isPaused: boolean = false;
    private autoScroll: boolean = true;
    private currentFilter: {
        minLevel?: LogLevel;
        tags?: string[];
        searchText?: string;
    } = {};

    private constructor(private readonly extensionUri: vscode.Uri) {
        this.parser = new LogcatParser();
    }

    public static getInstance(extensionUri: vscode.Uri): LogcatWebviewPanel {
        if (!LogcatWebviewPanel.instance) {
            LogcatWebviewPanel.instance = new LogcatWebviewPanel(extensionUri);
        }
        return LogcatWebviewPanel.instance;
    }

    public show(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Two);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'androidLogcat',
            'Android Logcat',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this.extensionUri]
            }
        );

        this.panel.webview.html = this.getWebviewContent();

        this.panel.webview.onDidReceiveMessage(
            message => this.handleWebviewMessage(message),
            undefined
        );

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
    }

    public addLog(line: string): void {
        if (this.isPaused) {
            return;
        }

        const entry = this.parser.parseLine(line);
        if (!entry) {
            return;
        }

        this.logs.push(entry);

        // Trim logs if exceeding max
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }

        // Send to webview if visible and matches filter
        if (this.panel && this.parser.matchesFilter(entry, this.currentFilter)) {
            this.panel.webview.postMessage({
                type: 'addLog',
                log: entry
            });
        }
    }

    public clear(): void {
        this.logs = [];
        if (this.panel) {
            this.panel.webview.postMessage({ type: 'clear' });
        }
    }

    public setPaused(paused: boolean): void {
        this.isPaused = paused;
        if (this.panel) {
            this.panel.webview.postMessage({ 
                type: 'updateState',
                state: { isPaused: paused }
            });
        }
    }

    public setAutoScroll(autoScroll: boolean): void {
        this.autoScroll = autoScroll;
        if (this.panel) {
            this.panel.webview.postMessage({ 
                type: 'updateState',
                state: { autoScroll }
            });
        }
    }

    private handleWebviewMessage(message: any): void {
        switch (message.type) {
            case 'clear':
                this.clear();
                break;
            case 'pause':
                this.setPaused(true);
                break;
            case 'resume':
                this.setPaused(false);
                break;
            case 'toggleAutoScroll':
                this.setAutoScroll(!this.autoScroll);
                break;
            case 'filterByLevel':
                this.applyFilter({ minLevel: message.level });
                break;
            case 'filterByTag':
                this.applyFilter({ tags: [message.tag] });
                break;
            case 'search':
                this.applyFilter({ searchText: message.text });
                break;
            case 'clearFilter':
                this.applyFilter({});
                break;
            case 'copyAll':
                this.copyAllLogs();
                break;
        }
    }

    private applyFilter(filter: typeof this.currentFilter): void {
        this.currentFilter = filter;
        
        if (!this.panel) {
            return;
        }

        // Send filtered logs to webview
        const filteredLogs = this.logs.filter(log => 
            this.parser.matchesFilter(log, this.currentFilter)
        );

        this.panel.webview.postMessage({
            type: 'replaceAll',
            logs: filteredLogs
        });
    }

    private copyAllLogs(): void {
        const text = this.logs
            .filter(log => this.parser.matchesFilter(log, this.currentFilter))
            .map(log => this.parser.formatEntry(log))
            .join('\n');
        
        vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage('Logs copied to clipboard');
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Android Logcat</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family), 'Segoe UI', system-ui, -apple-system, sans-serif;
            font-size: 13px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        #toolbar {
            display: flex;
            gap: 12px;
            padding: 12px 16px;
            background: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-widget-border);
            flex-shrink: 0;
            flex-wrap: wrap;
            align-items: center;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
        }

        .toolbar-group {
            display: flex;
            gap: 6px;
            align-items: center;
        }

        .toolbar-label {
            font-size: 11px;
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-right: 4px;
        }

        .toolbar-divider {
            width: 1px;
            height: 24px;
            background-color: var(--vscode-widget-border);
            margin: 0 4px;
            opacity: 0.5;
        }

        button {
            padding: 6px 14px;
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid transparent;
            cursor: pointer;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.15s ease;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            white-space: nowrap;
        }

        button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
            transform: translateY(-1px);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        button:active {
            transform: translateY(0);
        }

        button.primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        button.primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        button.active {
            background-color: var(--vscode-inputOption-activeBackground);
            color: var(--vscode-inputOption-activeForeground);
            border-color: var(--vscode-inputOption-activeBorder);
            box-shadow: 0 0 0 1px var(--vscode-focusBorder);
        }

        button.level-btn {
            font-weight: 700;
            min-width: 36px;
            padding: 6px 10px;
            justify-content: center;
            font-family: 'Consolas', 'Monaco', monospace;
        }

        button.level-V { 
            color: #888;
            border-color: #888;
        }
        button.level-V.active { 
            background-color: rgba(136, 136, 136, 0.2);
            color: #aaa;
        }

        button.level-D { 
            color: #2196F3;
            border-color: #2196F3;
        }
        button.level-D.active { 
            background-color: rgba(33, 150, 243, 0.2);
            color: #42A5F5;
        }

        button.level-I { 
            color: #4CAF50;
            border-color: #4CAF50;
        }
        button.level-I.active { 
            background-color: rgba(76, 175, 80, 0.2);
            color: #66BB6A;
        }

        button.level-W { 
            color: #FF9800;
            border-color: #FF9800;
        }
        button.level-W.active { 
            background-color: rgba(255, 152, 0, 0.2);
            color: #FFA726;
        }

        button.level-E { 
            color: #F44336;
            border-color: #F44336;
        }
        button.level-E.active { 
            background-color: rgba(244, 67, 54, 0.2);
            color: #EF5350;
        }

        input[type="text"] {
            padding: 6px 12px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 12px;
            min-width: 200px;
            transition: all 0.15s ease;
        }

        input[type="text"]:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 1px var(--vscode-focusBorder);
        }

        input[type="text"]::placeholder {
            color: var(--vscode-input-placeholderForeground);
            opacity: 0.7;
        }

        #stats {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-left: auto;
            display: flex;
            gap: 16px;
            font-weight: 500;
        }

        .stat-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .stat-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-weight: 600;
            font-size: 10px;
        }

        .stat-badge.errors {
            background-color: rgba(244, 67, 54, 0.2);
            color: #F44336;
        }

        .stat-badge.warnings {
            background-color: rgba(255, 152, 0, 0.2);
            color: #FF9800;
        }

        .stat-badge.total {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }

        #logs-container {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
            background-color: var(--vscode-editor-background);
        }

        #logs-container::-webkit-scrollbar {
            width: 10px;
        }

        #logs-container::-webkit-scrollbar-track {
            background: var(--vscode-scrollbarSlider-background);
        }

        #logs-container::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-hoverBackground);
            border-radius: 5px;
        }

        .log-entry {
            padding: 6px 12px;
            border-left: 4px solid transparent;
            white-space: pre-wrap;
            word-wrap: break-word;
            font-family: 'Consolas', 'SF Mono', 'Monaco', 'Courier New', monospace;
            font-size: 12px;
            line-height: 1.5;
            margin-bottom: 2px;
            border-radius: 2px;
            transition: all 0.1s ease;
        }

        .log-entry:hover {
            background-color: var(--vscode-list-hoverBackground);
            border-left-width: 5px;
            padding-left: 11px;
        }

        .log-entry.level-V {
            border-left-color: #888;
            color: #999;
        }

        .log-entry.level-D {
            border-left-color: #2196F3;
            color: #64B5F6;
        }

        .log-entry.level-I {
            border-left-color: #4CAF50;
            color: var(--vscode-editor-foreground);
        }

        .log-entry.level-W {
            border-left-color: #FF9800;
            color: #FFB74D;
            background-color: rgba(255, 152, 0, 0.05);
        }

        .log-entry.level-E {
            border-left-color: #F44336;
            color: #EF5350;
            font-weight: 500;
            background-color: rgba(244, 67, 54, 0.08);
        }

        .log-entry.level-F {
            border-left-color: #C62828;
            color: #EF5350;
            font-weight: 700;
            background-color: rgba(198, 40, 40, 0.12);
        }

        .log-timestamp {
            color: var(--vscode-descriptionForeground);
            opacity: 0.7;
            margin-right: 10px;
            font-size: 11px;
        }

        .log-level {
            font-weight: 700;
            margin-right: 10px;
            min-width: 14px;
            display: inline-block;
            text-align: center;
        }

        .log-tag {
            color: var(--vscode-symbolIcon-classForeground);
            background-color: rgba(100, 100, 100, 0.15);
            padding: 2px 8px;
            border-radius: 3px;
            margin-right: 10px;
            cursor: pointer;
            font-weight: 600;
            font-size: 11px;
            transition: all 0.15s ease;
        }

        .log-tag:hover {
            background-color: rgba(100, 100, 100, 0.25);
            transform: translateY(-1px);
        }

        .log-message {
            color: inherit;
        }

        #empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--vscode-descriptionForeground);
            gap: 16px;
            animation: fadeIn 0.3s ease;
        }

        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        #empty-state.hidden {
            display: none;
        }

        .icon {
            font-size: 64px;
            opacity: 0.4;
            filter: grayscale(0.3);
        }

        .empty-title {
            font-size: 16px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .empty-subtitle {
            font-size: 12px;
            opacity: 0.7;
        }
    </style>
</head>
<body>
    <div id="toolbar">
        <div class="toolbar-group">
            <button id="clear-btn" class="primary" title="Clear all logs">
                <span>🗑️</span>
                Clear
            </button>
            <button id="pause-btn" title="Pause/Resume log capture">
                <span>⏸️</span>
                Pause
            </button>
            <button id="autoscroll-btn" class="active" title="Auto-scroll to latest logs">
                <span>⬇️</span>
                Auto-scroll
            </button>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-group">
            <span class="toolbar-label">Filter</span>
            <button class="level-btn level-V" data-level="V" title="Verbose">V</button>
            <button class="level-btn level-D" data-level="D" title="Debug">D</button>
            <button class="level-btn level-I" data-level="I" title="Info">I</button>
            <button class="level-btn level-W" data-level="W" title="Warning">W</button>
            <button class="level-btn level-E" data-level="E" title="Error">E</button>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-group">
            <input type="text" id="search-input" placeholder="🔍 Search logs..." />
            <button id="clear-filter-btn" title="Clear all filters">
                <span>✖️</span>
                Clear Filter
            </button>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-group">
            <button id="copy-btn" title="Copy all visible logs to clipboard">
                <span>📋</span>
                Copy
            </button>
        </div>

        <div id="stats">
            <div class="stat-item">
                <span class="stat-badge total" id="log-count">0</span>
                <span>logs</span>
            </div>
            <div class="stat-item">
                <span class="stat-badge errors" id="error-count">0</span>
                <span>errors</span>
            </div>
            <div class="stat-item">
                <span class="stat-badge warnings" id="warning-count">0</span>
                <span>warnings</span>
            </div>
        </div>
    </div>

    <div id="logs-container">
        <div id="empty-state">
            <div class="icon">📱</div>
            <div class="empty-title">Waiting for logcat output</div>
            <div class="empty-subtitle">Start logcat from the Android Explorer to see logs here</div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        let logs = [];
        let isPaused = false;
        let autoScroll = true;
        let currentMinLevel = null;
        let stats = { total: 0, errors: 0, warnings: 0 };

        const logsContainer = document.getElementById('logs-container');
        const emptyState = document.getElementById('empty-state');
        const pauseBtn = document.getElementById('pause-btn');
        const autoScrollBtn = document.getElementById('autoscroll-btn');
        const searchInput = document.getElementById('search-input');

        // Toolbar event listeners
        document.getElementById('clear-btn').addEventListener('click', () => {
            vscode.postMessage({ type: 'clear' });
        });

        pauseBtn.addEventListener('click', () => {
            if (isPaused) {
                vscode.postMessage({ type: 'resume' });
                isPaused = false;
                pauseBtn.innerHTML = '<span>⏸️</span>Pause';
            } else {
                vscode.postMessage({ type: 'pause' });
                isPaused = true;
                pauseBtn.innerHTML = '<span>▶️</span>Resume';
            }
        });

        autoScrollBtn.addEventListener('click', () => {
            autoScroll = !autoScroll;
            autoScrollBtn.classList.toggle('active', autoScroll);
            vscode.postMessage({ type: 'toggleAutoScroll' });
        });

        document.querySelectorAll('.level-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const level = btn.dataset.level;
                if (currentMinLevel === level) {
                    currentMinLevel = null;
                    btn.classList.remove('active');
                    vscode.postMessage({ type: 'clearFilter' });
                } else {
                    document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
                    currentMinLevel = level;
                    btn.classList.add('active');
                    vscode.postMessage({ type: 'filterByLevel', level });
                }
            });
        });

        searchInput.addEventListener('input', debounce((e) => {
            const text = e.target.value;
            if (text) {
                vscode.postMessage({ type: 'search', text });
            } else {
                vscode.postMessage({ type: 'clearFilter' });
            }
        }, 300));

        document.getElementById('clear-filter-btn').addEventListener('click', () => {
            searchInput.value = '';
            currentMinLevel = null;
            document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
            vscode.postMessage({ type: 'clearFilter' });
        });

        document.getElementById('copy-btn').addEventListener('click', () => {
            vscode.postMessage({ type: 'copyAll' });
        });

        // Message handler
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'addLog':
                    addLogEntry(message.log);
                    break;
                case 'clear':
                    clearLogs();
                    break;
                case 'replaceAll':
                    replaceAllLogs(message.logs);
                    break;
                case 'updateState':
                    updateState(message.state);
                    break;
            }
        });

        function addLogEntry(log) {
            logs.push(log);
            
            emptyState.classList.add('hidden');

            const entry = createLogElement(log);
            logsContainer.appendChild(entry);

            updateStats(log);

            if (autoScroll) {
                logsContainer.scrollTop = logsContainer.scrollHeight;
            }

            // Limit DOM elements to prevent performance issues
            const children = logsContainer.children;
            if (children.length > 10000) {
                logsContainer.removeChild(children[0]);
            }
        }

        function createLogElement(log) {
            const div = document.createElement('div');
            div.className = \`log-entry level-\${log.level}\`;
            
            const timestamp = log.timestamp ? \`<span class="log-timestamp">[\${log.timestamp}]</span>\` : '';
            const level = \`<span class="log-level">\${log.level}</span>\`;
            const tag = \`<span class="log-tag" data-tag="\${log.tag}">\${log.tag}</span>\`;
            const message = \`<span class="log-message">\${escapeHtml(log.message)}</span>\`;
            
            div.innerHTML = \`\${timestamp}\${level}\${tag}\${message}\`;
            
            // Click tag to filter
            const tagElement = div.querySelector('.log-tag');
            if (tagElement) {
                tagElement.addEventListener('click', () => {
                    vscode.postMessage({ type: 'filterByTag', tag: log.tag });
                });
            }
            
            return div;
        }

        function clearLogs() {
            logs = [];
            stats = { total: 0, errors: 0, warnings: 0 };
            logsContainer.innerHTML = '<div id="empty-state"><div class="icon">🧹</div><div class="empty-title">Logs cleared</div><div class="empty-subtitle">New logs will appear here</div></div>';
            emptyState = document.getElementById('empty-state');
            updateStatsDisplay();
        }

        function replaceAllLogs(newLogs) {
            logs = newLogs;
            logsContainer.innerHTML = '';
            stats = { total: 0, errors: 0, warnings: 0 };
            
            if (newLogs.length === 0) {
                logsContainer.innerHTML = '<div id="empty-state"><div class="icon">🔍</div><div class="empty-title">No logs match the filter</div><div class="empty-subtitle">Try adjusting your filter criteria</div></div>';
            } else {
                newLogs.forEach(log => {
                    const entry = createLogElement(log);
                    logsContainer.appendChild(entry);
                    updateStats(log);
                });
            }
            
            if (autoScroll) {
                logsContainer.scrollTop = logsContainer.scrollHeight;
            }
        }

        function updateState(state) {
            if (state.isPaused !== undefined) {
                isPaused = state.isPaused;
                pauseBtn.innerHTML = isPaused ? '<span>▶️</span>Resume' : '<span>⏸️</span>Pause';
            }
            if (state.autoScroll !== undefined) {
                autoScroll = state.autoScroll;
                autoScrollBtn.classList.toggle('active', autoScroll);
            }
        }

        function updateStats(log) {
            stats.total++;
            if (log.level === 'E' || log.level === 'F') {
                stats.errors++;
            } else if (log.level === 'W') {
                stats.warnings++;
            }
            updateStatsDisplay();
        }

        function updateStatsDisplay() {
            document.getElementById('log-count').textContent = stats.total;
            document.getElementById('error-count').textContent = stats.errors;
            document.getElementById('warning-count').textContent = stats.warnings;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }
    </script>
</body>
</html>`;
    }

    public dispose(): void {
        if (this.panel) {
            this.panel.dispose();
        }
        LogcatWebviewPanel.instance = undefined;
    }
}
