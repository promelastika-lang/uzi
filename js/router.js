// Простая навигация по адресу после «#».
import { useState, useEffect } from '../vendor/standalone.module.js';

const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const currentPath = () => decodeURIComponent(location.hash.replace(/^#/, '')) || '/';

export function useRoute() {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const fn = () => setPath(currentPath());
    listeners.add(fn);
    window.addEventListener('popstate', fn);
    window.addEventListener('hashchange', fn);
    return () => {
      listeners.delete(fn);
      window.removeEventListener('popstate', fn);
      window.removeEventListener('hashchange', fn);
    };
  }, []);
  return path;
}

const idx = () => (history.state && history.state.idx) || 0;

export function navigate(path) {
  history.pushState({ idx: idx() + 1 }, '', '#' + path);
  window.scrollTo(0, 0);
  emit();
}

/** Заменить текущий экран (без записи в историю). */
export function replace(path) {
  history.replaceState({ idx: idx() }, '', '#' + path);
  window.scrollTo(0, 0);
  emit();
}

/** Назад; если истории нет (открыли по прямой ссылке) — на запасной экран. */
export function back(fallback = '/') {
  if (idx() > 0) history.back();
  else replace(fallback);
}
