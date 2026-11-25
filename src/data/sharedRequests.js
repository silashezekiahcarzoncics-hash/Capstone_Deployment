// Coalesce identical in-flight reads while preserving independent caller cancellation.
// A component unmount must not cancel another component's request.
export function createSharedRequests() {
    const pending = new Map();
    function run(key, signal, load) {
        if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        let entry = pending.get(key);
        if (!entry) {
            const controller = new AbortController();
            entry = { controller, users: 0, promise: null };
            const current = entry;
            pending.set(key, current);
            current.promise = Promise.resolve().then(() => load(controller.signal)).finally(() => {
                if (pending.get(key) === current) pending.delete(key);
            });
        }
        const current = entry;
        current.users++;
        return new Promise((resolve, reject) => {
            let finished = false;
            function finish(callback, value) {
                if (finished) return;
                finished = true;
                signal?.removeEventListener('abort', abort);
                current.users--;
                callback(value);
            }
            function abort() {
                finish(reject, signal.reason || new DOMException('Aborted', 'AbortError'));
                if (current.users === 0) {
                    if (pending.get(key) === current) pending.delete(key);
                    current.controller.abort();
                }
            }
            signal?.addEventListener('abort', abort, { once: true });
            current.promise.then(value => finish(resolve, value), error => finish(reject, error));
        });
    }
    // Old callers may finish, but new callers cannot join a pre-invalidation read.
    function clear() { pending.clear(); }
    return { run, clear };
}
