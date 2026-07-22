/**
 * Shared license-plate row helpers for the POS membership flows:
 *  - Sell Pack's post-payment vehicle registration step
 *  - The member-management plate editor (add/edit/remove on an existing membership)
 *
 * Both surfaces use the same "one row per vehicle, first row required, add up
 * to the plan's max_plates, remove extra rows" pattern — this module is the
 * single place that pattern is implemented and tested.
 */

export interface PlateRow {
  plate: string;
  brand: string;
  model: string;
}

/** A fresh, empty plate row. */
export function emptyPlateRow(): PlateRow {
  return { plate: '', brand: '', model: '' };
}

/** Pre-fill a first row from known vehicle info (e.g. the order's plate/brand/model). */
export function prefillPlateRow(plate?: string, brand?: string, model?: string): PlateRow {
  return { plate: plate ?? '', brand: brand ?? '', model: model ?? '' };
}

export type PlateValidation =
  | { ok: true; plates: PlateRow[] }
  | { ok: false; error: string };

/**
 * Validate a set of plate rows before submitting.
 *
 * Rule: the first row must carry a plate — a membership can't be
 * activated/saved without at least one registered vehicle. Extra blank rows
 * (added then left empty) are silently dropped rather than rejected, since a
 * cashier may add a row and change their mind.
 */
export function validatePlateRows(
  rows: PlateRow[],
  errorMessage = 'Register at least one plate.',
): PlateValidation {
  if (!rows[0] || !rows[0].plate.trim()) {
    return { ok: false, error: errorMessage };
  }
  const plates = rows.filter((r) => r.plate.trim() !== '');
  if (plates.length === 0) {
    return { ok: false, error: errorMessage };
  }
  return { ok: true, plates };
}

/** Whether another empty row can be added given the plan's max_plates (default 3). */
export function canAddPlateRow(currentCount: number, maxPlates: number | undefined): boolean {
  const max = maxPlates && maxPlates > 0 ? maxPlates : 3;
  return currentCount < max;
}
