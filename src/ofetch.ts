import type { FetchConfig, FetchInterceptorManager, RequestInfo, MakeRequired } from './types'
import { $fetch as ofetch, $Fetch, SearchParameters, FetchResponse } from 'ofetch'
import InterceptorManager from './adapters/InterceptorManager'
import { getCookie, getCookies } from './utils'
import { defu } from 'defu'

export class FetchInstance {
    #$fetch: $Fetch;
    #configDefaults: FetchConfig;

    interceptors: {
        request: FetchInterceptorManager<FetchConfig>
        response: FetchInterceptorManager<Promise<any>>;
    };

    constructor(config: FetchConfig = {}, instance = ofetch) {
        this.#configDefaults = {
            xsrfCookieName: 'XSRF-TOKEN',
            xsrfHeaderName: 'X-XSRF-TOKEN',
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

        config.method = config.method?.toUpperCase()

        if (/^https?/.test(config.url)) {
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
    }

    #dispatchRequest(config: FetchConfig): Promise<FetchResponse<any> | any> {
        const controller = new AbortController();
        const timeoutSignal = setTimeout(() => controller.abort(), config.timeout);
        const $ofetch = this.getFetch()

        // add XSRF header to request
        config = this.#addXSRFHeader(config as MakeRequired<FetchConfig, 'headers'>)

        if (config.params || config.query) {
            config.query = config.params = serializeQuery(config.query || config.params as SearchParameters)
        }

        clearTimeout(timeoutSignal);

        if (config.native) {
            return fetch(config.url, {
                signal: controller.signal,
                ...config as RequestInit
            })
        }

        if (config.raw) {
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

    Object.keys(params).forEach(key => {
        if (clean.includes(params[key]) || (Array.isArray(params[key]) && !params[key].length)) {
            delete params[key];
        }
    });

    const queries = Object.fromEntries(Object.entries(params).map(([key, value]) => {
        if (Array.isArray(value)) {
            return [`${key}[]`, value]
        }

        return [key, value]
    }))

    return queries
}

export function createInstance(config?: FetchConfig, instance?: $Fetch): FetchInstance {
    // Create new Fetch instance
    return new FetchInstance(config, instance)
}

export const $fetch = createInstance