// api/sp-verify-otp.js
// Supabase version of OTP verification - uses service role key

// ============================================================
// RATE LIMITING
// ============================================================

const verifyRateLimits = new Map();

function checkVerifyRateLimit(email, limitMinutes = 10, maxAttempts = 5) {
  const now = Date.now();
  const key = `sp_verify_${email}`;
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

// ============================================================
// MAIN HANDLER
// ============================================================

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

  // Parse request body
  let body = '';
  await new Promise((resolve) => {
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        req.body = body ? JSON.parse(body) : {};
      } catch (e) {
        req.body = {};
      }
      resolve();
    });
  });

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ 
        status: "error",
        valid: false,
        message: "Method not allowed" 
      });
    }

    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ 
        status: "error",
        valid: false,
        message: "Email and OTP are required" 
      });
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

    // Check environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase environment variables');
      return res.status(500).json({
        status: "error",
        valid: false,
        message: "Server configuration error"
      });
    }

    // 1. Find contact in Supabase using native fetch
    console.log(`[SP_VerifyOTP] Looking for contact: ${email}`);
    
    const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
    const findResponse = await fetch(findUrl, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    });

    if (!findResponse.ok) {
      const errorText = await findResponse.text();
      console.error('[SP_VerifyOTP] Find error:', errorText);
      return res.status(500).json({
        status: "error",
        valid: false,
        message: "Failed to find contact"
      });
    }

    const findData = await findResponse.json();

    if (!findData || findData.length === 0) {
      return res.status(404).json({
        status: "error",
        valid: false,
        reason: "not_found",
        message: "Email not found. Please request a new code."
      });
    }

    const contact = findData[0];
    console.log(`[SP_VerifyOTP] Found contact: ${contact.id}`);

    // 2. Extract stored values from Supabase
    const storedOtp = contact.otp;
    const storedToken = contact.magic_link;
    const storedExpiry = contact.link_expiry;

    // 3. Validate OTP
    if (!storedOtp || storedOtp !== otp) {
      console.log(`[SP_VerifyOTP] Invalid OTP attempt for: ${email}`);
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
        console.log(`[SP_VerifyOTP] Expired OTP for: ${email}`);
        return res.status(200).json({
          status: "error",
          valid: false,
          reason: "expired",
          message: "Verification code has expired. Please request a new one."
        });
      }
    }

    // 5. On success, clear the rate limit record for this email
    verifyRateLimits.delete(`sp_verify_${email}`);

    // 6. Clear ONLY the OTP from the database (keep token for account page)
    //    The token remains valid until its expiry time is reached
    console.log(`[SP_VerifyOTP] Clearing OTP, keeping token for: ${email}`);
    const updateUrl = `${supabaseUrl}/rest/v1/contacts?id=eq.${contact.id}`;
    const updateResponse = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        otp: null,  // Only clear OTP
        // Keep magic_link and link_expiry for account page verification
        updated_at: new Date().toISOString()
      })
    });

    if (!updateResponse.ok) {
      console.error('[SP_VerifyOTP] Error clearing OTP:', await updateResponse.text());
      // Non-critical error, continue
    }

    console.log(`[SP_VerifyOTP] Successfully verified OTP for: ${email}`);

    // 7. Build redirect URL with email and token for account page
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
    console.error("[SP_VerifyOTP] Error:", err);
    return res.status(500).json({ 
      status: "error",
      valid: false,
      message: "Server error. Please try again."
    });
  }
}