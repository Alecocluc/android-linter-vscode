package com.alecocluc.androidls.lint

import com.alecocluc.androidls.project.ProjectModel
import com.android.tools.lint.LintCliClient
import com.android.tools.lint.LintCliFlags
import com.android.tools.lint.client.api.*
import com.android.tools.lint.detector.api.*
import java.io.File

/**
 * Custom LintClient for IDE-mode linting.
 *
 * Extends LintCliClient (from com.android.tools.lint:lint) to inherit working
 * UAST parser, XML parser, and other infrastructure — the SAME parsers that
 * the Android Lint CLI uses.
 *
 * Key overrides:
 * - readFile(): reads from in-memory buffers (dirty/unsaved files from VS Code)
 * - report(): intercepts lint incidents instead of writing reports
 * - getSdkHome(): resolves Android SDK location
 *
 * This gives us real-time single-file lint in <1s vs 10-60s for Gradle lint.
 */
class IdeLintClient(
    private val projectModel: ProjectModel,
    private val fileContents: Map<String, String> = emptyMap(),
    private val incidentHandler: (Incident) -> Unit = {}
) : LintCliClient(LintCliFlags(), "ide") {

    private val resolvedSdkHome: File? by lazy { resolveSdkHome() }

    /**
     * Provide file content from in-memory buffers.
     * This allows linting unsaved/dirty files — just like Android Studio.
     */
    override fun readFile(file: File): CharSequence {
        val normalizedPath = file.absolutePath.replace('\\', '/')
        for ((uri, content) in fileContents) {
            val filePath = uriToPath(uri)?.replace('\\', '/') ?: continue
            if (filePath == normalizedPath) return content
        }
        return if (file.exists()) file.readText() else ""
    }

    /**
     * Intercept lint incidents — this is how we collect diagnostics
     * without writing report files.
     */
    override fun report(context: Context, incident: Incident, format: TextFormat) {
        incidentHandler(incident)
    }

    override fun getSdkHome(): File? = resolvedSdkHome

    override fun log(severity: Severity, exception: Throwable?, format: String?, vararg args: Any) {
        // Only log errors to stderr to avoid noise in the LSP channel
        if (severity == Severity.ERROR || severity == Severity.FATAL) {
            val message = if (format != null && args.isNotEmpty()) {
                try { String.format(format, *args) } catch (_: Exception) { format }
            } else {
                format ?: exception?.message ?: "Unknown lint error"
            }
            System.err.println("[IdeLintClient] $message")
            exception?.printStackTrace(System.err)
        }
    }

    override fun getClientDisplayName(): String = "Android Language Server"
    override fun getClientRevision(): String = "0.1.0"

    /**
     * Resolve the Android SDK location.
     * Checks: ANDROID_HOME, ANDROID_SDK_ROOT, common install paths, local.properties.
     */
    private fun resolveSdkHome(): File? {
        // Environment variables
        val envPaths = listOf(
            System.getenv("ANDROID_HOME"),
            System.getenv("ANDROID_SDK_ROOT"),
            System.getenv("ANDROID_SDK")
        )
        for (p in envPaths) {
            if (p != null) {
                val dir = File(p)
                if (dir.isDirectory) return dir
            }
        }

        // Common install paths
        val home = System.getProperty("user.home")
        val commonPaths = listOf(
            "$home/Android/Sdk",                // Linux
            "$home/Library/Android/sdk",        // macOS
            "$home/AppData/Local/Android/Sdk",  // Windows
            "C:/Users/${System.getProperty("user.name")}/AppData/Local/Android/Sdk"
        )
        for (p in commonPaths) {
            val dir = File(p)
            if (dir.isDirectory) return dir
        }

        // Check project's local.properties
        val localProps = File(projectModel.rootDir, "local.properties")
        if (localProps.exists()) {
            val props = java.util.Properties()
            localProps.inputStream().use { props.load(it) }
            val sdkDir = props.getProperty("sdk.dir")
            if (sdkDir != null) {
                val dir = File(sdkDir)
                if (dir.isDirectory) return dir
            }
        }

        return null
    }

    /**
     * Resolve android.jar for the given compile SDK version.
     */
    fun resolveAndroidJar(compileSdk: Int): File? {
        val sdk = resolvedSdkHome ?: return null
        return File(sdk, "platforms/android-$compileSdk/android.jar").takeIf { it.exists() }
    }

    companion object {
        fun uriToPath(uri: String): String? {
            return try {
                val path = java.net.URI(uri).path ?: return null
                // On Windows, URI path starts with /C:/... — strip leading /
                if (path.length > 2 && path[0] == '/' && path[2] == ':') {
                    path.substring(1)
                } else {
                    path
                }
            } catch (e: Exception) {
                null
            }
        }
    }
}
