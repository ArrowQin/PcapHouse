import apiClient from './client';
import { Tag } from '../types';

export const tagApi = {
  getTags: () =>
    apiClient.get<Tag[]>('/tags'),

  createTag: (data: { name: string; color: string }) =>
    apiClient.post<Tag>('/tags', data),

  updateTag: (id: number, data: { name?: string; color?: string }) =>
    apiClient.patch<Tag>(`/tags/${id}`, data),

  deleteTag: (id: number) =>
    apiClient.delete(`/tags/${id}`),
};
