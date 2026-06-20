// api/verifyotp.js

import { findContactByEmail } from "../lib/zoho.js";

// Rate limiter for verification attempts (prevents brute force)
const verifyRateLimits = new Map();

function checkVerifyRateLimit(email, limitMinutes = 10, maxAttempts = 5) {
  const now = Date.now();
  const key = `verify_${email}`;
  const windowMs = limitMinutes * 60 * 1000;
  
  if (!verifyRateLimits.has(key)) {
    verifyRateLimits.set(key, { attempts: 1, firstAttempt: now, blocked: false });
    return { allowed: true, remaining: maxAttempts - 1, blocked: false };
  }
  
  const record = verifyRateLimits.get(key);
  
  // If window expired, reset
  if (now - record.firstAttempt > windowMs) {
    verifyRateLimits.set(key, { attempts: 1, firstAttempt: now, blocked: false });
    return { allowed: true, remaining: maxAttempts - 1, blocked: false };
  }
  
  // Check if blocked
  if (record.blocked) {
    const waitMinutes = Math.ceil((windowMs - (now - record.firstAttempt)) / 60000);
    return { allowed: false, blocked: true, waitMinutes, remaining: 0 };
  }
  
  // Check if over limit
  if (record.attempts >= maxAttempts) {
    record.blocked = true;
    verifyRateLimits.set(key, record);
    const waitMinutes = Math.ceil((windowMs - (now - record.firstAttempt)) / 60000);
    return { allowed: false, blocked: true, waitMinutes, remaining: 0 };
  }
  
  // Increment attempts
  record.attempts++;
  verifyRateLimits.set(key, record);
  return { allowed: true, remaining: maxAttempts - record.attempts, blocked: false };
}

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

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required" });
    }

    // ===== RATE LIMITING CHECK =====
    const rateCheck = checkVerifyRateLimit(email, 10, 5); // 5 attempts per 10 minutes
    if (!rateCheck.allowed) {
      if (rateCheck.blocked) {
        return res.status(429).json({
          status: "error",
          valid: false,
          reason: "rate_limited",
          message: `Too many failed attempts. Please wait ${rateCheck.waitMinutes} minute(s) before trying again.`
        });
      } else {
        return res.status(429).json({
          status: "error",
          valid: false,
          reason: "rate_limited",
          message: "Rate limit exceeded. Please try again later."
        });
      }
    }
    // ===============================

    // 1. Find contact
    const contact = await findContactByEmail(email);

    if (!contact) {
      return res.status(404).json({
        status: "error",
        valid: false,
        reason: "not_found",
        message: "Email not found. Please request a new code."
      });
    }

    // 2. Extract stored values
    const storedOtp = contact.Title;          // OTP stored in Title
    const storedToken = contact.Twitter;      // Token stored in Twitter
    const storedExpiry = contact.Assistant;   // Expiry stored in Assistant

    // 3. Validate OTP
    if (!storedOtp || storedOtp !== otp) {
      // Failed attempt - rate limiter already counted it
      return res.status(200).json({
        status: "error",
        valid: false,
        reason: "invalid",
        message: `Invalid verification code. ${rateCheck.remaining} attempt(s) remaining before account is locked for 10 minutes.`
      });
    }

    // 4. Validate expiry
    if (storedExpiry) {
      const now = new Date();
      const expiry = new Date(storedExpiry);

      if (now > expiry) {
        return res.status(200).json({
          status: "error",
          valid: false,
          reason: "expired",
          message: "Verification code has expired. Please request a new one."
        });
      }
    }

    // 5. On success, clear the rate limit record for this email
    verifyRateLimits.delete(`verify_${email}`);

    // 6. Build redirect URL with BOTH email and token as query parameters
    const encodedEmail = encodeURIComponent(email);
    const redirectUrl = `${process.env.UI_HOST || 'https://www.turnkii.es'}/account/?email=${encodedEmail}&token=${storedToken}`;

    // Return success
    return res.status(200).json({
      status: "success",
      valid: true,
      redirect: redirectUrl,
      token: storedToken,
      email: email,
      message: "Code verified — redirecting..."
    });

  } catch (err) {
    console.error("verifyotp error:", err);
    return res.status(500).json({ 
      status: "error",
      error: err.message,
      message: "Server error. Please try again."
    });
  }
}