
/**
 * Custom error class for API errors.
 * - statusCode: HTTP status code (e.g., 400, 404, 500)
 * - message: Error message to be sent in the response
 * - errors: Optional array of detailed error messages (e.g., validation errors)
 */

class ApiError extends Error {
    constructor(
        statusCode,
        message = "Something went wrong",
        errors = []
    ) {
        super(message);

        this.success = false;
        this.statusCode = statusCode;
        this.errors = errors;

        Error.captureStackTrace(this, this.constructor);
    }
}

export default ApiError;