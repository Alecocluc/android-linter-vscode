#!/bin/bash
# Build script for Android Lint Server
# Run this script to build the lint server JAR for the VS Code extension

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINT_SERVER_DIR="$SCRIPT_DIR/lint-server"

echo -e "\033[36mBuilding Android Lint Server...\033[0m"

if [ ! -d "$LINT_SERVER_DIR" ]; then
    echo -e "\033[31mError: lint-server directory not found at $LINT_SERVER_DIR\033[0m"
    exit 1
fi

cd "$LINT_SERVER_DIR"

# Check for Gradle wrapper
if [ ! -f "gradlew" ]; then
    echo -e "\033[33mGradle wrapper not found. Generating...\033[0m"
    gradle wrapper
fi

echo -e "\033[33mRunning shadowJar task...\033[0m"

./gradlew shadowJar --no-daemon

JAR_PATH="$LINT_SERVER_DIR/build/libs/lint-server.jar"

if [ -f "$JAR_PATH" ]; then
    echo -e "\n\033[32mBuild successful!\033[0m"
    echo -e "\033[36mJAR location: $JAR_PATH\033[0m"
    
    # Get JAR size
    JAR_SIZE=$(du -h "$JAR_PATH" | cut -f1)
    echo -e "\033[90mJAR size: $JAR_SIZE\033[0m"
else
    echo -e "\033[33mWarning: JAR file not found at expected location\033[0m"
fi
