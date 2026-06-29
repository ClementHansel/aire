import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeProvider';

// ─── Test helper component ───────────────────────────────────────────────────

function ThemeConsumer() {
  const { mode, toggle, setMode, isSystemPreference } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="is-system">{String(isSystemPreference)}</span>
      <button data-testid="toggle" onClick={toggle}>Toggle</button>
      <button data-testid="set-dark" onClick={() => setMode('dark')}>Dark</button>
      <button data-testid="set-light" onClick={() => setMode('light')}>Light</button>
    </div>
  );
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

let mockMediaQueryMatches = false;
let mockMediaQueryListeners: Array<(e: MediaQueryListEvent) => void> = [];

function createMockMediaQueryList() {
  return {
    matches: mockMediaQueryMatches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_event: string, handler: (e: MediaQueryListEvent) => void) => {
      mockMediaQueryListeners.push(handler);
    },
    removeEventListener: (_event: string, handler: (e: MediaQueryListEvent) => void) => {
      mockMediaQueryListeners = mockMediaQueryListeners.filter(h => h !== handler);
    },
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
}

beforeEach(() => {
  // Clear localStorage
  localStorage.clear();
  // Reset media query mock
  mockMediaQueryMatches = false;
  mockMediaQueryListeners = [];
  // Reset DOM attributes
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-transition');
  // Mock matchMedia
  vi.stubGlobal('matchMedia', vi.fn(() => createMockMediaQueryList()));
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ThemeProvider', () => {
  describe('default behavior', () => {
    it('defaults to light mode (Req 42.2)', () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      expect(screen.getByTestId('mode').textContent).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('applies data-theme attribute to document root', () => {
      // System detection returns light (mocked), so set explicit stored preference
      localStorage.setItem('aire-theme-mode', 'dark');

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });

  describe('toggle functionality', () => {
    it('toggles from light to dark', () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      expect(screen.getByTestId('mode').textContent).toBe('light');

      act(() => {
        screen.getByTestId('toggle').click();
      });

      expect(screen.getByTestId('mode').textContent).toBe('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('toggles from dark to light', () => {
      // Set stored preference so it starts in dark
      localStorage.setItem('aire-theme-mode', 'dark');

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      expect(screen.getByTestId('mode').textContent).toBe('dark');

      act(() => {
        screen.getByTestId('toggle').click();
      });

      expect(screen.getByTestId('mode').textContent).toBe('light');
    });
  });

  describe('setMode', () => {
    it('sets mode explicitly to dark', () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      act(() => {
        screen.getByTestId('set-dark').click();
      });

      expect(screen.getByTestId('mode').textContent).toBe('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('sets isSystemPreference to false when user sets mode', () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      act(() => {
        screen.getByTestId('set-dark').click();
      });

      expect(screen.getByTestId('is-system').textContent).toBe('false');
    });
  });

  describe('persistence (Req 42.3)', () => {
    it('persists preference to localStorage', () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      act(() => {
        screen.getByTestId('set-dark').click();
      });

      expect(localStorage.getItem('aire-theme-mode')).toBe('dark');
    });

    it('uses custom storage key', () => {
      render(
        <ThemeProvider storageKey="custom-key">
          <ThemeConsumer />
        </ThemeProvider>,
      );

      act(() => {
        screen.getByTestId('set-dark').click();
      });

      expect(localStorage.getItem('custom-key')).toBe('dark');
    });

    it('restores preference from localStorage on mount', () => {
      localStorage.setItem('aire-theme-mode', 'dark');

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      expect(screen.getByTestId('mode').textContent).toBe('dark');
    });
  });

  describe('system preference detection', () => {
    it('detects system dark mode preference', () => {
      mockMediaQueryMatches = true;

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      expect(screen.getByTestId('mode').textContent).toBe('dark');
      expect(screen.getByTestId('is-system').textContent).toBe('true');
    });

    it('does not follow system preference when user has explicit preference stored', () => {
      mockMediaQueryMatches = true;
      localStorage.setItem('aire-theme-mode', 'light');

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      expect(screen.getByTestId('mode').textContent).toBe('light');
      expect(screen.getByTestId('is-system').textContent).toBe('false');
    });

    it('responds to system preference changes when no explicit user preference', () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      expect(screen.getByTestId('mode').textContent).toBe('light');

      // Simulate system preference change to dark
      act(() => {
        mockMediaQueryListeners.forEach(handler =>
          handler({ matches: true } as MediaQueryListEvent),
        );
      });

      expect(screen.getByTestId('mode').textContent).toBe('dark');
    });

    it('ignores system preference changes when user set explicit preference', () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      // User explicitly chooses light
      act(() => {
        screen.getByTestId('set-light').click();
      });

      // System changes to dark — should NOT follow
      act(() => {
        mockMediaQueryListeners.forEach(handler =>
          handler({ matches: true } as MediaQueryListEvent),
        );
      });

      expect(screen.getByTestId('mode').textContent).toBe('light');
    });

    it('can disable system detection', () => {
      mockMediaQueryMatches = true;

      render(
        <ThemeProvider enableSystemDetection={false}>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      // Should stay on default (light) regardless of system preference
      expect(screen.getByTestId('mode').textContent).toBe('light');
    });
  });

  describe('no-reload theme switching (Req 42.7)', () => {
    it('applies transition attribute during theme change', () => {
      vi.useFakeTimers();

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      act(() => {
        screen.getByTestId('toggle').click();
      });

      // Transition attribute should be present briefly
      expect(document.documentElement.hasAttribute('data-theme-transition')).toBe(true);

      // After timeout, transition attribute is removed
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(document.documentElement.hasAttribute('data-theme-transition')).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('useTheme hook', () => {
    it('throws error when used outside ThemeProvider', () => {
      // Suppress React error boundary console output
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<ThemeConsumer />);
      }).toThrow('useTheme must be used within a ThemeProvider');

      consoleSpy.mockRestore();
    });
  });
});
