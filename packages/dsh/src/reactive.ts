/**
 * DSH 响应式内核
 * 极简的信号 / 存储 / 异步事件队列，零依赖，服务端与浏览器通用。
 */

export type Unsubscribe = () => void;
export type Listener<T> = (value: T) => void;

export class Signal<T> {
  #value: T;
  #listeners = new Set<Listener<T>>();

  constructor(initial: T) {
    this.#value = initial;
  }

  get value(): T {
    return this.#value;
  }

  set(next: T): void {
    if (Object.is(next, this.#value)) return;
    this.#value = next;
    for (const l of this.#listeners) l(next);
  }

  update(fn: (prev: T) => T): void {
    this.set(fn(this.#value));
  }

  subscribe(listener: Listener<T>, immediate = false): Unsubscribe {
    this.#listeners.add(listener);
    if (immediate) listener(this.#value);
    return () => this.#listeners.delete(listener);
  }
}

/** 对象状态容器：patch 合并 + 订阅 */
export class ReactiveStore<S extends object> {
  readonly signal: Signal<S>;

  constructor(initial: S) {
    this.signal = new Signal(initial);
  }

  get state(): S {
    return this.signal.value;
  }

  patch(partial: Partial<S>): void {
    this.signal.set({ ...this.signal.value, ...partial });
  }

  subscribe(listener: Listener<S>, immediate = false): Unsubscribe {
    return this.signal.subscribe(listener, immediate);
  }
}

/** 异步事件队列：把 push 型事件源转成 async iterable（SSE / 流式渲染的桥梁） */
export class AsyncQueue<T> implements AsyncIterable<T> {
  #buffer: T[] = [];
  #waiters: ((res: IteratorResult<T>) => void)[] = [];
  #closed = false;

  push(item: T): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.#buffer.push(item);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const w of this.#waiters.splice(0)) w({ value: undefined as never, done: true });
  }

  get closed(): boolean {
    return this.#closed;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.#buffer.length) {
          return Promise.resolve({ value: this.#buffer.shift() as T, done: false });
        }
        if (this.#closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.#waiters.push(resolve));
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined as never, done: true });
      },
    };
  }
}

/** 轻量事件总线 */
export class Emitter<E> {
  #listeners = new Set<Listener<E>>();

  on(listener: Listener<E>): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(event: E): void {
    for (const l of [...this.#listeners]) {
      try {
        l(event);
      } catch {
        /* 订阅方异常不应中断主流程 */
      }
    }
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
