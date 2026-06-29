/**
 * Represents a membership plate entity (camelCase).
 */
export interface MembershipPlate {
  id: string;
  membershipId: string;
  plate: string;
  plateNormalized: string;
  brand: string | null;
  model: string | null;
  createdAt: Date;
}

/**
 * Raw row from the membership_plates table.
 */
export interface MembershipPlateRow {
  id: string;
  membership_id: string;
  plate: string;
  plate_normalized: string;
  brand: string | null;
  model: string | null;
  created_at: Date;
}
