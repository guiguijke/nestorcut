import logger from '~~/server/utils/logger';

async function sendEmail(to, subject, htmlBody) {
  try {
    const response = await $fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${useRuntimeConfig().resendToken}`,
      },
      body: {
        from: useRuntimeConfig().resendFrom || 'onboarding@resend.dev',
        to: to,
        subject: subject,
        html: htmlBody,
      },
    });
    logger.info('Email sent successfully!');
    logger.info('Response:', response);
  } catch (error) {
    logger.error('Failed to send email:', error);
    throw error;
  }
}

export async function sendPasswordResetEmail(email, resetUrl) {
  const emailSubject = 'Reset your NestorCut password';
  const emailBody = `
    <p>Hello,</p>
    <p>We received a request to reset the password of your NestorCut account.</p>
    <p><a href="${resetUrl}">Click here to choose a new password</a></p>
    <p>This link is valid for 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
    <p>Best regards, <br> NestorCut</p>
  `;

  await sendEmail(email, emailSubject, emailBody);
  logger.info(`Password reset email sent`);
}

export async function sendVerificationEmail(email, verifyUrl) {
  // D3 (C1-a) : bilingue dans le même corps — pas de plomberie de langue à
  // l'inscription, FR puis EN, un seul lien.
  const emailSubject = 'Confirmez votre adresse · Verify your email — NestorCut';
  const emailBody = `
    <p>Bonjour,</p>
    <p>Merci de créer votre compte NestorCut. Confirmez votre adresse e-mail pour commencer à imbriquer :</p>
    <p><a href="${verifyUrl}">Confirmer mon adresse e-mail</a></p>
    <p>Ce lien est valable 24 heures. Si vous n'êtes pas à l'origine de cette inscription, vous pouvez ignorer cet e-mail.</p>
    <p>Cordialement, <br> NestorCut</p>
    <hr style="border:none;border-top:1px solid #ddd;margin:20px 0">
    <p>Hello,</p>
    <p>Thanks for creating your NestorCut account. Please confirm your email address to start nesting:</p>
    <p><a href="${verifyUrl}">Verify my email address</a></p>
    <p>This link is valid for 24 hours. If you did not create an account, you can safely ignore this email.</p>
    <p>Best regards, <br> NestorCut</p>
  `;

  await sendEmail(email, emailSubject, emailBody);
  logger.info(`Verification email sent`);
}

export async function sendAccountDeletedEmail(email) {
  const emailSubject = 'Your NestorCut account has been deleted';
  const emailBody = `
    <p>Hello,</p>
    <p>Your NestorCut account and all associated data (projects, DXF files, nesting results) have been permanently deleted. Any active subscription was canceled immediately.</p>
    <p>If you did not request this deletion, please contact our support team right away.</p>
    <p>Best regards, <br> NestorCut</p>
  `;

  await sendEmail(email, emailSubject, emailBody);
  logger.info(`Account deletion confirmation email sent`);
}
