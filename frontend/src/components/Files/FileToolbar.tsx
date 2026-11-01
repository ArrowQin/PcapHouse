import React, { useEffect, useMemo, useState } from 'react';
import {
  LayoutGrid,
  List,
  ChevronDown,
  FolderTree,
  Tag as TagIcon,
  X,
  Search,
  Radar,
} from 'lucide-react';
import { ViewMode, Tag, Category } from '../../types';

interface FileToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  tags: Tag[];
  selectedTagIds: number[];
  onTagFilter: (tagIds: number[]) => void;
  categories: Category[];
  selectedCategoryIds: number[];
  onCategoryFilter: (categoryIds: number[]) => void;
  protocolOptions: string[];
  selectedProtocols: string[];
  onProtocolFilter: (protocols: string[]) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  totalFiles: number;
}

const FileToolbar: React.FC<FileToolbarProps> = ({
  viewMode,
  onViewModeChange,
  tags,
  selectedTagIds,
  onTagFilter,
  categories,
  selectedCategoryIds,
  onCategoryFilter,
  protocolOptions,
  selectedProtocols,
  onProtocolFilter,
  searchQuery,
  onSearchChange,
  totalFiles,
}) => {
  const [tagsOpen, setTagsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [protocolsOpen, setProtocolsOpen] = useState(false);
  const [protocolSearch, setProtocolSearch] = useState('');
  const [searchInput, setSearchInput] = useState(searchQuery);

  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== searchQuery) {
        onSearchChange(searchInput);
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const selectedCategories = categories.filter((c) => selectedCategoryIds.includes(c.id));
  const selectedTags = tags.filter((t) => selectedTagIds.includes(t.id));

  // ``0`` is a client-side sentinel for the virtual "Uncategorized"
  // bucket (real category ids start at 1 in SQLite autoincrement). It's
  // sent verbatim to the backend, which splits out the sentinel and
  // turns it into ``category_id IS NULL``. Having a single source of
  // truth here keeps the label logic + toggle below honest.
  const UNCATEGORIZED_ID = 0;
  const uncategorizedSelected = selectedCategoryIds.includes(UNCATEGORIZED_ID);

  const activeFilterCount =
    selectedCategoryIds.length +
    selectedTagIds.length +
    selectedProtocols.length +
    (searchQuery ? 1 : 0);

  const toggleTag = (id: number) => {
    onTagFilter(
      selectedTagIds.includes(id)
        ? selectedTagIds.filter((x) => x !== id)
        : [...selectedTagIds, id]
    );
  };

  const toggleCategory = (id: number) => {
    onCategoryFilter(
      selectedCategoryIds.includes(id)
        ? selectedCategoryIds.filter((x) => x !== id)
        : [...selectedCategoryIds, id]
    );
  };

  const toggleProtocol = (name: string) => {
    onProtocolFilter(
      selectedProtocols.includes(name)
        ? selectedProtocols.filter((x) => x !== name)
        : [...selectedProtocols, name]
    );
  };

  const clearAll = () => {
    onCategoryFilter([]);
    onTagFilter([]);
    onProtocolFilter([]);
    onSearchChange('');
    setSearchInput('');
  };

  // "Category" button label — show the selected category name, or count.
  // The sentinel "Uncategorized" counts toward the total just like a real
  // category, and is shown by its human-readable label when picked alone.
  const totalSelectedCategories =
    selectedCategories.length + (uncategorizedSelected ? 1 : 0);
  let categoryLabel = 'All categories';
  if (totalSelectedCategories === 1) {
    categoryLabel = uncategorizedSelected
      ? 'Uncategorized'
      : selectedCategories[0].name;
  } else if (totalSelectedCategories > 1) {
    categoryLabel = `${totalSelectedCategories} categories`;
  }

  // "Tags" button label — show the first tag name, or count when many.
  let tagsLabel = 'All tags';
  if (selectedTags.length === 1) tagsLabel = selectedTags[0].name;
  else if (selectedTags.length > 1) tagsLabel = `${selectedTags.length} tags`;

  // "Protocols" button label — keep it short; show first name, or count.
  let protocolsLabel = 'All protocols';
  if (selectedProtocols.length === 1) protocolsLabel = selectedProtocols[0];
  else if (selectedProtocols.length > 1) protocolsLabel = `${selectedProtocols.length} protocols`;

  // Filter the (potentially large) protocol list by the inline search term.
  // Keep selected ones pinned to the top so users can see / uncheck them
  // even when they'd otherwise be filtered out.
  const filteredProtocols = useMemo(() => {
    const q = protocolSearch.trim().toLowerCase();
    const selectedSet = new Set(selectedProtocols);
    const base = q
      ? protocolOptions.filter((p) => p.toLowerCase().includes(q))
      : protocolOptions;
    const pinned = selectedProtocols.filter(
      (p) => !q || p.toLowerCase().includes(q)
    );
    const rest = base.filter((p) => !selectedSet.has(p));
    return [...pinned, ...rest];
  }, [protocolOptions, protocolSearch, selectedProtocols]);

  return (
    <div className="mb-4 flex items-center gap-2 flex-wrap">
      {/* Search — first slot, grows to fill available space */}
      <div className="relative flex-1 min-w-[220px] max-w-md">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-dark pointer-events-none"
        />
        <input
          type="text"
          placeholder="Search name or note..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-full h-9 pl-10 pr-9 rounded-lg bg-dark-700 border border-dark-500 text-white text-sm placeholder-muted-dark focus:border-primary focus:ring-1 focus:ring-primary/30 focus:outline-none transition-all"
        />
        {searchInput && (
          <button
            onClick={() => {
              setSearchInput('');
              onSearchChange('');
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-muted-dark hover:text-white hover:bg-dark-600 transition-colors"
            title="Clear search"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Category Filter (multi-select) — selected value rendered inline */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setCategoriesOpen((v) => !v)}
          className={`flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-lg bg-dark-700 border text-sm hover:border-dark-400 transition-all ${
            selectedCategoryIds.length > 0
              ? 'border-primary/40 text-white'
              : 'border-dark-500 text-muted'
          }`}
          title={categoryLabel}
        >
          <FolderTree size={14} className="flex-shrink-0" />
          <span className="truncate max-w-[140px]">{categoryLabel}</span>
          <ChevronDown
            size={13}
            className={`transition-transform ${categoriesOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {categoriesOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setCategoriesOpen(false)} />
            <div className="absolute z-30 mt-1 left-0 min-w-[220px] max-h-64 overflow-y-auto rounded-lg bg-dark-700 border border-dark-500 shadow-xl p-1.5">
              {selectedCategoryIds.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => onCategoryFilter([])}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-muted hover:text-white hover:bg-dark-600 transition-colors"
                  >
                    <X size={12} className="text-muted-dark" />
                    <span className="flex-1 text-left">Clear selection</span>
                  </button>
                  <div className="h-px bg-dark-600 my-1" />
                </>
              )}
              {/* Virtual "Uncategorized" entry — pinned at the top so
                  users can filter down to files without any category
                  assigned. Backed by the sentinel id 0; see the backend's
                  list_files handler for the NULL pivot. Rendered even
                  when no user-defined categories exist, since a brand-new
                  library still has uncategorized files by definition. */}
              <button
                key="__uncategorized__"
                type="button"
                onClick={() => toggleCategory(UNCATEGORIZED_ID)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                  uncategorizedSelected
                    ? 'bg-primary/15 text-white'
                    : 'text-muted hover:text-white hover:bg-dark-600'
                }`}
              >
                <FolderTree size={12} className="text-muted-dark flex-shrink-0 opacity-60" />
                <span className="flex-1 text-left truncate italic">Uncategorized</span>
                {uncategorizedSelected && (
                  <span className="text-primary text-[10px]">✓</span>
                )}
              </button>
              {categories.length === 0 ? (
                <p className="text-xs text-muted-dark text-center py-3 px-2">
                  No categories yet
                </p>
              ) : (
                <>
                  <div className="h-px bg-dark-600 my-1" />
                  {categories.map((cat) => {
                    const active = selectedCategoryIds.includes(cat.id);
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => toggleCategory(cat.id)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                          active
                            ? 'bg-primary/15 text-white'
                            : 'text-muted hover:text-white hover:bg-dark-600'
                        }`}
                      >
                        <FolderTree size={12} className="text-muted-dark flex-shrink-0" />
                        <span className="flex-1 text-left truncate">{cat.name}</span>
                        {active && <span className="text-primary text-[10px]">✓</span>}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Tag Filter (multi-select) — selected value rendered inline */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setTagsOpen((v) => !v)}
          className={`flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-lg bg-dark-700 border text-sm hover:border-dark-400 transition-all ${
            selectedTagIds.length > 0
              ? 'border-primary/40 text-white'
              : 'border-dark-500 text-muted'
          }`}
          title={tagsLabel}
        >
          <TagIcon size={14} className="flex-shrink-0" />
          <span className="truncate max-w-[120px]">{tagsLabel}</span>
          <ChevronDown
            size={13}
            className={`transition-transform ${tagsOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {tagsOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setTagsOpen(false)} />
            <div className="absolute z-30 mt-1 left-0 min-w-[200px] max-h-64 overflow-y-auto rounded-lg bg-dark-700 border border-dark-500 shadow-xl p-1.5">
              {selectedTagIds.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => onTagFilter([])}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-muted hover:text-white hover:bg-dark-600 transition-colors"
                  >
                    <X size={12} className="text-muted-dark" />
                    <span className="flex-1 text-left">Clear selection</span>
                  </button>
                  <div className="h-px bg-dark-600 my-1" />
                </>
              )}
              {tags.length === 0 ? (
                <p className="text-xs text-muted-dark text-center py-3 px-2">
                  No tags yet
                </p>
              ) : (
                tags.map((tag) => {
                  const active = selectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                        active
                          ? 'bg-primary/15 text-white'
                          : 'text-muted hover:text-white hover:bg-dark-600'
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="flex-1 text-left truncate">{tag.name}</span>
                      {active && <span className="text-primary text-[10px]">✓</span>}
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {/* Protocol Filter (multi-select with search) */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setProtocolsOpen((v) => !v)}
          className={`flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-lg bg-dark-700 border text-sm hover:border-dark-400 transition-all ${
            selectedProtocols.length > 0
              ? 'border-primary/40 text-white'
              : 'border-dark-500 text-muted'
          }`}
          title={protocolsLabel}
        >
          <Radar size={14} className="flex-shrink-0" />
          <span className="truncate max-w-[140px]">{protocolsLabel}</span>
          <ChevronDown
            size={13}
            className={`transition-transform ${protocolsOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {protocolsOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setProtocolsOpen(false)} />
            <div className="absolute z-30 mt-1 left-0 w-[240px] rounded-lg bg-dark-700 border border-dark-500 shadow-xl p-1.5">
              {/* Inline search — the protocol list can be hundreds of items
                  (the user-enabled catalog), so typing to narrow is
                  essential. The input is NOT debounced; list filtering is
                  purely client-side and cheap. */}
              <div className="relative mb-1">
                <Search
                  size={12}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-dark pointer-events-none"
                />
                <input
                  type="text"
                  placeholder="Search protocols…"
                  value={protocolSearch}
                  onChange={(e) => setProtocolSearch(e.target.value)}
                  className="w-full h-7 pl-6 pr-2 rounded bg-dark-800 border border-dark-600 text-white text-xs placeholder-muted-dark focus:border-primary focus:outline-none"
                  // Prevent the outer button click-away handler from
                  // closing the dropdown when the user clicks into the
                  // input. (Events on descendants don't bubble up to the
                  // fixed overlay, but stopping propagation is harmless.)
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              {selectedProtocols.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => onProtocolFilter([])}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-muted hover:text-white hover:bg-dark-600 transition-colors"
                  >
                    <X size={12} className="text-muted-dark" />
                    <span className="flex-1 text-left">Clear selection</span>
                  </button>
                  <div className="h-px bg-dark-600 my-1" />
                </>
              )}
              <div className="max-h-56 overflow-y-auto">
                {protocolOptions.length === 0 ? (
                  <p className="text-xs text-muted-dark text-center py-3 px-2">
                    No protocols available
                  </p>
                ) : filteredProtocols.length === 0 ? (
                  <p className="text-xs text-muted-dark text-center py-3 px-2">
                    No matches
                  </p>
                ) : (
                  filteredProtocols.map((proto) => {
                    const active = selectedProtocols.includes(proto);
                    return (
                      <button
                        key={proto}
                        type="button"
                        onClick={() => toggleProtocol(proto)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                          active
                            ? 'bg-primary/15 text-white'
                            : 'text-muted hover:text-white hover:bg-dark-600'
                        }`}
                      >
                        <Radar size={11} className="text-muted-dark flex-shrink-0" />
                        <span className="flex-1 text-left truncate font-mono">{proto}</span>
                        {active && <span className="text-primary text-[10px]">✓</span>}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* File count + Clear filters */}
      <span className="text-xs text-muted-dark ml-1">{totalFiles} files</span>
      {activeFilterCount > 0 && (
        <button
          onClick={clearAll}
          className="flex items-center gap-1 px-2 h-9 rounded text-xs text-muted hover:text-white transition-colors"
          title="Clear all filters"
        >
          <X size={12} />
          Clear
        </button>
      )}

      {/* View Mode Toggle — push to the right */}
      <div className="flex items-center bg-dark-700 rounded-lg border border-dark-500 overflow-hidden ml-auto">
        <button
          onClick={() => onViewModeChange('grid')}
          className={`p-2 transition-all ${
            viewMode === 'grid'
              ? 'bg-primary/10 text-primary'
              : 'text-muted-dark hover:text-white'
          }`}
          title="Grid view"
        >
          <LayoutGrid size={16} />
        </button>
        <button
          onClick={() => onViewModeChange('list')}
          className={`p-2 transition-all ${
            viewMode === 'list'
              ? 'bg-primary/10 text-primary'
              : 'text-muted-dark hover:text-white'
          }`}
          title="List view"
        >
          <List size={16} />
        </button>
      </div>
    </div>
  );
};

export default FileToolbar;
