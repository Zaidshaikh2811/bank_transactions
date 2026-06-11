
import ApiError from "../utils/ApiError.js";


export const validateAmount = (amount, max) => {
    if (!amount || isNaN(amount)) {
        throw new ApiError(400, "Valid amount is required");
    }
    if (amount < process.env.MIN_AMOUNT) {
        throw new ApiError(400, `Minimum amount is ${process.env.MIN_AMOUNT}`);
    }
    if (amount > max) {
        throw new ApiError(400, `Maximum amount is ${max}`);
    }
    if (!/^\d+(\.\d{1,2})?$/.test(String(amount))) {
        throw new ApiError(400, "Amount can have at most 2 decimal places");
    }
};
