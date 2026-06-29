'use client';

import { useEffect, useState } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OfflineIndicatorProps {
  /** Optional className for custom styling */
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * OfflineIndicator — Shows a banner when the application is offline.
 *
 * Listens to browser online/offline events and displays a non-intrusive
 * indicator bar at the top of the viewport when connectivity is lost.
 *
 * Requirements: 5.3, 36.1 (PWA offline support)
 */
export function OfflineIndicator({ className }: OfflineIndicatorProps) {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    // Initialize from current state
    setIsOffline(!navigator.onLine);

    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={className}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '8px 16px',
        backgroundColor: 'var(--color-warning, #F59E0B)',
        color: 'var(--color-on-warning, #2E2822)',
        fontSize: 'var(--text-sm, 0.875rem)',
        fontWeight: 500,
        textAlign: 'center',
        boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.1))',
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <path
          d="M8 1C4.134 1 1 4.134 1 8s3.134 7 7 7 7-3.134 7-7-3.134-7-7-7zm0 10.5a.75.75 0 110-1.5.75.75 0 010 1.5zM8.75 8a.75.75 0 01-1.5 0V5a.75.75 0 011.5 0v3z"
          fill="currentColor"
        />
      </svg>
      <span>You are offline. Some features may be unavailable.</span>
    </div>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Hook to subscribe to online/offline status.
 * Returns `true` when the browser is offline.
 */
export function useOfflineStatus(): boolean {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    setIsOffline(!navigator.onLine);

    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  return isOffline;
}
