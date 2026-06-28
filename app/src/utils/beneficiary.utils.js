export function validateBeneficiaryInput(accountNumber, nickname) {
    if (!accountNumber || !nickname) {
        throw new ApiError(400, "Account number and nickname are required");
    }

    const trimmed = nickname.trim();

    if (trimmed.length < 2 || trimmed.length > 50) {
        throw new ApiError(400, "Nickname must be between 2 and 50 characters");
    }

    if (!/^[a-zA-Z0-9 _'-]+$/.test(trimmed)) {
        throw new ApiError(400, "Nickname contains invalid characters");
    }
}