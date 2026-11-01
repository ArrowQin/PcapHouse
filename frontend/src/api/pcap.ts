import apiClient from './client';
import { PcapFrame, FrameDetail, HexDumpData } from '../types';

export const pcapApi = {
  getFrames: (fileId: number, params: { offset?: number; limit?: number; filter?: string } = {}) =>
    apiClient.get<{ frames: PcapFrame[]; total: number }>(`/pcap/${fileId}/frames`, { params }),

  getFrameDetail: (fileId: number, frameNum: number) =>
    apiClient.get<FrameDetail>(`/pcap/${fileId}/frame/${frameNum}`),

  getHexDump: (fileId: number, frameNum: number) =>
    apiClient.get<HexDumpData>(`/pcap/${fileId}/hexdump/${frameNum}`),
};
