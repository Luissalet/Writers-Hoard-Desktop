import { useLocation } from 'react-router-dom';

/**
 * Reads a deep-link query parameter from the current route.
 *
 * Anchor adapters have always composed URLs like
 * `/project/:id/codex?entry=<id>` — global search, Cmd+K results and
 * annotation backlinks all navigate through them. Nothing on the receiving end
 * ever read those parameters, so following a search hit or a backlink opened
 * the right engine tab and then just sat there on the dashboard, leaving the
 * author to find the record by hand. This hook is the missing half.
 *
 * Two deliberate choices:
 *
 *  • **It reads the hash too.** The app can run under a hash route, where the
 *    query string lives after the `#` and `location.search` is empty.
 *
 *  • **It does NOT strip the parameter.** Consuming it out of the URL would
 *    make the value vanish a render later — before engines whose rows arrive
 *    asynchronously (map pins, writings) have had anything to match it
 *    against. Leaving it in also means a refresh or a back-navigation still
 *    lands on the same record, which is what a deep link should do.
 *
 * Because the value is stable for as long as the URL is, **callers must guard
 * against re-applying it** — either with the render-adjust pattern (compare
 * against an `applied` state) or with a ref. Otherwise every unrelated
 * re-render would drag the author back to the linked record.
 *
 * @param name query parameter to watch, e.g. `'entry'`, `'writing'`, `'pin'`.
 */
export function useDeepLinkParam(name: string): string | null {
  const location = useLocation();

  const search =
    location.search ||
    (location.hash.includes('?') ? `?${location.hash.split('?').slice(1).join('?')}` : '');

  return new URLSearchParams(search).get(name);
}
