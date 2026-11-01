import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderTree, Plus, Edit3, Trash2, X, FileText, Lock } from 'lucide-react';
import { categoryApi } from '../api/categories';
import { Category } from '../types';
import PageHeader from '../components/common/PageHeader';

const CategoriesPage: React.FC = () => {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await categoryApi.getCategories();
      setCategories(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = useCallback(() => {
    setEditing(null);
    setName('');
    setDescription('');
    setShowModal(true);
  }, []);

  const openEdit = useCallback((c: Category) => {
    setEditing(c);
    setName(c.name);
    setDescription(c.description || '');
    setShowModal(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;

    if (editing) {
      await categoryApi.updateCategory(editing.id, { name, description });
    } else {
      await categoryApi.createCategory({ name, description });
    }

    setShowModal(false);
    setEditing(null);
    setName('');
    setDescription('');
    load();
  }, [name, description, editing, load]);

  const handleDelete = useCallback(
    async (c: Category) => {
      if (c.is_builtin) return; // built-in categories cannot be deleted
      const msg = c.file_count > 0
        ? `"${c.name}" contains ${c.file_count} file(s). Delete it? Files will be moved to uncategorized.`
        : `Delete category "${c.name}"?`;
      if (!window.confirm(msg)) return;
      await categoryApi.deleteCategory(c.id);
      load();
    },
    [load]
  );

  const handleOpenCategory = useCallback(
    (c: Category) => {
      navigate(`/files?category_id=${c.id}`);
    },
    [navigate]
  );

  return (
    <div className="h-full overflow-y-auto pr-1">
      {/* Page Header */}
      <PageHeader
        icon={<FolderTree size={24} className="text-primary" />}
        title="Categories"
        description="Organize your pcap files into custom categories"
        action={
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            New Category
          </button>
        }
      />

      {/* Category Grid */}
      {loading && categories.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-muted-dark">
          <p className="text-sm">Loading categories…</p>
        </div>
      ) : categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-dark">
          <FolderTree size={48} className="mb-4 opacity-30" />
          <p className="text-lg font-medium mb-1">No categories yet</p>
          <p className="text-sm mb-6">Create categories to group related pcap files together</p>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            Create First Category
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {categories.map((c) => (
            <div
              key={c.id}
              onClick={() => handleOpenCategory(c)}
              className="group cursor-pointer rounded-xl bg-dark-700 border border-dark-600 p-5 hover:border-primary/50 hover:bg-dark-600/50 transition-all duration-200"
            >
              <div className="flex items-start mb-3">
                <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <FolderTree size={22} className="text-primary" />
                </div>
              </div>

              <h3 className="text-base font-semibold text-white truncate mb-1 flex items-center gap-2">
                <span className="truncate">{c.name}</span>
                {c.is_builtin && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium flex-shrink-0"
                    title="Built-in category (cannot be deleted)"
                  >
                    <Lock size={10} />
                    Built-in
                  </span>
                )}
              </h3>
              <p className="text-xs text-muted line-clamp-2 mb-4 min-h-[2rem]">
                {c.description || 'No description'}
              </p>

              <div className="flex items-center justify-between pt-3 border-t border-dark-600">
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <FileText size={13} />
                  <span>{c.file_count} file{c.file_count === 1 ? '' : 's'}</span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(c);
                    }}
                    className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition-all"
                    title={c.is_builtin ? 'Edit description (name is locked)' : 'Edit'}
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (c.is_builtin) return;
                      handleDelete(c);
                    }}
                    disabled={c.is_builtin}
                    className={`p-1.5 rounded-lg transition-all ${
                      c.is_builtin
                        ? 'text-muted-dark/40 cursor-not-allowed'
                        : 'text-muted hover:text-danger hover:bg-danger/10'
                    }`}
                    title={c.is_builtin ? 'Built-in category cannot be deleted' : 'Delete'}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-dark-700 rounded-xl border border-dark-600 p-6 w-[440px] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-white">
                {editing ? 'Edit Category' : 'Create New Category'}
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
                <label className="block text-xs font-medium text-muted mb-1.5">
                  Name <span className="text-danger">*</span>
                  {editing?.is_builtin && (
                    <span className="ml-2 text-muted-dark font-normal">
                      (built-in, cannot be renamed)
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  placeholder="e.g. Network Troubleshooting"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSave()}
                  autoFocus={!editing?.is_builtin}
                  disabled={editing?.is_builtin}
                  className="w-full px-4 py-2.5 rounded-lg bg-dark-600 border border-dark-500 text-white text-sm placeholder-muted-dark focus:border-primary focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Description</label>
                <textarea
                  placeholder="Optional description of this category"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-lg bg-dark-600 border border-dark-500 text-white text-sm placeholder-muted-dark focus:border-primary focus:outline-none resize-none"
                />
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
                disabled={!name.trim()}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editing ? 'Save Changes' : 'Create Category'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CategoriesPage;
