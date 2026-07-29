import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PlateInput } from './PlateInput';

/**
 * AIRIN-117: one vehicle must have exactly one spelling everywhere. Every plate
 * field in the product routes through this component, so these tests are the
 * guarantee that no surface can reintroduce a space-preserving input.
 */
describe('PlateInput', () => {
  it('strips spaces and uppercases as the user types', () => {
    const onChange = vi.fn();
    render(<PlateInput value="" onChange={onChange} placeholder="Plate" />);
    fireEvent.change(screen.getByPlaceholderText('Plate'), { target: { value: 'b 8882 cst' } });
    expect(onChange).toHaveBeenCalledWith('B8882CST');
  });

  it('normalises regardless of where the spaces are', () => {
    const onChange = vi.fn();
    render(<PlateInput value="" onChange={onChange} placeholder="Plate" />);
    for (const raw of ['B8882 CST', ' b8882cst ', 'B  8882  CST']) {
      onChange.mockClear();
      fireEvent.change(screen.getByPlaceholderText('Plate'), { target: { value: raw } });
      expect(onChange, `input ${JSON.stringify(raw)}`).toHaveBeenCalledWith('B8882CST');
    }
  });

  it('allows the field to be cleared', () => {
    const onChange = vi.fn();
    render(<PlateInput value="B8882CST" onChange={onChange} placeholder="Plate" />);
    fireEvent.change(screen.getByPlaceholderText('Plate'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('yields empty for input with no alphanumerics rather than keeping punctuation', () => {
    const onChange = vi.fn();
    render(<PlateInput value="" onChange={onChange} placeholder="Plate" />);
    fireEvent.change(screen.getByPlaceholderText('Plate'), { target: { value: '   ' } });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('renders the controlled value verbatim so the user sees what will be stored', () => {
    render(<PlateInput value="B8882CST" onChange={() => {}} placeholder="Plate" />);
    expect((screen.getByPlaceholderText('Plate') as HTMLInputElement).value).toBe('B8882CST');
  });

  it('forwards accessibility and test hooks', () => {
    render(<PlateInput value="" onChange={() => {}} ariaLabel="License plate" testId="plate-x" />);
    expect(screen.getByLabelText('License plate')).toBeDefined();
    expect(screen.getByTestId('plate-x')).toBeDefined();
  });
});
