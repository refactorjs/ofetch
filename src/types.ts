import type { FetchOptions as Options } from 'ofetch'

export type RequestInfo = string | FetchConfig

export type MakeRequired<Type, Key extends keyof Type> = Omit<Type, Key> & Required<Pick<Type, Key>>;
export type MakeOptional<Type, Key extends keyof Type> = Omit<Type, Key> & Partial<Pick<Type, Key>>;

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
    native?: boolean;
    xsrfCookieName?: string;
    xsrfHeaderName?: string;
}