// api/send-otp-email.js
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  const CORS_ORIGIN = 'https://www.turnkii.es';

  // Handle CORS preflight (OPTIONS request)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  // Set CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { email, otp, token } = req.body;

    // Validate required fields
    if (!email || !otp || !token) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields: email, otp, and token are required' 
      });
    }

    // Validate API key exists
    if (!process.env.RESEND_API_KEY) {
      console.error('RESEND_API_KEY is not set in environment');
      return res.status(500).json({ 
        success: false, 
        error: 'Email service configuration error' 
      });
    }

    // Create magic link
    const magicLink = `https://www.turnkii.es/account/?email=${encodeURIComponent(email)}&token=${token}`;

    console.log(`Attempting to send email to: ${email}`);

    const { data, error } = await resend.emails.send({
      from: 'Turnkii <noreply@mail.turnkii.es>',
      //from: 'Turnkii <onboarding@resend.dev>',
      to: email,
      subject: 'Your Turnkii Login Code',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>Turnkii Verification Code</title>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .code { font-size: 36px; font-weight: bold; color: #0a1a2f; padding: 15px; background: #f5f5f5; display: inline-block; letter-spacing: 5px; border-radius: 8px; }
              .button { background: #0a1a2f; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 20px 0; }
              .footer { font-size: 12px; color: #999; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Your Turnkii Verification Code</h1>
              <p>Enter this code to log in to your account:</p>
              <div class="code">${otp}</div>
              <p>Or click the button below to log in instantly:</p>
              <p><a href="${magicLink}" class="button">Log In to Your Account</a></p>
              <p>If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="word-break: break-all;"><a href="${magicLink}">${magicLink}</a></p>
              <div class="footer">
                <p>This code expires in 1 hour for security reasons.</p>
                <p>If you didn't request this code, you can safely ignore this email.</p>
                <p>&copy; ${new Date().getFullYear()} Turnkii. All rights reserved.</p>
              </div>
            </div>
          </body>
        </html>
      `,
      text: `Your Turnkii verification code is: ${otp}\n\nOr use this link to log in: ${magicLink}\n\nThis code expires in 1 hour.\n\nIf you didn't request this code, you can safely ignore this email.`
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }

    console.log('Email sent successfully:', data?.id);
    return res.status(200).json({ 
      success: true, 
      id: data?.id,
      message: 'Email sent successfully'
    });

  } catch (err) {
    console.error('Send email exception:', err);
    return res.status(500).json({ 
      success: false, 
      error: err.message || 'Failed to send email'
    });
  }
}