package com.alecocluc.androidls.project

import java.io.File

/**
 * Represents the structure of an Android project.
 * Parsed from Gradle build files without actually running Gradle.
 */
data class ProjectModel(
    val rootDir: File,
    val modules: List<ModuleModel>,
    val buildVariant: String = "debug",
    val settingsFile: File? = null
) {
    /**
     * Find which module a given file belongs to.
     */
    fun findModuleForFile(file: File): ModuleModel? {
        val absolutePath = file.absolutePath.replace('\\', '/')
        // Find the module whose path is a prefix of the file path
        // Prefer longer prefixes (more specific modules)
        return modules
            .filter { absolutePath.startsWith(it.path.absolutePath.replace('\\', '/')) }
            .maxByOrNull { it.path.absolutePath.length }
    }
    
    /**
     * Get the "app" module (or first Android application module).
     */
    fun getAppModule(): ModuleModel? {
        return modules.find { it.isApplication } ?: modules.firstOrNull()
    }
}

/**
 * Represents a single Gradle module in the project.
 */
data class ModuleModel(
    val name: String,
    val path: File,
    val isApplication: Boolean = false,
    val applicationId: String? = null,
    val namespace: String? = null,
    val compileSdk: Int? = null,
    val minSdk: Int? = null,
    val targetSdk: Int? = null,
    val buildTypes: List<String> = listOf("debug", "release"),
    val productFlavors: List<ProductFlavor> = emptyList(),
    val dependencies: List<Dependency> = emptyList()
) {
    /**
     * Get all source directories for the current build variant.
     */
    fun getSourceDirs(variant: String = "debug"): List<File> {
        val dirs = mutableListOf<File>()
        // Main source set
        dirs.add(File(path, "src/main/java"))
        dirs.add(File(path, "src/main/kotlin"))
        dirs.add(File(path, "src/main/res"))
        // Variant source set
        dirs.add(File(path, "src/$variant/java"))
        dirs.add(File(path, "src/$variant/kotlin"))
        dirs.add(File(path, "src/$variant/res"))
        return dirs.filter { it.exists() }
    }
    
    /**
     * Get all resource directories.
     */
    fun getResourceDirs(variant: String = "debug"): List<File> {
        val dirs = mutableListOf<File>()
        dirs.add(File(path, "src/main/res"))
        dirs.add(File(path, "src/$variant/res"))
        // Flavor source sets
        for (flavor in productFlavors) {
            dirs.add(File(path, "src/${flavor.name}/res"))
        }
        return dirs.filter { it.exists() }
    }
    
    /**
     * Get the AndroidManifest.xml for this module.
     */
    fun getManifest(): File? {
        val manifest = File(path, "src/main/AndroidManifest.xml")
        return if (manifest.exists()) manifest else null
    }
    
    /**
     * Get all build variants (buildType × productFlavor combinations).
     */
    fun getBuildVariants(): List<String> {
        if (productFlavors.isEmpty()) return buildTypes
        val variants = mutableListOf<String>()
        for (flavor in productFlavors) {
            for (buildType in buildTypes) {
                variants.add("${flavor.name}${buildType.replaceFirstChar { it.uppercase() }}")
            }
        }
        return variants
    }
}

data class ProductFlavor(
    val name: String,
    val dimension: String? = null,
    val applicationIdSuffix: String? = null
)

data class Dependency(
    val group: String,
    val name: String,
    val version: String,
    val configuration: String = "implementation"
)
