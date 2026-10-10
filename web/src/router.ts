import { useEffect, useState } from 'react';

export type Route = { name: 'home' } | { name: 'flight'; query: string };

export function parseRoute(pathname: string): Route {
  const m = /^\/f\/([^/]+)\/?$/.exec(pathname);
  if (m) {
    try {
      return { name: 'flight', query: decodeURIComponent(m[1]) };
    } catch {
      return { name: 'home' };
    }
  }
  return { name: 'home' };
}

/** Whether `?fixture` is in the URL: the app then runs on canned data instead of the API. */
export const isFixtureMode = (search = location.search): boolean => new URLSearchParams(search).has('fixture');

export function navigate(path: string): void {
  const url = isFixtureMode() ? `${path}${path.includes('?') ? '&' : '?'}fixture` : path;
  history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.pathname));
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return route;
}
