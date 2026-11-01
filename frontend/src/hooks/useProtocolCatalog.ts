import { useEffect, useState } from 'react';
import { protocolApi } from '../api/protocols';

/**
 * Module-level cache of the full sharkd/tshark protocol catalog.
 *
 * The catalog is process-stable on the backend (3000+ short-names derived
 * from `tshark -G protocols` at boot), so there is zero value in re-fetching
 * it on every modal mount. We store both the resolved list and the in-flight
 * promise so concurrent first-time callers share the same request.
 */
let cachedCatalog: string[] | null = null;
let inflight: Promise<string[]> | null = null;

async function fetchCatalogOnce(): Promise<string[]> {
  if (cachedCatalog) return cachedCatalog;
  if (inflight) return inflight;
  inflight = protocolApi
    .getCatalog()
    .then((res) => {
      cachedCatalog = (res.data.protocols || []).map((n) => n.toLowerCase());
      return cachedCatalog;
    })
    .catch(() => {
      // On failure, fall back to an empty catalog so the UI can still let
      // the user type a custom name. We do NOT cache the failure, so a
      // later attempt (e.g. after backend restart) can succeed.
      inflight = null;
      return [] as string[];
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Hook variant that exposes the catalog to React components.
 *
 * - `undefined` → still loading.
 * - `string[]`  → ready (may be empty if backend is down).
 */
export function useProtocolCatalog(): string[] | undefined {
  const [catalog, setCatalog] = useState<string[] | undefined>(
    cachedCatalog ?? undefined
  );

  useEffect(() => {
    if (cachedCatalog) {
      setCatalog(cachedCatalog);
      return;
    }
    let mounted = true;
    fetchCatalogOnce().then((names) => {
      if (mounted) setCatalog(names);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return catalog;
}
