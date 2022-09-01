import type { FetchOptions as Options } from 'ohmyfetch'

export interface FetchInterceptorOptions {
    synchronous?: boolean;
    runWhen?: (config: FetchConfig) => boolean;
}

export interface FetchInterceptorManager<V> {
    use<T = V>(onFulfilled?: (value: V) => T | Promise<T>, onRejected?: (error: any) => any, options?: FetchInterceptorOptions): number;
    eject(id: number): void;
    forEach(fn: (handler: any) => void): void;
}

export interface FetchConfig extends Options {
    url?: any;
    timeout?: number;
    raw?: boolean;
    xsrfCookieName?: string,
    xsrfHeaderName?: string,
}