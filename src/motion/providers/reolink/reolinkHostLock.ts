const hostChains = new Map<string, Promise<unknown>>();

/** Serialize Reolink api.cgi calls per host (NVRs misbehave under parallel WhiteLed probes). */
export function withReolinkHostLock<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const key = host.trim().toLowerCase() || 'default';
    const previous = hostChains.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    hostChains.set(key, run);
    void run.finally(() => {
        if (hostChains.get(key) === run) {
            hostChains.delete(key);
        }
    });
    return run;
}
