import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import { createStream, QualifiedTag } from 'sax';

export interface LauncherComponentInfo {
    packageName: string;
    componentName: string;
}

export async function detectApplicationId(
    workspaceRoot: string,
    moduleName = 'app'
): Promise<string | undefined> {
    const candidates = buildGradleCandidates(workspaceRoot, moduleName);

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) {
            continue;
        }

        try {
            const content = await fsPromises.readFile(candidate, 'utf8');
            const applicationId = parseApplicationId(content);
            if (applicationId) {
                return applicationId;
            }
        } catch {
            // Ignore individual file errors and move to next candidate
        }
    }

    // Fallback to manifest package if available
    const manifestInfo = await resolveManifestLauncher(workspaceRoot, moduleName);
    if (manifestInfo) {
        return manifestInfo.packageName;
    }

    return undefined;
}

export async function resolveManifestLauncher(
    workspaceRoot: string,
    moduleName = 'app'
): Promise<LauncherComponentInfo | undefined> {
    const manifestPaths = getManifestCandidates(workspaceRoot, moduleName);

    for (const manifestPath of manifestPaths) {
        if (!fs.existsSync(manifestPath)) {
            continue;
        }

        try {
            const launcher = await parseManifestForLauncher(manifestPath);
            if (launcher) {
                return launcher;
            }
        } catch {
            // Ignore parse failures and continue searching other manifests
        }
    }

    return undefined;
}

function buildGradleCandidates(workspaceRoot: string, moduleName: string): string[] {
    const files = [
        path.join(workspaceRoot, moduleName, 'build.gradle'),
        path.join(workspaceRoot, moduleName, 'build.gradle.kts'),
        path.join(workspaceRoot, 'build.gradle'),
        path.join(workspaceRoot, 'build.gradle.kts')
    ];

    return files;
}

function getManifestCandidates(workspaceRoot: string, moduleName: string): string[] {
    return [
        path.join(workspaceRoot, moduleName, 'src', 'main', 'AndroidManifest.xml'),
        path.join(workspaceRoot, 'src', 'main', 'AndroidManifest.xml')
    ];
}

function parseApplicationId(content: string): string | undefined {
    const baseMatch = content.match(/applicationId\s*(?:=)?\s*["']([^"']+)["']/);
    if (!baseMatch) {
        return undefined;
    }

    let applicationId = baseMatch[1];

    const suffixMatch = content.match(
        /buildTypes\s*\{[\s\S]*?debug[\s\S]*?applicationIdSuffix\s*(?:=)?\s*["']([^"']+)["']/
    );

    if (suffixMatch) {
        applicationId += suffixMatch[1];
    }

    return applicationId;
}

function toComponentName(packageName: string, activityName: string): string {
    if (activityName.startsWith(packageName)) {
        return `${packageName}/${activityName}`;
    }

    if (activityName.startsWith('.')) {
        return `${packageName}/${activityName}`;
    }

    if (activityName.includes('.')) {
        return `${packageName}/${activityName}`;
    }

    return `${packageName}/.${activityName}`;
}

async function parseManifestForLauncher(manifestPath: string): Promise<LauncherComponentInfo | undefined> {
    const xml = await fsPromises.readFile(manifestPath, 'utf8');
    const parser = createStream(true, { trim: true, normalize: true });

    let manifestPackage: string | undefined;
    let currentActivityName: string | undefined;
    let foundMainAction = false;
    let foundLauncherCategory = false;
    let insideIntentFilter = false;
    let resolvedComponent: LauncherComponentInfo | undefined;

    parser.on('opentag', (node: QualifiedTag) => {
        if (resolvedComponent) {
            return;
        }

        switch (node.name) {
            case 'manifest':
                manifestPackage =
                    (node.attributes['package'] as string | undefined) ??
                    (node.attributes['android:package'] as string | undefined);
                break;
            case 'activity':
            case 'activity-alias':
                currentActivityName =
                    (node.attributes['android:name'] as string | undefined) ??
                    (node.attributes['name'] as string | undefined);
                break;
            case 'intent-filter':
                insideIntentFilter = true;
                foundMainAction = false;
                foundLauncherCategory = false;
                break;
            case 'action':
                if (!insideIntentFilter) {
                    break;
                }
                {
                    const actionName =
                        (node.attributes['android:name'] as string | undefined) ??
                        (node.attributes['name'] as string | undefined);
                    if (actionName === 'android.intent.action.MAIN') {
                        foundMainAction = true;
                    }
                }
                break;
            case 'category':
                if (!insideIntentFilter) {
                    break;
                }
                {
                    const categoryName =
                        (node.attributes['android:name'] as string | undefined) ??
                        (node.attributes['name'] as string | undefined);
                    if (
                        categoryName === 'android.intent.category.LAUNCHER' ||
                        categoryName === 'android.intent.category.LEANBACK_LAUNCHER'
                    ) {
                        foundLauncherCategory = true;
                    }
                }
                break;
            default:
                break;
        }
    });

    parser.on('closetag', (tagName: string) => {
        if (resolvedComponent) {
            return;
        }

        if (tagName === 'intent-filter') {
            if (insideIntentFilter && foundMainAction && foundLauncherCategory && manifestPackage && currentActivityName) {
                resolvedComponent = {
                    packageName: manifestPackage,
                    componentName: toComponentName(manifestPackage, currentActivityName)
                };
            }

            insideIntentFilter = false;
        }

        if (tagName === 'activity' || tagName === 'activity-alias') {
            currentActivityName = undefined;
            foundLauncherCategory = false;
            foundMainAction = false;
            insideIntentFilter = false;
        }
    });

    return new Promise((resolve, reject) => {
        parser.on('error', (error: Error) => {
            parser.removeAllListeners();
            reject(error);
        });

        parser.on('end', () => {
            resolve(resolvedComponent);
        });

        parser.write(xml);
        parser.end();
    });
}