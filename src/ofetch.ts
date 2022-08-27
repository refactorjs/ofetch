import type { FetchConfig, FetchInterceptorManager } from './types'
import { $fetch as ohmyfetch, $Fetch, SearchParams } from 'ohmyfetch'
import InterceptorManager from './adapters/InterceptorManager'

class FetchInstance {
    [key: string]: any;

    #$fetch: $Fetch;
    #configDefaults: FetchConfig;

    interceptors: {
        request: FetchInterceptorManager<FetchConfig>
        response: FetchInterceptorManager<Promise<any>>;
    };

    constructor(config?: FetchConfig, instance = ohmyfetch) {
        this.#configDefaults = {
            url: '',
            ...config
        }

        this.interceptors = {
            request: new InterceptorManager(),
            response: new InterceptorManager()
        }

        this.#$fetch = instance
        this.#createMethods()
    }

    #createMethods(): void {
        for (const method of ['get', 'head', 'delete', 'post', 'put', 'patch', 'options']) {
            Object.assign(this, {
                ['$' + method]: async (request: any, options: FetchConfig): Promise<any> => {
                    let config: FetchConfig = { ...this.getDefaults(), ...options }

                    config.url = request;
                    config.method = method

                    if (config && config.params) {
                        config.params = cleanParams(config.params)
                    }

                    const configURL = config.url instanceof Request ? request.url : config.url

                    if (/^https?/.test(configURL)) {
                        delete config.baseURL
                    }

                    const requestInterceptorChain: Array<any> = [];
                    let synchronousRequestInterceptors = true;
                    
                    this.interceptors.request.forEach((interceptor: any) => {
                        if (typeof interceptor.runWhen === 'function' && interceptor.runWhen(config) === false) {
                            return;
                        }

                        synchronousRequestInterceptors = synchronousRequestInterceptors && interceptor.synchronous;
                        requestInterceptorChain.unshift(interceptor.fulfilled, interceptor.rejected);
                    });

                    const responseInterceptorChain: Array<any> = [];
                    this.interceptors.response.forEach((interceptor: any) => {

                        responseInterceptorChain.push(interceptor.fulfilled, interceptor.rejected);
                    });

                    let promise: Promise<any>;
                    let i = 0;
                    let len: number;

                    if (!synchronousRequestInterceptors) {
                        const chain = [this.#dispatchRequest.bind(this), undefined]
                        chain.unshift.apply(chain, requestInterceptorChain);
                        chain.push.apply(chain, responseInterceptorChain);
                        len = chain.length;

                        promise = Promise.resolve(config);

                        while (i < len) {
                            promise = promise.then(chain[i++], chain[i++]);
                        }

                        return promise;
                    }

                    len = requestInterceptorChain.length;

                    let newConfig = config;

                    i = 0;

                    while (i < len) {
                        const onFulfilled = requestInterceptorChain[i++];
                        const onRejected = requestInterceptorChain[i++];
                        try {
                            newConfig = await onFulfilled(newConfig);
                        } catch (error) {
                            onRejected.call(this, error);
                            break;
                        }
                    }

                    try {
                        promise = this.#dispatchRequest.call(this, newConfig)
                    } catch (error) {
                        return Promise.reject(error);
                    }

                    i = 0;
                    len = responseInterceptorChain.length;

                    while (i < len) {
                        promise = promise.then(responseInterceptorChain[i++], responseInterceptorChain[i++]);
                    }

                    return promise;
                },
                [method]: (request: any, options: FetchConfig): any => {
                    options = { ...options, raw: true }

                    return this['$' + method](request, options)
                }
            })
        }
    }

    #dispatchRequest(config: FetchConfig): Promise<any> {
        const controller = new AbortController();
        const timeoutSignal = setTimeout(() => controller.abort(), config.timeout);
        const $fetchInstance = this.getFetch()

        clearTimeout(timeoutSignal);

        if (config.raw) {
            return $fetchInstance.raw(config.url as RequestInfo | Request, {
                method: config.method,
                signal: controller.signal,
                ...config
            })
        }

        return $fetchInstance(config.url as RequestInfo | Request, {
            method: config.method,
            signal: controller.signal,
            ...config
        })

    }

    getFetch(): $Fetch {
        return this.#$fetch
    }

    getDefaults(): FetchConfig {
        return this.#configDefaults
    }

    getBaseURL(): string | undefined {
        return this.#configDefaults.baseURL
    }

    setBaseURL(baseURL: string): void {
        this.#configDefaults.baseURL = baseURL
    }

    setHeader(name: string, value: string | null): void {
        this.#configDefaults.headers = this.#configDefaults?.headers ? new Headers(this.#configDefaults.headers) : new Headers()

        if (!value) {
            this.#configDefaults.headers.delete(name);
        } else {
            this.#configDefaults.headers.set(name, value)
        }
    }

    setToken(token: string, type: string): void {
        const value = !token ? null : (type ? type + ' ' : '') + token
        this.setHeader('Authorization', value)
    }

    onRequest(fn: (config: FetchConfig) => number): void {
        this.interceptors.request.use((config: FetchConfig) => fn(config) || config)
    }

    onResponse(fn: (response: any) => any): void {
        this.interceptors.response.use((response: any) => fn(response) || response)
    }

    onRequestError(fn: (error: any) => any): void {
        this.interceptors.request.use(undefined, (error: any) => fn(error) || Promise.reject(error))
    }

    onResponseError(fn: (error: any) => any): void {
        this.interceptors.response.use(undefined, (error: any) => fn(error) || Promise.reject(error))
    }

    create(options: FetchConfig): FetchInstance {
        return createInstance({ ...this.getDefaults(), ...options })
    }
}

const cleanParams = (params: SearchParams) => {
    const cleanValues = [null, undefined, '']
    const cleanedParams = { ...params };
    Object.keys(cleanedParams).forEach(key => {
        if (cleanValues.includes(cleanedParams[key]) || (Array.isArray(cleanedParams[key]) && !cleanedParams[key].length)) {
            delete cleanedParams[key];
        }
    });

    return cleanedParams;
}

export function createInstance(config?: FetchConfig, instance?: $Fetch): FetchInstance {
    // Create new Fetch instance
    return new FetchInstance(config, instance)
}

export const $fetch = createInstance