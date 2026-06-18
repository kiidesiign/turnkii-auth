// api/send-otp-email.js
// Send OTP email using Resend

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  const CORS_ORIGIN = 'https://www.turnkii.es';

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, otp, token } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email and OTP are required' 
      });
    }

    console.log(`📧 Sending OTP email to: ${email}`);

    // Email HTML content
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Verification Code</title>
        <style>
          body { font-family: Arial, sans-serif; background-color: #f6f9fc; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; background: #ffffff; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .header { text-align: center; padding-bottom: 20px; border-bottom: 2px solid #e8eef2; }
          .logo { font-size: 24px; font-weight: bold; color: #0a1a2f; }
          .otp-code { font-size: 48px; font-weight: bold; color: #0a1a2f; text-align: center; padding: 30px 0; letter-spacing: 8px; }
          .message { color: #4a5568; line-height: 1.6; text-align: center; }
          .footer { text-align: center; padding-top: 20px; border-top: 2px solid #e8eef2; color: #a0aec0; font-size: 12px; }
          .button { display: inline-block; background: #0a1a2f; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🔐 TurnKii</div>
          </div>
          <div class="message">
            <p>Hello,</p>
            <p>You requested a login link for <strong>${email}</strong>.</p>
            <p>Enter the following verification code:</p>
          </div>
          <div class="otp-code">${otp}</div>
          <div class="message">
            <p>This code will expire in <strong>1 hour</strong>.</p>
            <p>If you didn't request this, please ignore this email.</p>
          </div>
          ${token ? `
          <div style="text-align: center; margin: 20px 0;">
            <p style="color: #4a5568;">Or click the button below:</p>
            <a href="https://www.turnkii.es/otp?email=${encodeURIComponent(email)}&token=${token}" class="button">Login Now</a>
          </div>
          ` : ''}
          <div class="footer">
            <p>© ${new Date().getFullYear()} TurnKii. All rights reserved.</p>
            <p>This is an automated message, please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email via Resend
    const { data, error } = await resend.emails.send({
      from: 'TurnKii <noreply@turnkii.es>',
      to: [email],
      subject: `Your TurnKii Verification Code: ${otp}`,
      html: htmlContent,
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to send email',
        details: error.message
      });
    }

    console.log(`✅ OTP email sent to: ${email}`, data?.id);

    return res.status(200).json({
      success: true,
      message: 'OTP email sent successfully',
      emailId: data?.id
    });

  } catch (error) {
    console.error('Email error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send email',
      details: error.message
    });
  }
}