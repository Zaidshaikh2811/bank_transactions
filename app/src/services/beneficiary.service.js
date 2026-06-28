import beneficiaryRepository from "../repositories/beneficiary.repository.js";
import accountRepository from "../repositories/account.repository.js";
import otpRepository from "../repositories/otp.repository.js";
import { sendOtp } from "../utils/opt.utils.js";
import { OTP_PURPOSES } from "../constants/otp.constants.js";
import ApiError from "../utils/ApiError.js";
import { ACCOUNT_STATUS } from "../constants/account.constants.js";
import idempotencyRepository from "../repositories/idempotency.repository.js";
import { IDEMPOTENCY_PURPOSES } from "../constants/idempotency.constant.js";

class BeneficiaryService {

    async addBeneficiary(userId, beneficiaryData, idempotencyKey) {

        const { accountNumber, nickname } = beneficiaryData;

        const account = await accountRepository.findByAccountNumber(accountNumber);
        console.log("Beneficiary account:", account);

        if (!account) throw new ApiError(404, "Beneficiary account not found");


        if (account.userId.toString() === userId.toString())
            throw new ApiError(400, "Cannot add your own account");

        if (account.isActive !== ACCOUNT_STATUS.ACTIVE)
            throw new ApiError(400, "Beneficiary account is not active");

        const beneficiary =
            await beneficiaryRepository.findExisting(
                userId,
                account._id
            );

        if (beneficiary) {
            if (beneficiary.isVerified) {
                throw new ApiError(
                    409,
                    "Beneficiary already exists"
                );
            }

            beneficiary.nickname = nickname;
            beneficiary.isVerified = false;

            return beneficiaryRepository.save(beneficiary);
        }

        await beneficiaryRepository.create({
            userId,
            beneficiaryAccountId: account._id,
            nickname,
            isVerified: false,
        });

        await otpRepository.deleteByPurpose(
            userId,
            OTP_PURPOSES.ADD_BENEFICIARY
        );

        const otp = await sendOtp({
            userId: account.userId,
            purpose: OTP_PURPOSES.ADD_BENEFICIARY,
            meta: {
                requesterId: userId,
                beneficiaryAccountId: account._id
            },
        });

        return {
            expiresInMinutes: process.env.OTP_TTL_MINUTES,
            maskedContact: otp.maskedContact,
        };
    }

    async confirmBeneficiaryOtp(userId, otp) {

        const otpRecord = await otpRepository.findByUserIdAndPurpose(
            userId,
            OTP_PURPOSES.ADD_BENEFICIARY
        );

        if (!otpRecord) {
            throw new ApiError(400, "No OTP found for this user");
        }
        if (otpRecord.expiresAt < new Date()) {
            await otpRecord.deleteOne();
            throw new ApiError(400, "OTP has expired. Please add the beneficiary again.");
        }
        if (!(await otpRecord.verify(otp))) {
            otpRecord.attempts += 1;
            if (otpRecord.attempts >= 3) {
                await otpRecord.deleteOne();
                throw new ApiError(429, "Too many incorrect attempts. OTP invalidated.");
            }
            await otpRecord.save();
            throw new ApiError(400, `Incorrect OTP. ${3 - otpRecord.attempts} attempt(s) remaining.`);
        }


        const beneficiary = await Beneficiary.findOneAndUpdate(
            {
                userId: otpRecord.meta.requesterId,
                beneficiaryAccountId: otpRecord.meta.beneficiaryAccountId,
                isVerified: false,
            },
            { isVerified: true },
            { new: true }
        ).populate("beneficiaryAccountId", "accountNumber accountType currency");

        if (!beneficiary) {
            throw new ApiError(404, "Pending beneficiary not found. It may have been removed.");
        }

        await otpRecord.deleteOne();

        return {
            beneficiaryId: beneficiary._id,
            accountNumber: beneficiary.beneficiaryAccountId.accountNumber,
            accountType: beneficiary.beneficiaryAccountId.accountType,
            currency: beneficiary.beneficiaryAccountId.currency,
        };

    }

    async getBeneficiaries(userId) {
        const beneficiaries = await Beneficiary.find({
            userId: userId,
            isVerified: true,
        })
            .populate("beneficiaryAccountId", "accountNumber accountType currency")
            .sort({ createdAt: -1 })
            .lean();

        const sanitized = beneficiaries.map((b) => ({
            id: b._id,
            nickname: b.nickname,
            accountNumber: maskAccountNumber(
                b.beneficiaryAccountId?.accountNumber ?? ""
            ),
            accountType: b.beneficiaryAccountId?.accountType,
            currency: b.beneficiaryAccountId?.currency,
            createdAt: b.createdAt,
        }));

        return sanitized;
    }

    async removeBeneficiary(userId, beneficiaryId) {


        const beneficiary = await beneficiaryRepository.findOne({
            _id: beneficiaryId,
            userId: userId,
            isVerified: true,
        });

        if (!beneficiary) {
            throw new ApiError(404, "Beneficiary not found");
        }

        beneficiary.isVerified = false;
        await beneficiary.save();
        return { message: "Beneficiary removed successfully" };
    }


    async transferToBeneficiary({
        userId,
        beneficiaryId,
        senderAccountId,
        amount,
        note,
        idempotencyKey,
    }) {
        const minAmount = parseFloat(process.env.MIN_AMOUNT);
        const maxAmount = parseFloat(process.env.MAX_TRANSFER_AMOUNT);
        const parsedAmount = parseFloat(amount);

        if (!/^\d+(\.\d{1,2})?$/.test(String(amount))) {
            throw new ApiError(400, "Amount must have at most 2 decimal places");
        }
        if (isNaN(parsedAmount) || parsedAmount < minAmount) {
            throw new ApiError(400, `Transfer amount must be at least ${minAmount}`);
        }
        if (parsedAmount > maxAmount) {
            throw new ApiError(400, `Transfer amount cannot exceed ${maxAmount}`);
        }


        if (idempotencyKey) {
            const existing = await idempotencyRepository.findByKey(
                userId,
                idempotencyKey,
                IDEMPOTENCY_PURPOSES.TRANSFER_TO_BENEFICIARY
            );
            if (existing) {
                return {
                    ...existing.responseBody,
                };
            }
        }

        const [senderAccount, beneficiary] = await Promise.all([
            accountRepository.findOne({
                _id: senderAccountId,
                userId,
                isActive: ACCOUNT_STATUS.ACTIVE,
            }).select("_id accountNumber balance currency"),
            beneficiaryRepository.findOne({
                _id: beneficiaryId,
                userId,
                isVerified: true,
            }).populate(
                "beneficiaryAccountId",
                "_id accountNumber accountType currency isActive balance userId"
            ),
        ]);

        if (!senderAccount) {
            throw new ApiError(404, "Sender account not found or inactive");
        }
        if (senderAccount.balance < parsedAmount) {
            throw new ApiError(400, "Insufficient balance in sender account");
        }
        if (!beneficiary) {
            throw new ApiError(404, "Beneficiary not found");
        }

        const recipientAccount = beneficiary.beneficiaryAccountId;

        if (!recipientAccount || recipientAccount.isActive !== ACCOUNT_STATUS.ACTIVE) {
            throw new ApiError(400, "Recipient account is not active");
        }
        if (senderAccount.currency !== recipientAccount.currency) {
            throw new ApiError(
                400,
                `Currency mismatch: your account is ${senderAccount.currency}, ` +
                `recipient is ${recipientAccount.currency}`
            );
        }
        if (
            senderAccount._id.equals(recipientAccount._id) ||
            recipientAccount.userId?.toString() === userId.toString()
        ) {
            throw new ApiError(400, "Cannot transfer to your own account");
        }

        const trimmedNote = note?.trim().substring(0, 200) || "";

        const { completedTransaction, debitedSender, creditedRecipient } =
            await withTransaction(async (session) => {
                const debitedSender = await accountRepository.findOneAndUpdate(
                    {
                        _id: senderAccount._id,
                        balance: { $gte: parsedAmount },
                        isActive: ACCOUNT_STATUS.ACTIVE,
                    },
                    { $inc: { balance: -parsedAmount } },
                    { new: true, session }
                );
                if (!debitedSender) {
                    throw new ApiError(
                        400,
                        "Transfer failed: insufficient balance or account locked"
                    );
                }

                const creditedRecipient = await accountRepository.findOneAndUpdate(
                    { _id: recipientAccount._id, isActive: ACCOUNT_STATUS.ACTIVE },
                    { $inc: { balance: parsedAmount } },
                    session
                );
                if (!creditedRecipient) {
                    throw new ApiError(400, "Transfer failed: recipient account unavailable");
                }

                let completedTransaction;
                try {
                    [completedTransaction] = await Transaction.create(
                        [
                            {
                                senderId: userId,
                                senderAccountId: senderAccount._id,
                                recipientAccountId: recipientAccount._id,
                                beneficiaryId: beneficiary._id,
                                amount: parsedAmount,
                                currency: senderAccount.currency,
                                note: trimmedNote,
                                status: "PENDING",
                                type: "TRANSFER",
                                balanceAfterDebit: debitedSender.balance,
                                idempotencyKey,
                            },
                        ],
                        { session }
                    );
                } catch (err) {
                    if (err.code === 11000) {
                        throw new ApiError(409, "Duplicate transfer request");
                    }
                    throw err;
                }

                await idempotencyRepository.create(
                    [{
                        userId,
                        key: idempotencyKey,
                        purpose: IDEMPOTENCY_PURPOSES.TRANSFER_TO_BENEFICIARY,
                        responseBody: {
                            transactionId: completedTransaction._id,
                            senderAccountId: debitedSender._id,
                            senderBalanceAfterTransfer: debitedSender.balance,
                            recipientAccountId: creditedRecipient._id,
                            recipientBalanceAfterTransfer: creditedRecipient.balance,
                            amountTransferred: parsedAmount,
                            currency: senderAccount.currency,
                            note: trimmedNote,
                        },
                    }],
                    session
                );

                return { completedTransaction, debitedSender, creditedRecipient };
            });

        return {
            transactionId: completedTransaction._id,
            senderAccountId: debitedSender._id,
            senderBalanceAfterTransfer: debitedSender.balance,
            recipientAccountId: creditedRecipient._id,
            recipientBalanceAfterTransfer: creditedRecipient.balance,
            amountTransferred: parsedAmount,
            currency: senderAccount.currency,
            note: trimmedNote,
        };
    }
}


export default new BeneficiaryService();