import type { FetchInterceptorOptions } from '../types'

export default class InterceptorManager<V> {
    handlers: Array<any>

    constructor() {
        this.handlers = []
    }

    /**
     * Add a new interceptor to the stack
     *
     * @param { (value: V) => T | Promise<T> } fulfilled The function to handle `then` for a `Promise`
     * @param { (error: any) => any } rejected The function to handle `reject` for a `Promise`
     *
     * @return { number } An ID used to remove interceptor later
     */
    use<T = V>(fulfilled: (value: V) => T | Promise<T>, rejected: (error: any) => any, options: FetchInterceptorOptions): number {
        this.handlers.push({
            fulfilled,
            rejected,
            synchronous: options ? options.synchronous : false,
            runWhen: options ? options.runWhen : null
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
    forEach(fn: (handler: any) => void): void {
        this.handlers.forEach((handler: any) => {
            if (handler !== null) {
                fn(handler);
            }
        })
    }
}