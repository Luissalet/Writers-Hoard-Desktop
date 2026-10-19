// Incorporated views keep their route locally. Writer Desktop owns the window's
// hash (HashRouter); no module may replace it with its former standalone route.
const states = new Map<string, { hash: string; events: EventTarget; window: Window }>();

export function nativeWindow(module: string): Window {
  const saved = states.get(module);
  if (saved) return saved.window;
  const state = { hash: '', events: new EventTarget(), window: window };
  const location = new Proxy(window.location, {
    get(target, key) { return key === 'hash' ? state.hash : Reflect.get(target, key, target); },
    set(target, key, value) {
      if (key !== 'hash') return Reflect.set(target, key, value, target);
      const hash = String(value);
      const normalized = hash && !hash.startsWith('#') ? '#' + hash : hash;
      if (normalized === state.hash) return true;
      state.hash = normalized;
      state.events.dispatchEvent(new Event('hashchange'));
      window.dispatchEvent(new CustomEvent('writer:publishing-route', { detail: { module, hash: state.hash } }));
      return true;
    },
  });
  state.window = new Proxy(window, {
    get(target, key) {
      if (key === 'location') return location;
      if (key === 'addEventListener' || key === 'removeEventListener') return (type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => {
        const owner = type === 'hashchange' ? state.events : target;
        if (key === 'addEventListener') owner.addEventListener(type, listener, options);
        else owner.removeEventListener(type, listener, options);
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' && ['dispatchEvent', 'getSelection', 'open'].includes(String(key)) ? value.bind(target) : value;
    },
  });
  states.set(module, state);
  return state.window;
}

export function setNativeRoute(module: string, hash: string): void { nativeWindow(module).location.hash = hash; }
