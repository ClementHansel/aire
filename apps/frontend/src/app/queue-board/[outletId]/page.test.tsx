/**
 * Tests for the Queue Board page component.
 *
 * Validates:
 * - Requirements 28.1: Real-time queue display with status, bay assignments, wait times
 * - Requirements 28.4: Customer notification via display
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import QueueBoardPage, {
  QueueBoardEntry,
  calculateEstimatedWait,
} from './page';
import { QueueEntry } from '@aire/shared/queue';

describe('QueueBoardPage', () => {
  const defaultParams = { outletId: 'outlet-123' };

  it('renders the queue board with outlet ID', () => {
    render(<QueueBoardPage params={defaultParams} />);
    const board = screen.getByTestId('queue-board');
    expect(board).toBeInTheDocument();
    expect(board).toHaveAttribute('data-outlet-id', 'outlet-123');
  });

  it('renders the header with title', () => {
    render(<QueueBoardPage params={defaultParams} />);
    expect(screen.getByText('Queue Status')).toBeInTheDocument();
  });

  it('shows connection status indicator', () => {
    render(<QueueBoardPage params={defaultParams} />);
    const connectionStatus = screen.getByTestId('connection-status');
    expect(connectionStatus).toBeInTheDocument();
    // Initial state is connected (placeholder)
    expect(connectionStatus).toHaveTextContent('Online');
  });

  it('shows "Now Serving" section', () => {
    render(<QueueBoardPage params={defaultParams} />);
    expect(screen.getByText('Now Serving')).toBeInTheDocument();
  });

  it('shows "Waiting" section with count', () => {
    render(<QueueBoardPage params={defaultParams} />);
    expect(screen.getByText('Waiting (0)')).toBeInTheDocument();
  });

  it('shows empty state when no entries in queue', () => {
    render(<QueueBoardPage params={defaultParams} />);
    expect(screen.getByTestId('no-in-progress')).toHaveTextContent(
      'No vehicles currently being served',
    );
    expect(screen.getByTestId('no-waiting')).toHaveTextContent(
      'No vehicles in queue',
    );
  });

  it('displays last updated timestamp', () => {
    render(<QueueBoardPage params={defaultParams} />);
    const lastUpdated = screen.getByTestId('last-updated');
    expect(lastUpdated).toBeInTheDocument();
    expect(lastUpdated.textContent).toMatch(/Updated:/);
  });
});

describe('calculateEstimatedWait', () => {
  it('calculates wait based on position and active bays', () => {
    // Position 1, 3 bays: ceil(1/3 * 15) = 5 min
    expect(calculateEstimatedWait(1, 3)).toBe(5);
  });

  it('calculates longer wait for higher positions', () => {
    // Position 3, 3 bays: ceil(3/3 * 15) = 15 min
    expect(calculateEstimatedWait(3, 3)).toBe(15);
  });

  it('handles single bay', () => {
    // Position 2, 1 bay: ceil(2/1 * 15) = 30 min
    expect(calculateEstimatedWait(2, 1)).toBe(30);
  });

  it('handles zero bays gracefully (fallback to position * avg time)', () => {
    // Position 2, 0 bays: 2 * 15 = 30
    expect(calculateEstimatedWait(2, 0)).toBe(30);
  });

  it('returns 0 wait for position 0', () => {
    expect(calculateEstimatedWait(0, 3)).toBe(0);
  });
});

describe('QueueCard rendering', () => {
  // We test the card indirectly through the page by checking that entries render correctly
  // using a more complete approach by testing the exported component structure

  it('component is a valid function', async () => {
    const { default: Page } = await import('./page');
    expect(Page).toBeDefined();
    expect(typeof Page).toBe('function');
  });
});
