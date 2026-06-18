// api/sp-verify-token.js
// Supabase version of token verification

import { supabase } from '../lib/supabase.js';

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

  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ 
      valid: false, 
      message: "Method not allowed" 
    });
  }

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

  const { email, token } = req.body;

  if (!email || !token) {
    return res.status(400).json({ 
      valid: false, 
      message: "Email and token required" 
    });
  }

  try {
    console.log(`[SP_VerifyToken] Verifying token for: ${email}`);

    // Find contact in Supabase
    const { data: contact, error: findError } = await supabase
      .from('contacts')
      .select('*')
      .eq('email', email)
      .single();

    if (findError) {
      console.error('[SP_VerifyToken] Find error:', findError);
      if (findError.code === 'PGRST116') {
        // No rows found
        return res.status(404).json({ 
          valid: false, 
          message: "User not found" 
        });
      }
      throw findError;
    }

    console.log(`[SP_VerifyToken] Found contact: ${contact.id}`);

    // Extract stored values from Supabase
    const storedToken = contact.magic_link;
    const storedExpiry = contact.link_expiry;

    // Validate token
    if (!storedToken || storedToken !== token) {
      console.log(`[SP_VerifyToken] Invalid token for: ${email}`);
      return res.status(401).json({ 
        valid: false, 
        message: "Invalid token" 
      });
    }

    // Validate expiry
    if (storedExpiry) {
      const now = new Date();
      const expiry = new Date(storedExpiry);
      if (now > expiry) {
        console.log(`[SP_VerifyToken] Expired token for: ${email}`);
        return res.status(401).json({ 
          valid: false, 
          message: "Session expired. Please request a new login link." 
        });
      }
    }

    // Token is valid - return user details
    console.log(`[SP_VerifyToken] Successfully verified token for: ${email}`);

    // Extract name fields
    const firstName = contact.first_name || "";
    const lastName = contact.last_name || "";
    const fullName = `${firstName} ${lastName}`.trim();

    // Optional: You might want to extend the session by refreshing the expiry
    // This is optional - uncomment if you want to extend the session
    /*
    const newExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await supabase
      .from('contacts')
      .update({
        link_expiry: newExpiry,
        updated_at: new Date().toISOString()
      })
      .eq('id', contact.id);
    */

    return res.status(200).json({ 
      valid: true, 
      email: email,
      firstName: firstName,
      lastName: lastName,
      fullName: fullName || email,
      message: "Authentication successful" 
    });

  } catch (err) {
    console.error("[SP_VerifyToken] Error:", err);
    return res.status(500).json({ 
      valid: false, 
      message: "Server error. Please try again." 
    });
  }
}