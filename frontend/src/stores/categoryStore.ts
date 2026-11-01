import { create } from 'zustand';
import { Category } from '../types';
import { categoryApi } from '../api/categories';

interface CategoryStore {
  categories: Category[];
  loading: boolean;
  fetchCategories: () => Promise<void>;
  createCategory: (name: string, description?: string) => Promise<void>;
  deleteCategory: (id: number) => Promise<void>;
}

export const useCategoryStore = create<CategoryStore>((set) => ({
  categories: [],
  loading: false,

  fetchCategories: async () => {
    set({ loading: true });
    const res = await categoryApi.getCategories();
    set({ categories: res.data, loading: false });
  },

  createCategory: async (name, description) => {
    const res = await categoryApi.createCategory({ name, description });
    set((state) => ({ categories: [...state.categories, res.data] }));
  },

  deleteCategory: async (id) => {
    await categoryApi.deleteCategory(id);
    set((state) => ({
      categories: state.categories.filter((c) => c.id !== id),
    }));
  },
}));
