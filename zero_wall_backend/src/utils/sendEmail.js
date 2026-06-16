const nodemailer = require('nodemailer');
const { formatTokenExpiryLabel } = require('./tokenExpiry');

function createTransporter() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);

  return nodemailer.createTransport({
    host,
    service: host === 'smtp.gmail.com' ? 'gmail' : undefined,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendEmail({ to, subject, html }) {
  const transporter = createTransporter();
  const fromAddress = process.env.EMAIL_FROM || process.env.MAIL_FROM || process.env.SMTP_USER;
  const from = {
    name: process.env.APP_NAME || 'PG Infrastructure',
    address: fromAddress,
  };
  const text = String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    html,
    text,
    replyTo: fromAddress,
    envelope: {
      from: fromAddress,
      to,
    },
  });

  console.log('Email queued', {
    subject,
    to,
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
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
  const expiryLabel = formatTokenExpiryLabel('INVITE_TOKEN_EXPIRES_IN_HOURS', 48);

  return brandShell(`
    <h1 style="color:#2E83F5;font-size:28px;margin:0 0 4px">PG Infrastructure</h1>
    <p style="color:#8FA8C8;font-size:13px;margin:0 0 32px">Project execution and reporting.</p>
    <h2 style="color:#F0F4FA;font-size:20px;margin:0 0 12px">You have been invited</h2>
    <p style="color:#8FA8C8;line-height:1.7;margin:0 0 24px">
      <strong style="color:#F0F4FA">${inviterName}</strong> has invited
      <strong style="color:#F0F4FA">${inviteeName}</strong> to join PG Infrastructure as
      <strong style="color:#F0A428">${role}</strong>.
    </p>
    <a href="${inviteUrl}" style="display:inline-block;padding:12px 28px;background:#2E83F5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Accept Invitation</a>
    <p style="color:#4F6A85;font-size:12px;margin-top:24px">Link expires in ${expiryLabel}.</p>
  `);
}

function resetEmailTemplate({ name = 'there', resetUrl }) {
  const expiryLabel = formatTokenExpiryLabel('RESET_TOKEN_EXPIRES_IN_HOURS', 24);

  return brandShell(`
    <h1 style="color:#2E83F5;font-size:28px;margin:0 0 4px">PG Infrastructure</h1>
    <p style="color:#8FA8C8;font-size:13px;margin:0 0 32px">Project execution and reporting.</p>
    <h2 style="color:#F0F4FA;font-size:20px;margin:0 0 12px">Reset your password</h2>
    <p style="color:#8FA8C8;line-height:1.7;margin:0 0 24px">
      Hi ${name}, click the button below to set a new password. This link expires in ${expiryLabel}.
    </p>
    <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:#2E83F5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Reset Password</a>
  `);
}

module.exports = {
  sendEmail,
  inviteEmailTemplate,
  resetEmailTemplate,
};
