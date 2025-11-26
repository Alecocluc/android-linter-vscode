/**
 * Shared constants for the Android Linter extension
 */

// Extension configuration namespace
export const CONFIG_NAMESPACE = 'android-linter';

// Configuration keys
export const CONFIG_KEYS = {
    // Lint settings
    LINT_ON_OPEN: 'lintOnOpen',
    LINT_ON_SAVE: 'lintOnSave',
    LINT_ON_CHANGE: 'lintOnChange',
    LINT_SCOPE: 'lintScope',
    LINT_MODULE: 'lintModule',
    LINT_TASK: 'lintTask',
    LINT_TIMEOUT: 'lintTimeout',
    LINT_OFFLINE: 'lintOffline',
    LINT_FAST_MODE: 'lintFastMode',
    DEBOUNCE_DELAY: 'debounceDelay',
    
    // Severity settings
    SHOW_SEVERITY: 'showSeverity',
    
    // Feature flags
    ENABLE_QUICK_FIXES: 'enableQuickFixes',
    ENABLE_HOVER_REFERENCES: 'enableHoverReferences',
    VERBOSE_LOGGING: 'verboseLogging',
    SHOW_STATUS_BAR: 'showStatusBar',
    
    // Paths
    GRADLE_PATH: 'gradlePath',
    ADB_PATH: 'adbPath',
    
    // Launch settings
    LAUNCH_MODULE: 'launchModule',
    LAUNCH_APPLICATION_ID: 'launchApplicationId',
    LAUNCH_REMEMBER_APPLICATION_ID: 'launchRememberApplicationId',
    LAUNCH_INSTALL_TASK: 'launchInstallTask',
    LAUNCH_INSTALL_TIMEOUT_MS: 'launchInstallTimeoutMs',
    
    // Logcat settings
    LOGCAT_LEVEL: 'logcatLevel',
    LOGCAT_FORMAT: 'logcatFormat',
    LOGCAT_AUTO_CLEAR: 'logcatAutoClear',
    LOGCAT_AUTO_START_ON_LAUNCH: 'logcatAutoStartOnLaunch',
    LOGCAT_PID_WAIT_TIMEOUT_MS: 'logcatPidWaitTimeoutMs',
    LOGCAT_PID_POLL_INTERVAL_MS: 'logcatPidPollIntervalMs',
    LOGCAT_USE_WEBVIEW: 'logcatUseWebview',
    LOGCAT_MAX_BUFFER_SIZE: 'logcatMaxBufferSize',
    LOGCAT_AUTO_SCROLL: 'logcatAutoScroll',
    
    // Gradle daemon settings
    GRADLE_STOP_DAEMONS_ON_IDLE: 'gradleStopDaemonsOnIdle',
    GRADLE_DAEMON_IDLE_TIMEOUT_MS: 'gradleDaemonIdleTimeoutMs',
    GRADLE_JVM_ARGS: 'gradleJvmArgs',
    GRADLE_MAX_WORKERS: 'gradleMaxWorkers',
} as const;

// Command IDs
export const COMMANDS = {
    LINT_CURRENT_FILE: 'android-linter.lintCurrentFile',
    LINT_PROJECT: 'android-linter.lintProject',
    CLEAR_DIAGNOSTICS: 'android-linter.clearDiagnostics',
    LAUNCH_ON_DEVICE: 'android-linter.launchOnDevice',
    RELAUNCH_APP: 'android-linter.relaunchApp',
    DEBUG_APP: 'android-linter.debugApp',
    STOP_APP: 'android-linter.stopApp',
    SHOW_LOGCAT: 'android-linter.showLogcat',
    STOP_LOGCAT: 'android-linter.stopLogcat',
    CLEAR_LOGCAT: 'android-linter.clearLogcat',
    REFRESH_DEVICES: 'android-linter.refreshDevices',
    SELECT_DEVICE: 'android-linter.selectDevice',
    ADB_CONNECT: 'android-linter.adbConnect',
    ADB_PAIR: 'android-linter.adbPair',
    EXTRACT_STRING: 'android-linter.extractString',
} as const;

// View IDs
export const VIEWS = {
    ANDROID_EXPLORER: 'androidExplorer',
} as const;

// Output channel names
export const OUTPUT_CHANNELS = {
    MAIN: 'Android Linter',
    LOGCAT: 'Android Logcat',
} as const;

// File patterns
export const FILE_PATTERNS = {
    KOTLIN_JAVA: '**/*.{kt,java}',
    XML: '**/*.xml',
    GRADLE: '**/*.gradle',
    GRADLE_KTS: '**/*.gradle.kts',
    EXCLUDE_NODE_MODULES: '**/node_modules/**',
} as const;

// Supported languages
export const SUPPORTED_LANGUAGES = ['kotlin', 'java', 'xml'] as const;

// Default values
export const DEFAULTS = {
    LINT_TIMEOUT: 600000,
    DEBOUNCE_DELAY: 2000,
    INSTALL_TIMEOUT: 240000,
    PID_WAIT_TIMEOUT: 10000,
    PID_POLL_INTERVAL: 500,
    DAEMON_IDLE_TIMEOUT: 300000,
    MAX_LOG_ENTRIES: 10000,
    DEFINITION_CACHE_TIMEOUT: 30000,
    MAX_FILE_SEARCH_RESULTS: 200,
    MAX_REFERENCE_SEARCH_RESULTS: 500,
} as const;
