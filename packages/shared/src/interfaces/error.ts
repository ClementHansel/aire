/**
 * Standard API error response format.
 */
export interface ErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  /** Machine-readable error code for client-side handling */
  errorCode?: string;
}

/**
 * Validation error detail for field-level errors.
 */
export interface ValidationErrorDetail {
  field: string;
  message: string;
  code: string;
}

/**
 * Extended error response with field-level validation details.
 */
export interface ValidationErrorResponse extends ErrorResponse {
  details?: ValidationErrorDetail[];
}
