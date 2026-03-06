const nodemailer = require('nodemailer');

/**
 * Send a sync result email.
 * @param {object} opts
 * @param {string} opts.toEmail   - recipient address
 * @param {string} opts.gmailUser - Gmail address used as sender
 * @param {string} opts.gmailPass - Gmail App Password
 * @param {'success'|'error'} opts.status
 * @param {object} [opts.stats]   - { inserted, updated, deleted, skipped }
 * @param {string} [opts.error]   - error message on failure
 * @param {string} [opts.triggerType] - 'manual' | 'scheduled'
 */
async function sendSyncNotification({ toEmail, gmailUser, gmailPass, status, stats, error, triggerType }) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
  });

  const isSuccess = status === 'success';
  const subject = isSuccess
    ? `✅ סנכרון יומן הצליח`
    : `❌ סנכרון יומן נכשל`;

  const trigger = triggerType === 'scheduled' ? 'אוטומטי' : 'ידני';
  const now = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });

  let body;
  if (isSuccess) {
    body = `
<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 480px; color: #333;">
  <h2 style="color: #16a34a;">✅ הסנכרון הצליח</h2>
  <p><strong>זמן:</strong> ${now}</p>
  <p><strong>סוג:</strong> ${trigger}</p>
  <table style="border-collapse: collapse; width: 100%; margin-top: 12px;">
    <tr style="background: #f0fdf4;">
      <td style="padding: 8px 12px; border: 1px solid #bbf7d0;">➕ נוספו</td>
      <td style="padding: 8px 12px; border: 1px solid #bbf7d0; font-weight: bold;">${stats?.inserted ?? 0}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">✏️ עודכנו</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-weight: bold;">${stats?.updated ?? 0}</td>
    </tr>
    <tr style="background: #f0fdf4;">
      <td style="padding: 8px 12px; border: 1px solid #bbf7d0;">🗑️ הוסרו</td>
      <td style="padding: 8px 12px; border: 1px solid #bbf7d0; font-weight: bold;">${stats?.deleted ?? 0}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">⏭️ ללא שינוי</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-weight: bold;">${stats?.skipped ?? 0}</td>
    </tr>
  </table>
  <p style="margin-top: 16px; color: #888; font-size: 13px;">X Campus Calendar Sync</p>
</div>`;
  } else {
    body = `
<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 480px; color: #333;">
  <h2 style="color: #dc2626;">❌ הסנכרון נכשל</h2>
  <p><strong>זמן:</strong> ${now}</p>
  <p><strong>סוג:</strong> ${trigger}</p>
  <p><strong>שגיאה:</strong> ${error || 'שגיאה לא ידועה'}</p>
  <p style="margin-top: 16px;">כנס להגדרות כדי לבדוק את החיבורים.</p>
  <p style="margin-top: 16px; color: #888; font-size: 13px;">X Campus Calendar Sync</p>
</div>`;
  }

  await transporter.sendMail({
    from: `"Calendar Sync" <${gmailUser}>`,
    to: toEmail,
    subject,
    html: body,
  });
}

module.exports = { sendSyncNotification };
