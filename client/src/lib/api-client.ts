import type { ApiError, PaginatedResponse } from '@/types';

export interface RequestConfig {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

export interface ApiClientConfig {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  onError?: (error: ApiError) => void;
  onUnauthorized?: () => void;
}

class ApiClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private onError?: (error: ApiError) => void;
  private onUnauthorized?: () => void;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl;
    this.defaultHeaders = config.defaultHeaders || {};
    this.onError = config.onError;
    this.onUnauthorized = config.onUnauthorized;
  }

  private buildUrl(endpoint: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }
    return url.toString();
  }

  async request<T>(endpoint: string, config: RequestConfig = {}): Promise<T> {
    const { method = 'GET', headers = {}, params, body, signal } = config;

    const url = this.buildUrl(endpoint, params);
    const requestHeaders = {
      'Content-Type': 'application/json',
      ...this.defaultHeaders,
      ...headers,
    };

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          this.onUnauthorized?.();
        }

        const errorData = await response.json().catch(() => ({
          code: 'UNKNOWN_ERROR',
          message: 'An unexpected error occurred',
        }));

        const apiError: ApiError = {
          code: errorData.code || `HTTP_${response.status}`,
          message: errorData.message || response.statusText,
          details: errorData.details,
        };

        this.onError?.(apiError);
        throw apiError;
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return response.json();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      if ((error as ApiError).code) {
        throw error;
      }
      const apiError: ApiError = {
        code: 'NETWORK_ERROR',
        message: 'Failed to connect to the server',
      };
      this.onError?.(apiError);
      throw apiError;
    }
  }

  get<T>(endpoint: string, params?: Record<string, string | number | boolean | undefined>, signal?: AbortSignal): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET', params, signal });
  }

  post<T>(endpoint: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(endpoint, { method: 'POST', body, params });
  }

  put<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: 'PUT', body });
  }

  patch<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: 'PATCH', body });
  }

  delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }
}

export const apiClient = new ApiClient({
  baseUrl: '/api',
  onError: (error) => {
    console.error('API Error:', error);
  },
  onUnauthorized: () => {
    console.warn('Unauthorized - redirecting to login');
  },
});

export function createPaginatedFetcher<T>(endpoint: string) {
  return async (page: number = 1, pageSize: number = 20, filters?: Record<string, string | number | boolean | undefined>): Promise<PaginatedResponse<T>> => {
    return apiClient.get<PaginatedResponse<T>>(endpoint, { page, pageSize, ...filters });
  };
}
