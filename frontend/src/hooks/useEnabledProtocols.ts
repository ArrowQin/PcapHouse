import { useEffect, useState } from 'react';
import { protocolApi } from '../api/protocols';

/**
 * Fetches the list of user-enabled protocol short-names (lowercased) once
 * per hook instance and exposes it as a Set for O(1) membership checks.
 *
 * - `undefined` → still loading (or load failed). Consumers should treat
 *   this as "fall back to default selection" (i.e. check everything), not
 *   as "nothing is enabled".
 * - `Set<string>` → ready to use.
 *
 * On failure we silently resolve to an empty set rather than surfacing an
 * error — the confirmation modal is still perfectly usable, it just won't
 * pre-check detected chips.
 */
export function useEnabledProtocols(): Set<string> | undefined {
  const [enabled, setEnabled] = useState<Set<string> | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    protocolApi
      .getEnabledNames()
      .then((res) => {
        if (!mounted) return;
        setEnabled(new Set(res.data.map((n) => n.toLowerCase())));
      })
      .catch(() => {
        if (!mounted) return;
        setEnabled(new Set());
      });
    return () => {
      mounted = false;
    };
  }, []);

  return enabled;
}
