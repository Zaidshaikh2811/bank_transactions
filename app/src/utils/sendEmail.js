import transporter from "../config/mail.js";

const sendEmail = async ({
    to,
    subject,
    html,
    text
}) => {

    const mailOptions = {

        from: process.env.MAIL_FROM,

        to,

        subject,

        text,

        html
    };

    try {


        const info =
            await transporter.sendMail(
                mailOptions
            );

        return info;
    } catch (error) {
        console.error("Error sending email:", error);
        throw error;
    }
};


/** * - Send Welcome Email
 * - Sends a welcome email to the user when they create an account
 */

export const sendWelcomeEmail = async (email) => {
    return await sendEmail({
        to: email,
        subject: "Welcome to Banking System",

        text: "You Have Succesfully registered to our banking system. We are glad to have you on board.",

        html: `
        <h1>Welcome</h1>

        <p>
            You Have Succesfully registered to our banking system. We are glad to have you on board.
        </p>
    `
    });
};


/** * * - New Account Email
 * - Sends an email notifying the user that a new account was created for them, along with the account type
 */


export const newAccountEmail = async (email) => {
    return await sendEmail({
        to: email,
        subject: "New Account Created",
        text: "You Have Succesfully created a new account with our banking system.",
        html: `
        <h1>New Account Created</h1>
        <p>
            You Have Succesfully created a new account with our banking system.
        </p>
    `
    });
}


/** * 
 * - Send Deactivation Email
 * - Sends an email notifying the user that their account was deactivated, along with the reason for deactivation
 */

export const sendDeactivationEmail = async (email, reason) => {
    return await sendEmail({
        to: email,
        subject: "Account Deactivated",
        text: `Your account was deactivated. Reason: ${reason}`,
        html: `
        <h1>Account Deactivated</h1>
        <p>
            Your account was deactivated. Reason: ${reason}
        </p>
    `
    });
}

/**
 * 
 * - Send Reactivation Email
 * - Sends an email notifying the user that their account was reactivated
 */

export const sendReactivationEmail = async (email) => {
    return await sendEmail({
        to: email,
        subject: "Account Reactivated",
        text: "Your account was reactivated",
        html: `
        <h1>Account Reactivated</h1>
        <p>
            Your account was reactivated.
        </p>
    `
    });
}


/**
 * 
 * - Send Activation Email
 * - Sends an email with a verification link containing the token to the user's email address
 * - The link directs the user to the frontend, which then calls the activate user endpoint with the token
 */
export const sendActivationEmail = async (email, verificationToken) => {
    const activationLink = `${process.env.FRONTEND_URL}/activate?token=${verificationToken}`;
    return await sendEmail({
        to: email,
        subject: "Activate Your Account",
        text: `Please activate your account using the following link: ${activationLink}`,
        html: `
        <h1>Activate Your Account</h1>
        <p>
            Please activate your account using the following link: <a href="${activationLink}">Activate Account</a>
        </p>

        <p>
            If you did not create an account, please ignore this email.
        </p>

        <p>
            This link will expire in 24 hours.
        </p>
    `
    });
}


/** * 
 * - Send Account Activated Email
 * - Sends an email notifying the user that their account was activated successfully
 */
export const sendAccountActivatedEmail = async (email) => {
    return await sendEmail({
        to: email,
        subject: "Account Activated",
        text: "Your account was activated successfully",
        html: `
        <h1>Account Activated</h1>
        <p>
            Your account was activated successfully.
        </p>
    `
    });
}



/**
 * 
 * @param {*} email 
 * @param {*} amount 
 * @param {*} balance 
 * @returns 
 */


export const sendDepositEmail = async (email, amount, balance) => {
    return await sendEmail({
        to: email,
        subject: "Deposit Successful",
        text: `Your deposit of ${amount} was successful. Your new balance is ${balance}.`,
        html: `
        <h1>Deposit Successful</h1>
        <p>
            Your deposit of ${amount} was successful. Your new balance is ${balance}.
        </p>
    `
    });
}


export const sendOtpEmail = async (email, otp, expiresInMinutes) => {
    return await sendEmail({
        to: email,
        subject: "Your OTP Code",
        text: `Your OTP code is ${otp}. It will expire in ${expiresInMinutes} minutes.`,
        html: `
        <h1>Your OTP Code</h1>
        <p>
            Your OTP code is <strong>${otp}</strong>. It will expire in ${expiresInMinutes} minutes.
        </p>
    `
    });
}


export const sendTransactionNotificationEmail = async (email, transactionDetails) => {
    const { type, amount, date, description } = transactionDetails;
    return await sendEmail({
        to: email,
        subject: `New ${type} Transaction`,
        text: `A new ${type} transaction of ${amount} occurred on ${date}. Description: ${description}`,
        html: `
        <h1>New ${type} Transaction</h1>
        <p>
            A new ${type} transaction of <strong>${amount}</strong> occurred on ${date}.<br>
            Description: ${description}
        </p>
    `
    });
}


export const sendWithdrawEmail = async (email, amount, balance) => {
    return await sendEmail({
        to: email,
        subject: "Withdrawal Successful",
        text: `Your withdrawal of ${amount} was successful. Your new balance is ${balance}.`,
        html: `
        <h1>Withdrawal Successful</h1>
        <p>
            Your withdrawal of ${amount} was successful. Your new balance is ${balance}.
        </p>
    `
    });
}