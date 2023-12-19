import type { FetchInterceptorManager, FetchInterceptorOptions } from '../types'

export default class InterceptorManager<V> implements FetchInterceptorManager<V> {
    handlers: Array<FetchInterceptorOptions | null>;

    constructor() {
        this.handlers = []
    }

    /**
     * Add a new interceptor to the stack
     *
     * @param { (value: V) => T | Promise<T> } onFulfilled The function to handle `then` for a `Promise`
     * @param { (error: any) => any } onRejected The function to handle `reject` for a `Promise`
     *
     * @return { number } An ID used to remove interceptor later
     */
    use<T = V>(onFulfilled: (value: any) => T | Promise<T>, onRejected: (error: any) => any, options: Omit<FetchInterceptorOptions, 'onFulfilled' | 'onRejected'>): number {
        this.handlers.push({
            onFulfilled,
            onRejected,
            synchronous: options ? options.synchronous : false,
            runWhen: options ? options.runWhen : undefined
        });

        return this.handlers.length - 1;
    }

    /**
     * Remove an interceptor from the stack
     *
     * @param { number } id The ID that was returned by `use`
     *
     * @returns { void }
     */
    eject(id: number): void {
        if (this.handlers[id]) {
            this.handlers[id] = null;
        }
    }

    /**
     * Clear all interceptors from the stack
     *
     * @returns { void }
     */
    clear(): void {
        if (this.handlers) {
            this.handlers = [];
        }
    }

    /**
     * Iterate over all the registered interceptors
     *
     * This method is particularly useful for skipping over any
     * interceptors that may have become `null` calling `eject`.
     *
     * @param { (fn: (handler: any) => void) } fn The function to call for each interceptor
     *
     * @returns { void }
     */
    forEach(fn: (handler: FetchInterceptorOptions) => void): void {
        this.handlers.forEach((handler) => {
            if (handler !== null) {
                fn(handler);
            }
        })
    }
}