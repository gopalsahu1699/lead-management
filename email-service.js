const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_PORT == 465,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

async function sendAutomatedEmail(to, template, leadData) {
    if (!to || !template) return;

    let body = template.body;
    // Simple placeholder replacement
    Object.keys(leadData).forEach(key => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        body = body.replace(regex, leadData[key] || '');
    });

    const mailOptions = {
        from: `"Lead Manager" <${process.env.EMAIL_USER}>`,
        to,
        subject: template.subject,
        html: body
    };

    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Email send error:', error);
        return false;
    }
}

module.exports = { sendAutomatedEmail };
