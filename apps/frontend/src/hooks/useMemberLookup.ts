/**
 * Hook for performing member lookup by phone or license plate.
 * Calls GET /api/members/lookup and returns member data.
 *
 * Requirements: 6.5, 12.1, 12.2, 12.3
 */
import { useState, useCallback } from 'react';
import { MemberLookupResponse } from '@aire/shared/interfaces/member';

export interface UseMemberLookupOptions {
  /** Base URL for API calls. Defaults to '/api'. */
  baseUrl?: string;
}

export interface UseMemberLookupResult {
  /** The member lookup response data, or null if not yet looked up */
  data: MemberLookupResponse | null;
  /** Whether a lookup request is in progress */
  loading: boolean;
  /** Error message if the lookup failed */
  error: string | null;
  /** Perform a lookup by phone number */
  lookupByPhone: (phone: string) => Promise<MemberLookupResponse | null>;
  /** Perform a lookup by license plate */
  lookupByPlate: (plate: string) => Promise<MemberLookupResponse | null>;
  /** Perform a lookup by phone or plate (auto-detects) */
  lookup: (phone: string, plate: string) => Promise<MemberLookupResponse | null>;
  /** Clear the current lookup result */
  clear: () => void;
}

/**
 * Performs member lookup via GET /api/members/lookup.
 * Prefers phone for lookup when both are provided; falls back to plate.
 */
export function useMemberLookup(
  options: UseMemberLookupOptions = {},
): UseMemberLookupResult {
  const { baseUrl = '/api' } = options;

  const [data, setData] = useState<MemberLookupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLookup = useCallback(
    async (params: URLSearchParams): Promise<MemberLookupResponse | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `${baseUrl}/members/lookup?${params.toString()}`,
        );

        if (!response.ok) {
          if (response.status === 404) {
            setData(null);
            setError('Customer not found');
            return null;
          }
          const errorBody = await response.json().catch(() => ({}));
          const message =
            errorBody.message || `Lookup failed (${response.status})`;
          setError(message);
          return null;
        }

        const result: MemberLookupResponse = await response.json();
        setData(result);
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Network error';
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [baseUrl],
  );

  const lookupByPhone = useCallback(
    async (phone: string): Promise<MemberLookupResponse | null> => {
      if (!phone.trim()) {
        setError('Phone number is required');
        return null;
      }
      const params = new URLSearchParams({ phone: phone.trim() });
      return fetchLookup(params);
    },
    [fetchLookup],
  );

  const lookupByPlate = useCallback(
    async (plate: string): Promise<MemberLookupResponse | null> => {
      if (!plate.trim()) {
        setError('License plate is required');
        return null;
      }
      const params = new URLSearchParams({ plate: plate.trim() });
      return fetchLookup(params);
    },
    [fetchLookup],
  );

  const lookup = useCallback(
    async (
      phone: string,
      plate: string,
    ): Promise<MemberLookupResponse | null> => {
      // Prefer phone lookup when available
      if (phone.trim()) {
        return lookupByPhone(phone);
      }
      if (plate.trim()) {
        return lookupByPlate(plate);
      }
      setError('Provide a phone number or license plate to look up');
      return null;
    },
    [lookupByPhone, lookupByPlate],
  );

  const clear = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return {
    data,
    loading,
    error,
    lookupByPhone,
    lookupByPlate,
    lookup,
    clear,
  };
}
