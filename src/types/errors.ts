/**
 * Structured Error Types for MPP
 * 
 * Provides consistent error handling and detailed error messages
 * across the application.
 */

/**
 * Base error class for all MPP errors
 */
export class MPPError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly timestamp: number;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'MPPError';
    this.code = code;
    this.details = details;
    this.timestamp = Date.now();
    
    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MPPError);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
    };
  }
}

/**
 * Strategy Engine specific errors
 */
export class StrategyEngineError extends MPPError {
  constructor(message: string, code: StrategyErrorCode, details?: Record<string, unknown>) {
    super(message, code, details);
    this.name = 'StrategyEngineError';
  }
}

export type StrategyErrorCode =
  | 'SIMULATION_FAILED'
  | 'INSUFFICIENT_DATA'
  | 'INVALID_INPUT'
  | 'CONVERGENCE_FAILED'
  | 'CALCULATION_ERROR'
  | 'TYRE_DATA_MISSING'
  | 'FUEL_DATA_MISSING'
  | 'SESSION_STATE_INVALID';

export const StrategyErrorMessages: Record<StrategyErrorCode, string> = {
  SIMULATION_FAILED: 'Monte Carlo simulation failed to complete',
  INSUFFICIENT_DATA: 'Not enough telemetry data to generate strategy recommendation',
  INVALID_INPUT: 'Invalid input parameters for strategy calculation',
  CONVERGENCE_FAILED: 'Simulation did not converge within the iteration limit',
  CALCULATION_ERROR: 'Error during strategy score calculation',
  TYRE_DATA_MISSING: 'Tyre telemetry data is missing or invalid',
  FUEL_DATA_MISSING: 'Fuel telemetry data is missing or invalid',
  SESSION_STATE_INVALID: 'Session state is invalid for strategy calculation',
};

/**
 * Authentication and Authorization errors
 */
export class AuthError extends MPPError {
  constructor(message: string, code: AuthErrorCode, details?: Record<string, unknown>) {
    super(message, code, details);
    this.name = 'AuthError';
  }
}

export type AuthErrorCode =
  | 'TOKEN_MISSING'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'PERMISSION_DENIED'
  | 'PASSWORD_REQUIRED'
  | 'PASSWORD_INVALID'
  | 'PERMISSION_CODE_REQUIRED'
  | 'PERMISSION_CODE_INVALID'
  | 'OPS_NOT_CONFIGURED';

export const AuthErrorMessages: Record<AuthErrorCode, string> = {
  TOKEN_MISSING: 'Authentication token is required',
  TOKEN_INVALID: 'Authentication token is invalid',
  TOKEN_EXPIRED: 'Authentication token has expired',
  PERMISSION_DENIED: 'You do not have permission to perform this action',
  PASSWORD_REQUIRED: 'Room password is required',
  PASSWORD_INVALID: 'Room password is incorrect',
  PERMISSION_CODE_REQUIRED: 'Permission code is required for this action',
  PERMISSION_CODE_INVALID: 'Permission code is incorrect',
  OPS_NOT_CONFIGURED: 'OPS access is not configured on this server',
};

/**
 * Session errors
 */
export class SessionError extends MPPError {
  constructor(message: string, code: SessionErrorCode, details?: Record<string, unknown>) {
    super(message, code, details);
    this.name = 'SessionError';
  }
}

export type SessionErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_STALE'
  | 'SESSION_CLOSED'
  | 'SESSION_ALREADY_EXISTS'
  | 'INVALID_SESSION_ID'
  | 'JOIN_CODE_INVALID'
  | 'SNAPSHOT_NOT_FOUND';

export const SessionErrorMessages: Record<SessionErrorCode, string> = {
  SESSION_NOT_FOUND: 'Session not found',
  SESSION_STALE: 'Session data is stale and recommendations are paused',
  SESSION_CLOSED: 'Session has been closed',
  SESSION_ALREADY_EXISTS: 'A session with this ID already exists',
  INVALID_SESSION_ID: 'Invalid session ID format',
  JOIN_CODE_INVALID: 'Invalid room join code',
  SNAPSHOT_NOT_FOUND: 'No snapshot data available for this session',
};

/**
 * Telemetry/Data errors
 */
export class TelemetryError extends MPPError {
  constructor(message: string, code: TelemetryErrorCode, details?: Record<string, unknown>) {
    super(message, code, details);
    this.name = 'TelemetryError';
  }
}

export type TelemetryErrorCode =
  | 'PARSE_ERROR'
  | 'INVALID_PACKET'
  | 'PACKET_HEADER_INVALID'
  | 'UNKNOWN_PACKET_ID'
  | 'DATA_CORRUPTION'
  | 'UDP_BIND_FAILED';

export const TelemetryErrorMessages: Record<TelemetryErrorCode, string> = {
  PARSE_ERROR: 'Failed to parse telemetry packet',
  INVALID_PACKET: 'Received invalid telemetry packet',
  PACKET_HEADER_INVALID: 'Telemetry packet header is invalid',
  UNKNOWN_PACKET_ID: 'Unknown telemetry packet ID',
  DATA_CORRUPTION: 'Telemetry data appears corrupted',
  UDP_BIND_FAILED: 'Failed to bind UDP socket',
};

/**
 * Validation errors
 */
export class ValidationError extends MPPError {
  readonly field?: string;

  constructor(message: string, field?: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', { field, ...details });
    this.name = 'ValidationError';
    this.field = field;
  }
}

/**
 * Result type for operations that can fail
 */
export type Result<T, E = MPPError> = 
  | { success: true; data: T }
  | { success: false; error: E };

export function ok<T>(data: T): Result<T, never> {
  return { success: true, data };
}

export function err<E extends MPPError>(error: E): Result<never, E> {
  return { success: false, error };
}

/**
 * Helper to create strategy errors with consistent messaging
 */
export function createStrategyError(
  code: StrategyErrorCode,
  additionalDetails?: Record<string, unknown>
): StrategyEngineError {
  return new StrategyEngineError(
    StrategyErrorMessages[code],
    code,
    additionalDetails
  );
}

/**
 * Helper to create auth errors with consistent messaging
 */
export function createAuthError(
  code: AuthErrorCode,
  additionalDetails?: Record<string, unknown>
): AuthError {
  return new AuthError(
    AuthErrorMessages[code],
    code,
    additionalDetails
  );
}

/**
 * Helper to create session errors with consistent messaging
 */
export function createSessionError(
  code: SessionErrorCode,
  additionalDetails?: Record<string, unknown>
): SessionError {
  return new SessionError(
    SessionErrorMessages[code],
    code,
    additionalDetails
  );
}

/**
 * Type guard to check if an error is an MPPError
 */
export function isMPPError(error: unknown): error is MPPError {
  return error instanceof MPPError;
}

/**
 * Convert any error to a serializable format
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof MPPError) {
    return error.toJSON();
  }
  
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  
  return {
    name: 'UnknownError',
    message: String(error),
  };
}

/**
 * Wrapper for async operations with error handling
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  errorHandler?: (error: unknown) => MPPError
): Promise<Result<T>> {
  try {
    const data = await operation();
    return ok(data);
  } catch (error) {
    if (error instanceof MPPError) {
      return err(error);
    }
    
    if (errorHandler) {
      return err(errorHandler(error));
    }
    
    return err(new MPPError(
      error instanceof Error ? error.message : 'Unknown error occurred',
      'UNKNOWN_ERROR',
      { originalError: serializeError(error) }
    ));
  }
}

/**
 * Sync version of withErrorHandling
 */
export function withErrorHandlingSync<T>(
  operation: () => T,
  errorHandler?: (error: unknown) => MPPError
): Result<T> {
  try {
    const data = operation();
    return ok(data);
  } catch (error) {
    if (error instanceof MPPError) {
      return err(error);
    }
    
    if (errorHandler) {
      return err(errorHandler(error));
    }
    
    return err(new MPPError(
      error instanceof Error ? error.message : 'Unknown error occurred',
      'UNKNOWN_ERROR',
      { originalError: serializeError(error) }
    ));
  }
}
