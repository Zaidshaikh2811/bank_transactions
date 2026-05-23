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