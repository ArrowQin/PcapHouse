import apiClient from './client';
import { Category } from '../types';

export const categoryApi = {
  getCategories: () =>
    apiClient.get<Category[]>('/categories'),

  createCategory: (data: { name: string; description?: string }) =>
    apiClient.post<Category>('/categories', data),

  updateCategory: (id: number, data: { name?: string; description?: string }) =>
    apiClient.patch<Category>(`/categories/${id}`, data),

  deleteCategory: (id: number) =>
    apiClient.delete(`/categories/${id}`),
};
