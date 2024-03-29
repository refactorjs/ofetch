import type { FetchConfig, FetchInterceptorManager, RequestInfo, MakeRequired } from './types';
import { $fetch as ofetch, type $Fetch, type SearchParameters, type FetchResponse } from 'ofetch';
import InterceptorManager from './adapters/InterceptorManager';
import { getCookie, getCookies } from './utils';
import { defu } from 'defu';

export class FetchInstance {
    #$fetch: $Fetch;
    #configDefaults: FetchConfig;

    interceptors: {
        request: FetchInterceptorManager<FetchConfig>;
        response: FetchInterceptorManager<Promise<any>>;
    };

    constructor(config: FetchConfig = {}) {
        this.#configDefaults = {
            xsrfCookieName: 'XSRF-TOKEN',
            xsrfHeaderName: 'X-XSRF-TOKEN',
            ...config
        }

        this.interceptors = {
            request: new InterceptorManager(),
            response: new InterceptorManager()
        }

        this.#$fetch = ofetch
        this.#createMethods()
    }

    #createMethods(): void {
        for (const method of ['get', 'head', 'delete', 'post', 'put', 'patch', 'options']) {
            Object.assign(this, {
                ['$' + method]: (request: RequestInfo, config?: FetchConfig) => {
                    return typeof request === 'string' ? this.request(request, { ...config, method: method }) : this.request({ ...request, method: method })
                },
                [method]: (request: RequestInfo, config?: FetchConfig) => {
                    return typeof request === 'string' ? this.raw(request, { ...config, method: method }) : this.raw({ ...request, method: method })
                }
            })
        }
    }

    async native(request: RequestInfo, config?: FetchConfig): Promise<Response> {
        return typeof request === 'string' ? this.request(request, { ...config, native: true }) : this.request({ ...request, native: true })
    }

    async raw(request: RequestInfo, config?: FetchConfig): Promise<FetchResponse<any>> {
        return typeof request === 'string' ? this.request(request, { ...config, raw: true }) : this.request({ ...request, raw: true })
    }

    async request(request: RequestInfo, config?: FetchConfig): Promise<FetchResponse<any> | any> {
        if (typeof request === 'string') {
            config = config || {};
            config.url = request;
        } else {
            config = request;
        }

        config = defu(config, this.#configDefaults)

        // uppercase method
        config.method = config.method ? config.method.toUpperCase() : 'GET'

        if (/^https?/.test(config.url)) {
            delete config.baseURL
        }

        const requestInterceptorChain: Array<any> = [];
        let synchronousRequestInterceptors = true;

        this.interceptors.request.forEach((interceptor) => {
            if (typeof interceptor.runWhen === 'function' && interceptor.runWhen(config as FetchConfig) === false) {
                return;
            }

            synchronousRequestInterceptors = synchronousRequestInterceptors && interceptor.synchronous as boolean;
            requestInterceptorChain.unshift(interceptor.onFulfilled, interceptor.onRejected);
        });

        const responseInterceptorChain: Array<any> = [];
        this.interceptors.response.forEach((interceptor) => {

            responseInterceptorChain.push(interceptor.onFulfilled, interceptor.onRejected);
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
    }

    async #dispatchRequest(config: FetchConfig): Promise<FetchResponse<any> | any> {
        const controller = new AbortController();
        const timeoutSignal = setTimeout(() => controller.abort(), config.timeout);
        const $ofetch = this.getFetch()

        // add XSRF header to request
        config = this.#addXSRFHeader(config as MakeRequired<FetchConfig, 'headers'>)

        // uppercase method
        config.method = config.method ? config.method.toUpperCase() : 'GET'

        if (config.params) {
            config.params = serializeQuery(config.params)
        }

        if (config.query) {
            config.query = serializeQuery(config.query)
        }

        clearTimeout(timeoutSignal);

        if (config.native) {
            delete config.native
            return fetch(config.url, {
                signal: controller.signal,
                ...config as RequestInit
            })
        }

        if (config.raw) {
            delete config.raw
            return $ofetch.raw(config.url, {
                signal: controller.signal,
                ...config
            })
        }

        return $ofetch(config.url, {
            signal: controller.signal,
            ...config
        })

    }

    #addXSRFHeader(config: MakeRequired<FetchConfig, 'headers'>): FetchConfig {
        const cookie = getCookie(config.xsrfCookieName as string)
        const cookies = getCookies()

        if (config.credentials === 'include' && config.xsrfCookieName && cookies[config.xsrfCookieName]) {
            config.headers[config.xsrfHeaderName as keyof HeadersInit] = decodeURIComponent(cookie)
        }

        return config as FetchConfig
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
        this.#configDefaults.headers = this.#configDefaults?.headers ? { ...this.#configDefaults.headers } : {}

        if (!value) {
            delete this.#configDefaults.headers[name as keyof HeadersInit]
        } else {
            this.#configDefaults.headers[name as keyof HeadersInit] = value
        }
    }

    setToken(token: string, type: string): void {
        const value = !token ? null : (type ? type + ' ' : '') + token
        this.setHeader('Authorization', value)
    }

    onRequest(fn: (config: FetchConfig) => any): void {
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

export declare interface FetchInstance {
    $get(request: RequestInfo, config?: FetchConfig): Promise<any>
    $head(request: RequestInfo, config?: FetchConfig): Promise<any>
    $delete(request: RequestInfo, config?: FetchConfig): Promise<any>
    $post(request: RequestInfo, config?: FetchConfig): Promise<any>
    $put(request: RequestInfo, config?: FetchConfig): Promise<any>
    $patch(request: RequestInfo, config?: FetchConfig): Promise<any>
    $options(request: RequestInfo, config?: FetchConfig): Promise<any>
    get(request: RequestInfo, config?: FetchConfig): Promise<FetchResponse<any>>
    head(request: RequestInfo, config?: FetchConfig): Promise<FetchResponse<any>>
    delete(request: RequestInfo, config?: FetchConfig): Promise<FetchResponse<any>>
    post(request: RequestInfo, config?: FetchConfig): Promise<FetchResponse<any>>
    put(request: RequestInfo, config?: FetchConfig): Promise<FetchResponse<any>>
    patch(request: RequestInfo, config?: FetchConfig): Promise<FetchResponse<any>>
    options(request: RequestInfo, config?: FetchConfig): Promise<FetchResponse<any>>
}

function serializeQuery(params: SearchParameters) {
    const clean = [null, undefined, '']
    if (params) {
        Object.keys(params).forEach(key => {
            if (clean.includes(params[key]) || (Array.isArray(params[key]) && !params[key].length)) {
                delete params[key];
            }
        });
    
        const queries = Object.fromEntries(Object.entries(params).map(([key, value]) => {
            if (Array.isArray(value)) {
                const uniqueArray = [...new Set(value)]
                return [`${key}[]`, uniqueArray]
            }
    
            return [key, value]
        }))
    
        return queries
    }

    return {}
}

export function createInstance(config?: FetchConfig): FetchInstance {
    // Create new Fetch instance
    return new FetchInstance(config)
}

export const $fetch = createInstance