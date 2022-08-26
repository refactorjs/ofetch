import { InterceptorManager } from './adapters/InterceptorManager'
import { $fetch as http, $Fetch } from 'ohmyfetch'

class HttpInstance {
    #$fetch: $Fetch;
    #httpDefaults: any;
    interceptors: any;

    constructor(defaults?: any, instance?: $Fetch) {
        this.#httpDefaults = {
            ...defaults
        }

        this.interceptors = {
            request: new InterceptorManager(),
            response: new InterceptorManager()
        }

        this.#$fetch = instance ? instance : http
        this.#createMethods()
    }

    #createMethods() {
        for (const method of ['get', 'head', 'delete', 'post', 'put', 'patch', 'options']) {
            Object.assign(this, {
                ['$' + method]: async (url, options) => {
                    let config = {...this.getDefaults(), ...options}

                    if (typeof url === 'string' || url instanceof URL) {
                        config = config || {};
                        config.url = url;
                    } else {
                        config = url || {};
                    }

                    config.method = method

                    if (config && config.params) {
                        config.params = cleanParams(config.params)
                    }

                    if (/^https?/.test(url)) {
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

                    let promise;
                    let i = 0;
                    let len;

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
                [method]: (url, options) => {
                    options = { ...options, raw: true }
                    return this['$' + method](url, options)
                }
            })
        }
    }

    #dispatchRequest(config) {
        const controller = new AbortController();
        const timeoutSignal = setTimeout(() => controller.abort(), config.timeout);
        const $fetchInstance = this.getFetch()

        clearTimeout(timeoutSignal);

        if (config.raw) {
            return $fetchInstance.raw(config.url, {
                method: config.method,
                signal: controller.signal,
                ...config
            })
        }

        return $fetchInstance(config.url, {
            method: config.method,
            signal: controller.signal,
            ...config
        })

    }

    getFetch() {
        return this.#$fetch
    }

    getDefaults() {
        return this.#httpDefaults
    }

    getBaseURL() {
        return this.#httpDefaults.baseURL
    }

    setBaseURL(baseURL) {
        this.#httpDefaults.baseURL = baseURL
    }

    setHeader(name, value) {
        if (!value) {
            delete this.#httpDefaults.headers[name];
        } else {
            this.#httpDefaults.headers[name] = value
        }
    }

    setToken(token, type) {
        const value = !token ? null : (type ? type + ' ' : '') + token
        this.setHeader('Authorization', value)
    }

    onRequest(fn) {
        this.interceptors.request.use(config => fn(config) || config)
    }

    onResponse(fn) {
        this.interceptors.response.use(response => fn(response) || response)
    }

    onRequestError(fn) {
        this.interceptors.request.use(undefined, error => fn(error) || Promise.reject(error))
    }

    onResponseError(fn) {
        this.interceptors.response.use(undefined, error => fn(error) || Promise.reject(error))
    }

    create(options) {
        return createHttpInstance({ ...this.getDefaults(), ...options })
    }
}

const cleanParams = (obj) => {
    const cleanValues = [null, undefined, '']
    const cleanedObj = { ...obj };
    Object.keys(cleanedObj).forEach(key => {
        if (cleanValues.includes(cleanedObj[key]) || (Array.isArray(cleanedObj[key]) && !cleanedObj[key].length)) {
            delete cleanedObj[key];
        }
    });

    return cleanedObj;
}

export function createHttpInstance(options?: Object, instance?: any): HttpInstance {
    // Create new Fetch instance
    return new HttpInstance(options, instance)
}

export const $fetch = createHttpInstance