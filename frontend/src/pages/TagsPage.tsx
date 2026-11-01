import React, { useEffect, useState, useCallback } from 'react';
import { Tags, Plus, Edit3, Trash2, X, Shuffle } from 'lucide-react';
import { tagApi } from '../api/tags';
import { Tag } from '../types';
import PageHeader from '../components/common/PageHeader';

// Return a random, pleasantly-saturated hex color. We stay in HSL space
// (fixed S/L) so every roll looks good against both the preview chip
// background (color+`20`) and the dark card behind it — pure RGB random
// would give us muddy near-blacks or near-whites on some rolls.
const randomColor = (): string => {
  const hue = Math.floor(Math.random() * 360);
  const s = 70; // percent
  const l = 55; // percent
  // HSL → RGB (standard conversion).
  const c = ((1 - Math.abs((2 * l) / 100 - 1)) * s) / 100;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l / 100 - c / 2;
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
};

// Accepts `#rgb` or `#rrggbb` (case-insensitive) and normalizes to
// 7-char uppercase `#RRGGBB`. Used to sanitize hex-text input before
// pushing it to state / the <input type="color"> control (which is
// strict about the format).
const normalizeHex = (raw: string): string | null => {
  const m = raw.trim().match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return `#${hex.toUpperCase()}`;
};

const TagsPage: React.FC = () => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [tagName, setTagName] = useState('');
  // Seeded with a random color so that even the very first open of the
  // modal in a page lifetime doesn't always look identical.
  const [tagColor, setTagColor] = useState<string>(() => randomColor());
  // Free-form text buffer for the hex input. Kept separate from
  // `tagColor` so that users can type intermediate values like "#3B"
  // without us clobbering it on every keystroke.
  const [hexInput, setHexInput] = useState<string>(tagColor);

  const loadTags = useCallback(async () => {
    const res = await tagApi.getTags();
    setTags(res.data);
  }, []);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  const applyColor = useCallback((color: string) => {
    setTagColor(color);
    setHexInput(color);
  }, []);

  const handleSave = useCallback(async () => {
    if (!tagName.trim()) return;

    if (editingTag) {
      await tagApi.updateTag(editingTag.id, { name: tagName, color: tagColor });
    } else {
      await tagApi.createTag({ name: tagName, color: tagColor });
    }

    setShowModal(false);
    setEditingTag(null);
    setTagName('');
    // Re-roll so the next open doesn't remember the last-used color.
    applyColor(randomColor());
    loadTags();
  }, [tagName, tagColor, editingTag, loadTags, applyColor]);

  const handleDelete = useCallback(
    async (id: number) => {
      await tagApi.deleteTag(id);
      loadTags();
    },
    [loadTags]
  );

  const handleEdit = useCallback(
    (tag: Tag) => {
      setEditingTag(tag);
      setTagName(tag.name);
      applyColor(tag.color);
      setShowModal(true);
    },
    [applyColor]
  );

  const handleNew = useCallback(() => {
    setEditingTag(null);
    setTagName('');
    // Fresh random color on every open, per product requirement.
    applyColor(randomColor());
    setShowModal(true);
  }, [applyColor]);

  return (
    <div className="h-full overflow-y-auto pr-1">
      {/* Page Header */}
      <PageHeader
        icon={<Tags size={24} className="text-accent" />}
        title="Tags"
        description="Create and manage tags to organize your pcap files"
        action={
          <button
            onClick={handleNew}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            New Tag
          </button>
        }
      />

      {/* Tag Grid */}
      {tags.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-dark">
          <Tags size={48} className="mb-4 opacity-30" />
          <p className="text-lg font-medium mb-1">No tags created yet</p>
          <p className="text-sm">Create tags to organize your pcap files</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="rounded-xl bg-dark-700 border border-dark-600 p-4 hover:border-dark-500 transition-all duration-200 group"
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${tag.color}20` }}
                >
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{tag.name}</p>
                </div>
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleEdit(tag)}
                  className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition-all"
                >
                  <Edit3 size={14} />
                </button>
                <button
                  onClick={() => handleDelete(tag.id)}
                  className="p-1.5 rounded-lg text-muted hover:text-danger hover:bg-danger/10 transition-all"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-dark-700 rounded-xl border border-dark-600 p-6 w-96 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-white">
                {editingTag ? 'Edit Tag' : 'Create New Tag'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded text-muted hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Tag Name</label>
                <input
                  type="text"
                  placeholder="Enter tag name"
                  value={tagName}
                  onChange={(e) => setTagName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                  autoFocus
                  className="w-full px-4 py-2.5 rounded-lg bg-dark-600 border border-dark-500 text-white text-sm placeholder-muted-dark focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Color</label>
                <div className="flex items-center gap-2">
                  {/* Native color picker — clicking the swatch opens the
                      OS/browser palette. We wrap it in a label so the
                      whole colored square is clickable. */}
                  <label
                    className="relative w-11 h-11 rounded-lg border border-dark-500 overflow-hidden cursor-pointer shrink-0"
                    style={{ backgroundColor: tagColor }}
                    title="Pick color"
                  >
                    <input
                      type="color"
                      value={tagColor}
                      onChange={(e) => applyColor(e.target.value.toUpperCase())}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </label>

                  {/* Hex text input — lets power users type/paste an
                      exact value. We only commit it to `tagColor` once
                      it parses as a valid hex. */}
                  <input
                    type="text"
                    value={hexInput}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setHexInput(raw);
                      const normalized = normalizeHex(raw);
                      if (normalized) setTagColor(normalized);
                    }}
                    onBlur={() => {
                      // Snap the textbox back to the committed color
                      // if the user left a half-typed value behind.
                      const normalized = normalizeHex(hexInput);
                      setHexInput(normalized ?? tagColor);
                    }}
                    spellCheck={false}
                    className="flex-1 px-3 py-2 rounded-lg bg-dark-600 border border-dark-500 text-white text-sm font-mono placeholder-muted-dark focus:border-primary focus:outline-none"
                    placeholder="#RRGGBB"
                  />

                  <button
                    type="button"
                    onClick={() => applyColor(randomColor())}
                    title="Randomize color"
                    className="p-2 rounded-lg bg-dark-600 border border-dark-500 text-muted hover:text-white hover:border-dark-400 transition-colors"
                  >
                    <Shuffle size={16} />
                  </button>
                </div>
              </div>

              {/* Preview */}
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Preview</label>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-dark-600">
                  <span
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor: `${tagColor}20`,
                      color: tagColor,
                      border: `1px solid ${tagColor}40`,
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: tagColor }}
                    />
                    {tagName || 'Tag name'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-lg text-sm text-muted hover:text-white hover:bg-dark-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!tagName.trim()}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingTag ? 'Save Changes' : 'Create Tag'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TagsPage;
