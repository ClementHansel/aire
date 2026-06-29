import { BayStatus, MachineStatus } from '../enums';

/**
 * Bay sensor data from IoT devices.
 */
export interface BaySensorData {
  vehiclePresent: boolean;
  waterFlow: number;
  foamLevel: number;
  machineStatus: MachineStatus;
}

/**
 * Bay status data transfer object.
 * GET /api/bays
 */
export interface BayStatusDTO {
  id: string;
  outletId: string;
  name: string;
  status: BayStatus;
  currentOrderId?: string;
  sensorData: BaySensorData;
  /** ISO 8601 timestamp of last status update */
  lastUpdated: string;
}

/**
 * Assign order to bay request.
 * POST /api/bays/:id/assign
 */
export interface AssignBayRequest {
  orderId: string;
}

/**
 * Bay query parameters.
 * GET /api/bays
 */
export interface BayQueryParams {
  outletId?: string;
  status?: BayStatus;
}
