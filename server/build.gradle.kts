plugins {
    kotlin("jvm") version "2.1.21"
    application
    id("com.gradleup.shadow") version "9.0.0-beta12"
}

group = "com.alecocluc.androidls"
version = "0.1.0"

repositories {
    mavenCentral()
    google()
}

dependencies {
    // LSP4J - Language Server Protocol for JVM
    implementation("org.eclipse.lsp4j:org.eclipse.lsp4j:0.23.1")
    
    // Android Lint - the SAME lint engine Android Studio uses
    implementation("com.android.tools.lint:lint:31.8.0")
    implementation("com.android.tools.lint:lint-api:31.8.0")
    implementation("com.android.tools.lint:lint-checks:31.8.0")
    implementation("com.android.tools.lint:lint-model:31.8.0")
    
    // Kotlin compiler for analysis (IntelliSense, diagnostics)
    implementation("org.jetbrains.kotlin:kotlin-compiler-embeddable:2.1.21")
    
    // XML parsing
    implementation("javax.xml.parsers:jaxp-api:1.4.5")
    
    // Coroutines for async operations
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.1")
    
    // JSON support for custom protocol messages
    implementation("com.google.code.gson:gson:2.11.0")
    
    // SLF4J for logging (lint dependencies use it)
    implementation("org.slf4j:slf4j-simple:2.0.16")
    
    // Testing
    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
}

application {
    mainClass.set("com.alecocluc.androidls.MainKt")
}

tasks.shadowJar {
    archiveBaseName.set("android-language-server")
    archiveClassifier.set("")
    archiveVersion.set("")
    isZip64 = true
    
    // Merge service files for proper service loading
    mergeServiceFiles()
    
    manifest {
        attributes["Main-Class"] = "com.alecocluc.androidls.MainKt"
    }
}

tasks.test {
    useJUnitPlatform()
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

tasks.register("buildServer") {
    dependsOn("shadowJar")
    description = "Build the Android Language Server fat JAR"
    group = "build"
}
