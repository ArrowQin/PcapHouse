import apiClient from './client';
import { GenerateRequest, GenerateTask, SupportedProtocol } from '../types';

export const generatorApi = {
  /** Kick off a new pcap generation task. */
  generate(data: GenerateRequest) {
    return apiClient.post<GenerateTask>('/generator/generate', data);
  },

  /** List recent generation tasks (newest first). */
  getTasks(limit = 20) {
    return apiClient.get<GenerateTask[]>('/generator/tasks', { params: { limit } });
  },

  /** Get a single task by ID (for polling). */
  getTask(taskId: number) {
    return apiClient.get<GenerateTask>(`/generator/tasks/${taskId}`);
  },

  /** List all supported protocol handlers. */
  getSupportedProtocols() {
    return apiClient.get<SupportedProtocol[]>('/generator/protocols');
  },
};
