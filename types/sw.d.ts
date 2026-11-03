/*
 * For tsconfig.sw.json only. The webworker lib types `self` as a plain
 * WorkerGlobalScope; in sw.js it is a ServiceWorkerGlobalScope. This adds the
 * members sw.js uses, so that sw.js needs no casts.
 */
interface WorkerGlobalScope {
  readonly clients: Clients;
  skipWaiting(): Promise<void>;
  addEventListener<K extends keyof ServiceWorkerGlobalScopeEventMap>(
    type: K,
    listener: (this: ServiceWorkerGlobalScope, ev: ServiceWorkerGlobalScopeEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
}
