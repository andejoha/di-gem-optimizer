import apiClient from './apiClient';
import type {
  GemInfo,
  HealthResponse,
  OptimizeRequest,
  OptimizeResponse,
} from '../types/api';
import type { ProgressEvent } from '../types/progress';

export async function getHealth(): Promise<HealthResponse> {
  const { data } = await apiClient.get<HealthResponse>('/api/health');
  return data;
}

export async function getGemData(): Promise<GemInfo[]> {
  const { data } = await apiClient.get<GemInfo[]>('/api/gem-data');
  return data;
}

export async function optimize(
  request: OptimizeRequest,
  enableUpgrades: boolean = false,
  convert1Star: boolean = false,
): Promise<OptimizeResponse> {
  const { data } = await apiClient.post<OptimizeResponse>(
    '/api/optimize',
    request,
    { params: { enable_upgrades: enableUpgrades, convert_1star: convert1Star } },
  );
  return data;
}

export async function optimizeWithProgress(
  request: OptimizeRequest,
  enableUpgrades: boolean,
  convert1Star: boolean,
  onProgress: (event: ProgressEvent) => void,
): Promise<OptimizeResponse> {
  const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
  const params = new URLSearchParams({
    enable_upgrades: String(enableUpgrades),
    convert_1star: String(convert1Star),
  });

  const response = await fetch(`${baseUrl}/api/optimize/stream?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Optimization request failed (${response.status})`);
  }
  if (!response.body) {
    throw new Error('No response body from server');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by double newlines.
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      const eventType = block.match(/^event: (.+)$/m)?.[1];
      const dataLine = block.match(/^data: (.+)$/m)?.[1];
      if (!dataLine) continue;

      if (eventType === 'progress') {
        onProgress(JSON.parse(dataLine) as ProgressEvent);
      } else if (eventType === 'result') {
        return JSON.parse(dataLine) as OptimizeResponse;
      } else if (eventType === 'error') {
        const errBody = JSON.parse(dataLine) as { detail?: string };
        throw new Error(errBody.detail ?? 'Optimization failed');
      }
    }
  }

  throw new Error('Stream ended without a result');
}
