import ApiError from "../utils/ApiError.js";

const errorHandler = (
    err,
    req,
    res,
    next
) => {

    let error = err;

    if (!(error instanceof ApiError)) {
        error = new ApiError(
            500,
            err.message || "Internal Server Error"
        );
    }

    // Mongoose Validation Error
    if (err.name === "ValidationError") {
        const messages = Object.values(err.errors).map(
            (val) => val.message
        );

        error = new ApiError(
            400,
            "Validation Error",
            messages
        );
    }

    // Invalid Mongo ID
    if (err.name === "CastError") {
        error = new ApiError(
            400,
            "Invalid ID"
        );
    }

    // Duplicate Key Error
    if (err.code === 11000) {
        const field = Object.keys(err.keyValue)[0];

        error = new ApiError(
            400,
            `${field} already exists`
        );
    }

    return res.status(error.statusCode).json({
        success: false,
        statusCode: error.statusCode,
        message: error.message,
        errors: error.errors || [],
        stack:
            process.env.NODE_ENV === "development"
                ? err.stack
                : undefined,
    });
};

export default errorHandler;