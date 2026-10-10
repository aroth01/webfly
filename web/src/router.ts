import { useCallback, useEffect, useState } from 'react';

export type Route = { name: 'input' } | { name: 'flight'; query: string };

export function parseRoute(path: string): Route {
  const m = /^\/f\/([^/]+)\/?$/.exec(path);
  return m ? { name: 'flight', query: decodeURIComponent(m[1] as string) } : { name: 'input' };
}

/** Minimal history-API router: "/" and "/f/:query" (deep-linkable, spec §9.1). */
export function useRouter(): { route: Route; navigate: (path: string, replace?: boolean) => void } {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string, replace = false) => {
    if (replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setPath(to);
    window.scrollTo(0, 0);
  }, []);
  return { route: parseRoute(path), navigate };
}
