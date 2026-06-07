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

    const info =
        await transporter.sendMail(
            mailOptions
        );

    return info;
};


/** * - Send Welcome Email
 * - Sends a welcome email to the user when they create an account
 */

export const sendWelcomeEmail = async (email) => {
    return await sendEmail({
        to: email,
        subject: "Welcome to Banking System",

        text: "Your account was created successfully",

        html: `
        <h1>Welcome</h1>

        <p>
            Your account was created successfully.
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
        text: "A new account was created for you",
        html: `
        <h1>New Account Created</h1>
        <p>
            A new account was created for you.
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
