import crypto from "crypto";

export const generateAccountNumber = () => {
    return crypto.randomInt(
        1000000000,
        9999999999
    ).toString();
};


export const maskAccountNumber = (accountNumber) => {
    const lastFourDigits = accountNumber.slice(-4);
    return `**** **** **** ${lastFourDigits}`;
}