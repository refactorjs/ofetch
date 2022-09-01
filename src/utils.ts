import { parse } from 'cookie-es'
import destr from 'destr'

export const isBrowser = typeof window === "object"

export function getCookies(): Record<string, string> {
    if (isBrowser) {
        return parse(document.cookie);
    }

    return {}
}

export function getCookie(key: string): any {
    const cookies = getCookies();
    const value = cookies[key] ? decodeURIComponent(cookies[key] as string) : undefined;

    return destr(value);
}