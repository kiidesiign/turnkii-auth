// api/generateMagicLink.js

import { findContactByEmail, createContact, updateContact } from "../lib/zoho.js";

// Simple in-memory rate limiter (resets when server restarts)
const rateLimits = new Map();

function checkRateLimit(email, limitMinutes = 5, maxRequests = 3) {
  const now = Date.now();
  const key = `generate_${email}`;
  const windowMs = limitMinutes * 60 * 1000;
  
  if (!rateLimits.has(key)) {
    rateLimits.set(key, { count: 1, firstRequest: now });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  
  const record = rateLimits.get(key);
  
  // If window has expired, reset
  if (now - record.firstRequest > windowMs) {
    rateLimits.set(key, { count: 1, firstRequest: now });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  
  // Check if over limit
  if (record.count >= maxRequests) {
    const waitMinutes = Math.ceil((windowMs - (now - record.firstRequest)) / 60000);
    return { allowed: false, remaining: 0, waitMinutes };
  }
  
  // Increment count
  record.count++;
  rateLimits.set(key, record);
  return { allowed: true, remaining: maxRequests - record.count };
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

  if (req.method === 'POST') {
    let body = '';
    await new Promise((resolve) => {
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          req.body = body ? JSON.parse(body) : {};
        } catch (e) {
          req.body = {};
        }
        resolve();
      });
    });
  }

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // ===== RATE LIMITING CHECK =====
    const rateCheck = checkRateLimit(email, 5, 3); // 3 requests per 5 minutes
    if (!rateCheck.allowed) {
      return res.status(429).json({
        status: "error",
        message: `Too many requests. Please wait ${rateCheck.waitMinutes} minute(s) before requesting another code.`
      });
    }
    // ===============================

    // 1. Find or create contact
    let contact = await findContactByEmail(email);

    if (!contact) {
      contact = await createContact(email);
    }

    const contactId = contact.id;

    // 2. Generate OTP (6 digits)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // 3. Generate expiry (1 hour)
    const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    // 4. Generate 32‑character token
    const token = [...Array(32)]
      .map(() => Math.floor(Math.random() * 16).toString(16))
      .join("");

    // 5. Update CRM contact with OTP, expiry, token
    await updateContact(contactId, {
        Title: otp,          // OTP stored here
        Twitter: token,      // Token stored here
        Assistant: expiry   // Only if you created this custom field
    });


    // 6. Send OTP email via Resend
    let emailSent = false;
    let emailError = null;
    
    try {
        console.log(`Attempting to send email to: ${email}`);
        
        const emailResponse = await fetch(`https://project-qv4f9.vercel.app/api/send-otp-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp, token })
        });
        
        console.log(`Email API response status: ${emailResponse.status}`);
        
        // First check if response is OK
        if (!emailResponse.ok) {
            const errorText = await emailResponse.text();
            console.error(`Email API returned ${emailResponse.status}: ${errorText}`);
            emailError = `HTTP ${emailResponse.status}: ${errorText.substring(0, 100)}`;
        } else {
            // Try to parse JSON
            const text = await emailResponse.text();
            console.log(`Email API raw response: ${text}`);
            
            try {
                const emailResult = JSON.parse(text);
                if (emailResult.success) {
                    emailSent = true;
                    console.log(`Email sent successfully to: ${email}`);
                } else {
                    emailError = emailResult.error || 'Unknown error';
                    console.error(`Failed to send email:`, emailError);
                }
            } catch (parseErr) {
                console.error(`Failed to parse email response as JSON:`, parseErr);
                emailError = `Invalid JSON response: ${text.substring(0, 100)}`;
            }
        }
    } catch (emailErr) {
        emailError = emailErr.message;
        console.error(`Email sending exception:`, emailErr);
    }

    // 7. Return success with redirect URL for frontend
    // Your frontend expects a "redirect" field to send user to OTP page
    const otpPageUrl = `https://www.turnkii.es/otp?email=${encodeURIComponent(email)}`;
    
    return res.status(200).json({
      status: "success",
      redirect: otpPageUrl,
      message: "Verification code sent to your email",
      remainingRequests: rateCheck.remaining, // Show how many requests left in this window
      // Optional: include these for debugging (remove in production)
      otp,
      expiry,
      token,
      contactId
    });

  } catch (err) {
    console.error("generateMagicLink error:", err);
    return res.status(500).json({ 
      status: "error",
      message: err.message 
    });
  }
}