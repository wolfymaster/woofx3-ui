import { useQuery, useMutation, useQueryClient, type UseQueryOptions, type UseMutationOptions } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { PaginatedResponse, ApiError } from '@/types';

export function useApiQuery<T>(
  key: (string | number | undefined)[],
  endpoint: string,
  params?: Record<string, string | number | boolean | undefined>,
  options?: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>
) {
  return useQuery<T, ApiError>({
    queryKey: key,
    queryFn: ({ signal }) => apiClient.get<T>(endpoint, params, signal),
    staleTime: 30000,
    refetchOnWindowFocus: false,
    ...options,
  });
}

export function usePaginatedQuery<T>(
  key: (string | number | undefined)[],
  endpoint: string,
  page: number = 1,
  pageSize: number = 20,
  filters?: Record<string, string | number | boolean | undefined>,
  options?: Omit<UseQueryOptions<PaginatedResponse<T>, ApiError>, 'queryKey' | 'queryFn'>
) {
  return useQuery<PaginatedResponse<T>, ApiError>({
    queryKey: [...key, page, pageSize, filters],
    queryFn: ({ signal }) => apiClient.get<PaginatedResponse<T>>(endpoint, { page, pageSize, ...filters }, signal),
    staleTime: 30000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    ...options,
  });
}

export function useApiMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options?: Omit<UseMutationOptions<TData, ApiError, TVariables>, 'mutationFn'>
) {
  return useMutation<TData, ApiError, TVariables>({
    mutationFn,
    ...options,
  });
}

export function useCreateMutation<T, TVariables = Partial<T>>(
  endpoint: string,
  invalidateKeys?: string[][],
  options?: Omit<UseMutationOptions<T, ApiError, TVariables>, 'mutationFn'>
) {
  const queryClient = useQueryClient();

  return useMutation<T, ApiError, TVariables>({
    mutationFn: (data) => apiClient.post<T>(endpoint, data),
    onSuccess: () => {
      invalidateKeys?.forEach((key) => {
        queryClient.invalidateQueries({ queryKey: key });
      });
    },
    ...options,
  });
}

export function useUpdateMutation<T, TVariables = Partial<T>>(
  getEndpoint: (id: string) => string,
  invalidateKeys?: string[][],
  options?: Omit<UseMutationOptions<T, ApiError, { id: string; data: TVariables }>, 'mutationFn'>
) {
  const queryClient = useQueryClient();

  return useMutation<T, ApiError, { id: string; data: TVariables }>({
    mutationFn: ({ id, data }) => apiClient.patch<T>(getEndpoint(id), data),
    onSuccess: () => {
      invalidateKeys?.forEach((key) => {
        queryClient.invalidateQueries({ queryKey: key });
      });
    },
    ...options,
  });
}

export function useDeleteMutation(
  getEndpoint: (id: string) => string,
  invalidateKeys?: string[][],
  options?: Omit<UseMutationOptions<void, ApiError, string>, 'mutationFn'>
) {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, string>({
    mutationFn: (id) => apiClient.delete(getEndpoint(id)),
    onSuccess: () => {
      invalidateKeys?.forEach((key) => {
        queryClient.invalidateQueries({ queryKey: key });
      });
    },
    ...options,
  });
}
