package com.alecocluc.androidls.project

import java.io.File
import java.util.Properties

/**
 * Parses an Android project's Gradle build files to extract the project model.
 * 
 * This is a static parser — it reads build.gradle/build.gradle.kts files using
 * regex patterns rather than executing Gradle. This makes it fast (<100ms) but
 * means it can't resolve dynamic values (e.g., variables defined elsewhere).
 * 
 * For full accuracy, a Gradle Tooling API connection would be needed (future work).
 */
class GradleModelParser {

    /**
     * Parse the project starting from the root directory.
     */
    fun parse(rootDir: File): ProjectModel {
        val settingsFile = findSettingsFile(rootDir)
        val moduleNames = if (settingsFile != null) {
            parseSettingsFile(settingsFile)
        } else {
            // No settings file — assume single-module project
            listOf("app")
        }
        
        val modules = moduleNames.mapNotNull { moduleName ->
            val modulePath = resolveModulePath(rootDir, moduleName)
            if (modulePath.exists()) {
                parseModule(moduleName, modulePath)
            } else null
        }
        
        return ProjectModel(
            rootDir = rootDir,
            modules = modules,
            settingsFile = settingsFile
        )
    }
    
    /**
     * Find settings.gradle or settings.gradle.kts in the root directory.
     */
    private fun findSettingsFile(rootDir: File): File? {
        return listOf("settings.gradle.kts", "settings.gradle")
            .map { File(rootDir, it) }
            .firstOrNull { it.exists() }
    }
    
    /**
     * Parse settings.gradle to find included modules.
     * Handles: include(":app"), include(":app", ":lib"), include ":app"
     */
    private fun parseSettingsFile(settingsFile: File): List<String> {
        val content = settingsFile.readText()
        val modules = mutableListOf<String>()
        
        // Match: include(":app") or include(":app", ":lib") or include ":app"
        val includeRegex = Regex("""include\s*\(?\s*([^)]+)\)?\s*""")
        for (match in includeRegex.findAll(content)) {
            val args = match.groupValues[1]
            // Extract quoted module names
            val moduleRegex = Regex("""["']:([^"']+)["']""")
            for (moduleMatch in moduleRegex.findAll(args)) {
                modules.add(moduleMatch.groupValues[1])
            }
        }
        
        // If no modules found, assume "app"
        if (modules.isEmpty()) {
            modules.add("app")
        }
        
        return modules
    }
    
    /**
     * Resolve module path: ":app" → rootDir/app, ":feature:auth" → rootDir/feature/auth
     */
    private fun resolveModulePath(rootDir: File, moduleName: String): File {
        val relativePath = moduleName.replace(':', File.separatorChar)
        return File(rootDir, relativePath)
    }
    
    /**
     * Parse a single module's build.gradle file.
     */
    private fun parseModule(name: String, path: File): ModuleModel {
        val buildFile = listOf("build.gradle.kts", "build.gradle")
            .map { File(path, it) }
            .firstOrNull { it.exists() }
        
        if (buildFile == null) {
            return ModuleModel(name = name, path = path)
        }
        
        val content = buildFile.readText()
        
        val isApplication = content.contains("com.android.application") || 
                           content.contains("android.application")
        
        val applicationId = extractStringValue(content, "applicationId")
        val namespace = extractStringValue(content, "namespace")
        val compileSdk = extractIntValue(content, "compileSdk")
        val minSdk = extractIntValue(content, "minSdk")
        val targetSdk = extractIntValue(content, "targetSdk")
        val buildTypes = extractBuildTypes(content)
        val productFlavors = extractProductFlavors(content)
        val dependencies = extractDependencies(content)
        
        return ModuleModel(
            name = name,
            path = path,
            isApplication = isApplication,
            applicationId = applicationId,
            namespace = namespace,
            compileSdk = compileSdk,
            minSdk = minSdk,
            targetSdk = targetSdk,
            buildTypes = buildTypes.ifEmpty { listOf("debug", "release") },
            productFlavors = productFlavors,
            dependencies = dependencies
        )
    }
    
    /**
     * Extract a string value like: applicationId = "com.example.app" or applicationId "com.example.app"
     */
    private fun extractStringValue(content: String, key: String): String? {
        // KTS style: key = "value"
        val ktsRegex = Regex("""$key\s*=\s*["']([^"']+)["']""")
        ktsRegex.find(content)?.let { return it.groupValues[1] }
        
        // Groovy style: key "value"
        val groovyRegex = Regex("""$key\s+["']([^"']+)["']""")
        groovyRegex.find(content)?.let { return it.groupValues[1] }
        
        return null
    }
    
    /**
     * Extract an integer value like: compileSdk = 34 or compileSdk 34
     */
    private fun extractIntValue(content: String, key: String): Int? {
        val regex = Regex("""$key\s*[=\s]\s*(\d+)""")
        return regex.find(content)?.groupValues?.get(1)?.toIntOrNull()
    }
    
    /**
     * Extract build type names from the buildTypes block.
     */
    private fun extractBuildTypes(content: String): List<String> {
        val types = mutableListOf("debug", "release")
        
        // Find buildTypes { ... } block
        val blockContent = extractBlock(content, "buildTypes") ?: return types
        
        // Find named blocks: getByName("xyz") { } or create("xyz") { } or xyz { }
        val namedRegex = Regex("""(?:getByName|create)\s*\(\s*["'](\w+)["']\s*\)|(\w+)\s*\{""")
        for (match in namedRegex.findAll(blockContent)) {
            val name = match.groupValues[1].ifEmpty { match.groupValues[2] }
            if (name.isNotEmpty() && name !in types && name != "buildTypes") {
                types.add(name)
            }
        }
        
        return types
    }
    
    /**
     * Extract product flavors.
     */
    private fun extractProductFlavors(content: String): List<ProductFlavor> {
        val flavors = mutableListOf<ProductFlavor>()
        
        val blockContent = extractBlock(content, "productFlavors") ?: return flavors
        
        val namedRegex = Regex("""(?:getByName|create)\s*\(\s*["'](\w+)["']\s*\)|(\w+)\s*\{""")
        for (match in namedRegex.findAll(blockContent)) {
            val name = match.groupValues[1].ifEmpty { match.groupValues[2] }
            if (name.isNotEmpty() && name != "productFlavors") {
                val dimension = extractStringValue(blockContent, "dimension")
                val suffix = extractStringValue(blockContent, "applicationIdSuffix")
                flavors.add(ProductFlavor(name, dimension, suffix))
            }
        }
        
        return flavors
    }
    
    /**
     * Extract dependencies from the dependencies block.
     */
    private fun extractDependencies(content: String): List<Dependency> {
        val deps = mutableListOf<Dependency>()
        
        val blockContent = extractBlock(content, "dependencies") ?: return deps
        
        // Match: implementation("group:name:version") or implementation "group:name:version"
        val depRegex = Regex("""(\w+)\s*\(?\s*["']([^:]+):([^:]+):([^"']+)["']\s*\)?""")
        for (match in depRegex.findAll(blockContent)) {
            deps.add(Dependency(
                configuration = match.groupValues[1],
                group = match.groupValues[2],
                name = match.groupValues[3],
                version = match.groupValues[4]
            ))
        }
        
        return deps
    }
    
    /**
     * Extract a top-level block's content by name.
     * Uses brace counting to handle nested blocks.
     */
    private fun extractBlock(content: String, blockName: String): String? {
        val startRegex = Regex("""$blockName\s*\{""")
        val startMatch = startRegex.find(content) ?: return null
        
        var depth = 0
        var started = false
        val start = startMatch.range.last
        
        for (i in start until content.length) {
            when (content[i]) {
                '{' -> {
                    depth++
                    started = true
                }
                '}' -> {
                    depth--
                    if (started && depth == 0) {
                        return content.substring(start + 1, i)
                    }
                }
            }
        }
        
        return null
    }
}
