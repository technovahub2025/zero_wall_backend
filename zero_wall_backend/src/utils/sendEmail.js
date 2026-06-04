const nodemailer = require('nodemailer');

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendEmail({ to, subject, html }) {
  const transporter = createTransporter();

  await transporter.sendMail({
    from: `"${process.env.APP_NAME || 'ZEROWALL'}" <${process.env.EMAIL_FROM || process.env.MAIL_FROM || process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
}

function brandShell(content) {
  return `
    <div style="background:#0B1929;padding:40px;font-family:'DM Sans',Arial,sans-serif;color:#F0F4FA">
      ${content}
    </div>
  `;
}

function inviteEmailTemplate({ inviteeName = 'there', inviterName = 'A teammate', role = 'employee', inviteUrl }) {
  return brandShell(`
    <h1 style="color:#2E83F5;font-size:28px;margin:0 0 4px">ZEROWALL</h1>
    <p style="color:#8FA8C8;font-size:13px;margin:0 0 32px">Built for those who never miss.</p>
    <h2 style="color:#F0F4FA;font-size:20px;margin:0 0 12px">You have been invited</h2>
    <p style="color:#8FA8C8;line-height:1.7;margin:0 0 24px">
      <strong style="color:#F0F4FA">${inviterName}</strong> has invited
      <strong style="color:#F0F4FA">${inviteeName}</strong> to join ZEROWALL as
      <strong style="color:#F0A428">${role}</strong>.
    </p>
    <a href="${inviteUrl}" style="display:inline-block;padding:12px 28px;background:#2E83F5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Accept Invitation</a>
    <p style="color:#4F6A85;font-size:12px;margin-top:24px">Link expires in 48 hours.</p>
  `);
}

function resetEmailTemplate({ name = 'there', resetUrl }) {
  return brandShell(`
    <h1 style="color:#2E83F5;font-size:28px;margin:0 0 4px">ZEROWALL</h1>
    <p style="color:#8FA8C8;font-size:13px;margin:0 0 32px">Built for those who never miss.</p>
    <h2 style="color:#F0F4FA;font-size:20px;margin:0 0 12px">Reset your password</h2>
    <p style="color:#8FA8C8;line-height:1.7;margin:0 0 24px">
      Hi ${name}, click the button below to set a new password. This link expires in 1 hour.
    </p>
    <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:#2E83F5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Reset Password</a>
  `);
}

module.exports = {
  sendEmail,
  inviteEmailTemplate,
  resetEmailTemplate,
};
