'use client';

import { useEffect, useRef } from 'react';
import { useI18n } from '@/lib/i18n';

interface SelectAllCheckboxProps {
  /** Every selectable id in the list this control governs. */
  allIds: string[];
  /** The currently-selected ids (may be a superset that includes ids outside allIds). */
  selectedIds: string[];
  /** Called with the next full selection when the user toggles select-all. */
  onChange: (next: string[]) => void;
  /** Optional label override (defaults to a localized "Select all"). */
  label?: string;
  className?: string;
}

/**
 * A "Select all" header for a multi-select checkbox list. Reflects all / none /
 * indeterminate state and, on toggle, either adds every id or removes just the
 * ids it governs (selections outside `allIds` are left untouched). Renders
 * nothing when there is nothing to select.
 */
export function SelectAllCheckbox({ allIds, selectedIds, onChange, label, className }: SelectAllCheckboxProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLInputElement>(null);

  const allChecked = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));
  const someChecked = allIds.some((id) => selectedIds.includes(id));

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = someChecked && !allChecked;
  }, [someChecked, allChecked]);

  if (allIds.length === 0) return null;

  const toggle = () => {
    if (allChecked) {
      onChange(selectedIds.filter((id) => !allIds.includes(id)));
    } else {
      onChange(Array.from(new Set([...selectedIds, ...allIds])));
    }
  };

  return (
    <label className={`flex items-center gap-2 text-sm font-medium py-0.5 mb-1 pb-1.5 border-b border-border cursor-pointer ${className ?? ''}`}>
      <input ref={ref} type="checkbox" checked={allChecked} onChange={toggle} />
      <span>{label ?? t('common.selectAll', 'Select all')}</span>
    </label>
  );
}
