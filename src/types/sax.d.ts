declare module 'sax' {
    export interface QualifiedTag {
        name: string;
        attributes: Record<string, string | number | boolean>;
        isSelfClosing?: boolean;
    }

    export interface SAXStream extends NodeJS.ReadableStream, NodeJS.WritableStream {
        on(event: 'opentag', listener: (node: QualifiedTag) => void): this;
        on(event: 'closetag', listener: (tagName: string) => void): this;
        on(event: 'error', listener: (error: Error) => void): this;
        on(event: 'end', listener: () => void): this;
        on(event: string, listener: (...args: unknown[]) => void): this;
        removeAllListeners(event?: string | symbol): this;
    }

    export interface SaxOptions {
        trim?: boolean;
        normalize?: boolean;
        lowercase?: boolean;
        xmlns?: boolean;
        position?: boolean;
    }

    export function createStream(strict?: boolean, options?: SaxOptions): SAXStream;
}
