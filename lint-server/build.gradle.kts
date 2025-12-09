plugins {
    kotlin("jvm") version "1.9.21"
    kotlin("plugin.serialization") version "1.9.21"
    id("com.github.johnrengelman.shadow") version "8.1.1"
    application
}

group = "com.androidlinter"
version = "1.0.0"

repositories {
    mavenCentral()
    google()
}

dependencies {
    // Android Lint API - using version 30.x which has more open API
    implementation("com.android.tools.lint:lint-api:30.4.2")
    implementation("com.android.tools.lint:lint-checks:30.4.2")
    implementation("com.android.tools.lint:lint:30.4.2")
    
    // JSON serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2")
    
    // Coroutines for async processing
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
    
    // Kotlin stdlib
    implementation(kotlin("stdlib"))
}

application {
    mainClass.set("com.androidlinter.server.MainKt")
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> {
    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs = listOf("-Xjsr305=strict")
    }
}

tasks.shadowJar {
    archiveBaseName.set("lint-server")
    archiveClassifier.set("")
    archiveVersion.set("")
    
    manifest {
        attributes(mapOf("Main-Class" to "com.androidlinter.server.MainKt"))
    }
    
    // Minimize the JAR size
    minimize {
        exclude(dependency("com.android.tools.lint:.*"))
        exclude(dependency("org.jetbrains.kotlin:.*"))
    }
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}
