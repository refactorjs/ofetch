import type { FetchConfig, FetchInterceptorManager, RequestInfo, MakeRequired } from './types'
import { $fetch as ohmyfetch, $Fetch, SearchParams } from 'ohmyfetch'
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

    constructor(config: FetchConfig = {}, instance = ohmyfetch) {
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
                    return typeof request === 'string' ? this.request(request, { ...config, method: method, raw: true }) : this.request({ ...request, method: method, raw: true })
                }
            })
        }
    }

    requestRaw(request: RequestInfo, config?: FetchConfig) {
        return typeof request === 'string' ? this.request(request, { ...config, raw: true }) : this.request({ ...request, raw: true })
    }

    async request(request: RequestInfo, config?: FetchConfig) {
        if (typeof request === 'string') {
            config = config || {};
            config.url = request;
        } else {
            config = request;
        }

        config = defu(config, this.#configDefaults) 

        config.method = config.method?.toUpperCase()

        if (config && config.params) {
            config.params = cleanParams(config.params)
        }

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

    #dispatchRequest(config: FetchConfig): Promise<any> {
        const controller = new AbortController();
        const timeoutSignal = setTimeout(() => controller.abort(), config.timeout);
        const $fetchInstance = this.getFetch()

        // add XSRF header to request
        config = this.#addXSRFHeader(config as MakeRequired<FetchConfig, 'headers'>)

        clearTimeout(timeoutSignal);

        if (config.raw) {
            return $fetchInstance.raw(config.url, {
                signal: controller.signal,
                ...config
            })
        }

        return $fetchInstance(config.url, {
            signal: controller.signal,
            ...config
        })

    }

    #addXSRFHeader(config: MakeRequired<FetchConfig, 'headers'>): FetchConfig {
        const cookie = getCookie(config.xsrfCookieName as string)
        const cookies = getCookies()

        if (config.credentials === 'include' && config.xsrfCookieName && cookies[config.xsrfCookieName]) {
            if (config.headers.constructor.name === 'Object') {
                config.headers = new Headers(config.headers)
            }
  
            // @see https://github.com/Teranode/nuxt-module-alternatives/issues/111
            config.headers.set(config.xsrfHeaderName as string, decodeURIComponent(cookie));
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

export declare interface FetchInstance {
    $get(request: RequestInfo, config: FetchConfig): any
    $head(request: RequestInfo, config: FetchConfig): any
    $delete(request: RequestInfo, config: FetchConfig): any
    $post(request: RequestInfo, config: FetchConfig): any
    $put(request: RequestInfo, config: FetchConfig): any
    $patch(request: RequestInfo, config: FetchConfig): any
    $options(request: RequestInfo, config: FetchConfig): any
    get(request: RequestInfo, config: FetchConfig): any
    head(request: RequestInfo, config: FetchConfig): any
    delete(request: RequestInfo, config: FetchConfig): any
    post(request: RequestInfo, config: FetchConfig): any
    put(request: RequestInfo, config: FetchConfig): any
    patch(request: RequestInfo, config: FetchConfig): any
    options(request: RequestInfo, config: FetchConfig): any
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