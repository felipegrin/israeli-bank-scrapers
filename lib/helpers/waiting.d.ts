export declare class TimeoutError extends Error {
}
export declare const SECOND = 1000;
export declare function waitUntil(asyncTest: () => Promise<any>, description?: string, timeout?: number, interval?: number): Promise<any>;
export declare function raceTimeout(ms: number, promise: Promise<any>): Promise<any>;
export declare function runSerial<T>(actions: (() => Promise<T>)[]): Promise<T[]>;
