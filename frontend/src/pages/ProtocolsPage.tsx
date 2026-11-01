import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Radar,
  Search,
  Check,
  RotateCcw,
  Save,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import PageHeader from '../components/common/PageHeader';
import { protocolApi, ProtocolConfig } from '../api/protocols';
import {
  CATEGORIES,
  CATEGORY_BY_ID,
  CategoryId,
  classifyProtocol,
  groupProtocolsByCategory,
} from '../utils/protocolCategories';

/**
 * Protocols management page.
 *
 * Lets the user curate which protocol short-names (as reported by sharkd)
 * should be treated as "of interest" when a freshly uploaded pcap goes
 * through the confirmation modal. Enabled protocols get pre-checked; the
 * rest are shown but unchecked.
 *
 * UX: the full sharkd catalog is fetched (typically 3000+ entries), rendered
 * as a searchable, virtualized-ish checkbox grid. Changes are batched locally
 * and committed on "Save changes" via a single bulk endpoint call.
 */
const ProtocolsPage: React.FC = () => {
  const [catalog, setCatalog] = useState<string[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [configs, setConfigs] = useState<ProtocolConfig[]>([]);
  // Working set — lowercased protocol names currently marked as enabled.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The server-side truth, for dirty-detection.
  const [initialSelected, setInitialSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  // Category filter. `all` means don't restrict to any single category —
  // every group with at least one matching row is rendered. When a
  // specific category is chosen we only render that one section, which
  // keeps the page compact when the user knows what they're after.
  const [category, setCategory] = useState<CategoryId | 'all'>('all');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadingCatalog(true);
    setCatalogError(null);
    try {
      const [catRes, cfgRes] = await Promise.all([
        protocolApi.getCatalog(),
        protocolApi.getConfigs(),
      ]);
      setCatalog(catRes.data.protocols);
      setConfigs(cfgRes.data);
      const enabled = new Set(
        cfgRes.data.filter((c) => c.enabled).map((c) => c.name)
      );
      setSelected(enabled);
      setInitialSelected(new Set(enabled));
      if (catRes.data.protocols.length === 0) {
        setCatalogError(
          'sharkd returned an empty protocol list. The daemon may be unavailable — install Wireshark or check the backend logs.'
        );
      }
    } catch (e) {
      setCatalogError(
        e instanceof Error ? e.message : 'Failed to load protocol catalog'
      );
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Union of {sharkd catalog} ∪ {already-configured names}. Some user-enabled
  // names may not appear in the catalog (e.g. the user pre-configured them
  // before sharkd was available), so we merge to avoid losing them in the UI.
  const allNames = useMemo(() => {
    const s = new Set<string>(catalog);
    for (const c of configs) s.add(c.name);
    return Array.from(s).sort();
  }, [catalog, configs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allNames.filter((n) => {
      if (q && !n.includes(q)) return false;
      if (filter === 'enabled' && !selected.has(n)) return false;
      if (filter === 'disabled' && selected.has(n)) return false;
      if (category !== 'all' && classifyProtocol(n) !== category) return false;
      return true;
    });
  }, [allNames, query, filter, selected, category]);

  // Category → count over the full (unfiltered) name set, for the chip
  // labels. We compute against `allNames` intentionally so the chip
  // numbers stay stable while the user is narrowing down via search /
  // enabled-filter, which matches how the user thinks about categories.
  const categoryCounts = useMemo(() => {
    const m = new Map<CategoryId, number>();
    for (const n of allNames) {
      const id = classifyProtocol(n);
      m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [allNames]);

  // Grouped view for rendering. We only show groups that actually have
  // visible rows, which avoids empty section headers when search narrows
  // things down.
  const groups = useMemo(
    () => groupProtocolsByCategory(visible),
    [visible]
  );

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const n of visible) next.add(n);
      return next;
    });
  };

  const clearAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const n of visible) next.delete(n);
      return next;
    });
  };

  const dirty = useMemo(() => {
    if (selected.size !== initialSelected.size) return true;
    for (const n of selected) if (!initialSelected.has(n)) return true;
    return false;
  }, [selected, initialSelected]);

  const reset = () => {
    setSelected(new Set(initialSelected));
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await protocolApi.bulkSet(Array.from(selected));
      setConfigs(res.data);
      const enabled = new Set(
        res.data.filter((c) => c.enabled).map((c) => c.name)
      );
      setSelected(enabled);
      setInitialSelected(new Set(enabled));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto pr-1 flex flex-col">
      <PageHeader
        icon={<Radar size={24} className="text-primary" />}
        title="Protocols"
        description="Curate which protocols are pre-selected when confirming the detection result for newly uploaded pcap files. Enabled protocols are checked by default; others are shown but left unchecked."
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={reset}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-muted hover:text-white hover:bg-dark-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RotateCcw size={14} />
              Reset
            </button>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-xl bg-dark-700 border border-dark-600 px-4 py-3">
          <div className="text-[11px] text-muted-dark uppercase tracking-wider">
            Total in catalog
          </div>
          <div className="text-2xl font-semibold text-white mt-0.5">
            {loadingCatalog ? '—' : allNames.length}
          </div>
        </div>
        <div className="rounded-xl bg-dark-700 border border-dark-600 px-4 py-3">
          <div className="text-[11px] text-muted-dark uppercase tracking-wider">
            Enabled
          </div>
          <div className="text-2xl font-semibold text-primary mt-0.5">
            {selected.size}
          </div>
        </div>
        <div className="rounded-xl bg-dark-700 border border-dark-600 px-4 py-3">
          <div className="text-[11px] text-muted-dark uppercase tracking-wider">
            Unsaved changes
          </div>
          <div
            className={`text-2xl font-semibold mt-0.5 ${
              dirty ? 'text-amber-400' : 'text-muted-dark'
            }`}
          >
            {dirty ? 'Yes' : 'No'}
          </div>
        </div>
      </div>

      {catalogError && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <div>{catalogError}</div>
        </div>
      )}

      {/* Search + filter */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-dark"
          />
          <input
            type="text"
            placeholder="Search protocol name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-dark-700 border border-dark-600 text-sm text-white placeholder:text-muted-dark focus:border-primary focus:outline-none transition-colors"
          />
        </div>
        <div className="inline-flex rounded-lg bg-dark-700 border border-dark-600 p-0.5">
          {(['all', 'enabled', 'disabled'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                filter === f
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button
            onClick={selectAllVisible}
            disabled={visible.length === 0}
            className="px-3 py-1.5 rounded-md text-xs text-muted hover:text-white hover:bg-dark-600 transition-colors disabled:opacity-40"
            title="Enable all currently visible protocols"
          >
            Enable visible
          </button>
          <button
            onClick={clearAllVisible}
            disabled={visible.length === 0}
            className="px-3 py-1.5 rounded-md text-xs text-muted hover:text-white hover:bg-dark-600 transition-colors disabled:opacity-40"
            title="Disable all currently visible protocols"
          >
            Disable visible
          </button>
        </div>
      </div>

      {/* Category chips — rough grouping over the sharkd catalog.
          The mapping is best-effort (see utils/protocolCategories) and
          anything unrecognized lands in "Other". Counts reflect the
          full catalog, not the current search/enabled filter, so the
          chips stay stable while the user is narrowing down. */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <button
          onClick={() => setCategory('all')}
          className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
            category === 'all'
              ? 'bg-primary/15 text-primary border-primary/40'
              : 'bg-dark-700 text-muted-dark border-dark-600 hover:text-white hover:border-dark-500'
          }`}
        >
          All categories
          <span className="ml-1.5 text-[10px] opacity-70">
            {allNames.length}
          </span>
        </button>
        {CATEGORIES.map((c) => {
          const count = categoryCounts.get(c.id) ?? 0;
          if (count === 0) return null;
          const active = category === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setCategory(active ? 'all' : c.id)}
              title={c.hint}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                active
                  ? `${c.accentBg} ${c.accent} ${c.accentBorder}`
                  : 'bg-dark-700 text-muted-dark border-dark-600 hover:text-white hover:border-dark-500'
              }`}
            >
              {c.label}
              <span className="ml-1.5 text-[10px] opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Grouped grid */}
      {loadingCatalog ? (
        <div className="flex items-center justify-center py-20 text-muted-dark gap-2">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Loading protocol catalog…</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-dark">
          <Radar size={40} className="mb-3 opacity-30" />
          <p className="text-sm">No protocols match this filter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-[11px] text-muted-dark px-1">
            Showing {visible.length} of {allNames.length}
            {category !== 'all' && (
              <>
                {' '}
                in <span className={CATEGORY_BY_ID[category].accent}>
                  {CATEGORY_BY_ID[category].label}
                </span>
              </>
            )}
          </div>
          {groups.map(({ category: meta, names }) => {
            const enabledInGroup = names.filter((n) => selected.has(n)).length;
            // Per-group bulk actions act only on the names in that
            // section — useful when you want to e.g. enable all
            // industrial protocols without touching anything else.
            const enableGroup = () => {
              setSelected((prev) => {
                const next = new Set(prev);
                for (const n of names) next.add(n);
                return next;
              });
            };
            const disableGroup = () => {
              setSelected((prev) => {
                const next = new Set(prev);
                for (const n of names) next.delete(n);
                return next;
              });
            };
            return (
              <section
                key={meta.id}
                className={`rounded-xl bg-dark-700 border ${meta.accentBorder} overflow-hidden`}
              >
                <header
                  className={`flex items-center justify-between gap-2 px-3 py-2 ${meta.accentBg} border-b ${meta.accentBorder}`}
                >
                  <div className="flex items-baseline gap-2 min-w-0">
                    <h3
                      className={`text-sm font-semibold ${meta.accent} truncate`}
                      title={meta.hint}
                    >
                      {meta.label}
                    </h3>
                    <span className="text-[11px] text-muted-dark">
                      {enabledInGroup}/{names.length} enabled
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={enableGroup}
                      className="px-2 py-0.5 rounded text-[11px] text-muted hover:text-white hover:bg-dark-600 transition-colors"
                      title="Enable all in this category"
                    >
                      Enable all
                    </button>
                    <button
                      onClick={disableGroup}
                      className="px-2 py-0.5 rounded text-[11px] text-muted hover:text-white hover:bg-dark-600 transition-colors"
                      title="Disable all in this category"
                    >
                      Disable all
                    </button>
                  </div>
                </header>
                <div className="p-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
                    {names.map((name) => {
                      const on = selected.has(name);
                      return (
                        <button
                          key={name}
                          onClick={() => toggle(name)}
                          className={
                            'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors text-left ' +
                            (on
                              ? 'bg-primary/15 text-primary border-primary/40 hover:bg-primary/25'
                              : 'bg-dark-800 text-muted-dark border-dark-500 hover:text-white hover:border-dark-400')
                          }
                          title={on ? 'Click to disable' : 'Click to enable'}
                        >
                          <span
                            className={
                              'w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0 border transition-colors ' +
                              (on
                                ? 'bg-primary border-primary text-white'
                                : 'border-dark-400')
                            }
                          >
                            {on && <Check size={10} strokeWidth={3} />}
                          </span>
                          <span className="truncate">{name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProtocolsPage;
