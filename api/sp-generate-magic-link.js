// api/sp-generate-magic-link.js
// Supabase version of magic link generator

import { supabase } from '../lib/supabase.js';

// ============================================================
// CONFIGURATION
// ============================================================

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://www.turnkii.es';

// ============================================================
// RATE LIMITING
// ============================================================

const rateLimits = new Map();

function checkRateLimit(email, limitMinutes = 5, maxRequests = 3) {
  const now = Date.now();
  const key = `sp_generate_${email}`;
  const windowMs = limitMinutes * 60 * 1000;
  
  if (!rateLimits.has(key)) {
    rateLimits.set(key, { count: 1, firstRequest: now });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  
  const record = rateLimits.get(key);
  
  if (now - record.firstRequest > windowMs) {
    rateLimits.set(key, { count: 1, firstRequest: now });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  
  if (record.count >= maxRequests) {
    const waitMinutes = Math.ceil((windowMs - (now - record.firstRequest)) / 60000);
    return { allowed: false, remaining: 0, waitMinutes };
  }
  
  record.count++;
  rateLimits.set(key, record);
  return { allowed: true, remaining: maxRequests - record.count };
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Generate a 6-digit OTP
 */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Generate a 32-character token
 */
function generateToken() {
  return [...Array(32)]
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join("");
}

/**
 * Generate magic link URL
 */
function generateMagicLink(email, token, otp) {
  return `https://www.turnkii.es/otp?email=${encodeURIComponent(email)}&otp=${otp}&token=${token}`;
}

// ============================================================
// MAIN HANDLER
// ============================================================

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed' 
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

  try {
    const { email, firstName = '', lastName = '' } = req.body;

    // Validate email
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: 'Email is required' 
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid email format' 
      });
    }

    // Check environment variables
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      console.error('Missing Supabase environment variables');
      return res.status(500).json({ 
        success: false,
        error: 'Server configuration error',
        details: 'Supabase credentials not configured'
      });
    }

    // Rate limiting
    const rateCheck = checkRateLimit(email, 5, 3);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: `Too many requests. Please wait ${rateCheck.waitMinutes} minute(s) before requesting another code.`
      });
    }

    // ============================================================
    // MAIN LOGIC
    // ============================================================

    console.log(`[SP_GenerateMagicLink] Processing request for: ${email}`);

    // 1. Find or create contact
    let contact = null;
    let isNewContact = false;

    // Try to find existing contact
    const { data: existingContact, error: findError } = await supabase
      .from('contacts')
      .select('*')
      .eq('email', email)
      .single();

    if (findError && findError.code !== 'PGRST116') {
      // PGRST116 = no rows found
      console.error('Error finding contact:', findError);
      throw new Error(`Failed to find contact: ${findError.message}`);
    }

    if (existingContact) {
      contact = existingContact;
      console.log(`[SP_GenerateMagicLink] Found existing contact: ${contact.id}`);
    } else {
      // Create new contact
      console.log(`[SP_GenerateMagicLink] Creating new contact: ${email}`);
      const { data: newContact, error: createError } = await supabase
        .from('contacts')
        .insert({
          email: email,
          first_name: firstName || email.split('@')[0],
          last_name: lastName || ''
        })
        .select()
        .single();

      if (createError) {
        console.error('Error creating contact:', createError);
        throw new Error(`Failed to create contact: ${createError.message}`);
      }

      contact = newContact;
      isNewContact = true;
    }

    // 2. Generate OTP and Token
    const otp = generateOTP();
    const token = generateToken();
    const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    
    console.log(`[SP_GenerateMagicLink] Generated OTP: ${otp}`);
    console.log(`[SP_GenerateMagicLink] Generated Token: ${token.substring(0, 10)}...`);

    // 3. Update contact with magic link data
    const { data: updatedContact, error: updateError } = await supabase
      .from('contacts')
      .update({
        otp: otp,
        magic_link: token,
        link_expiry: expiry,
        updated_at: new Date().toISOString()
      })
      .eq('id', contact.id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating contact:', updateError);
      throw new Error(`Failed to update contact: ${updateError.message}`);
    }

    console.log(`[SP_GenerateMagicLink] Updated contact with magic link data`);

    // 4. Generate magic link URL
    const magicLink = generateMagicLink(email, token, otp);

    // ============================================================
    // RESPONSE
    // ============================================================

    const responseData = {
      success: true,
      status: 'success',
      message: 'Magic link generated successfully',
      
      // Magic link data
      otp: otp,
      token: token,
      magicLink: magicLink,
      
      // Contact info
      contactId: contact.id,
      email: email,
      firstName: updatedContact.first_name || '',
      lastName: updatedContact.last_name || '',
      isNewContact: isNewContact,
      
      // Full contact data for display
      contact: {
        id: contact.id,
        fields: {
          'First Name': updatedContact.first_name || '',
          'Last Name': updatedContact.last_name || '',
          'Email': updatedContact.email,
          'OTP': updatedContact.otp || '',
          'Token': updatedContact.magic_link || '',
          'OTP_Expiry': updatedContact.link_expiry || '',
          'OTP_Generated_At': updatedContact.updated_at || '',
          'OTP_Verified': false
        }
      },
      
      // API call tracking
      apiCallsUsed: isNewContact ? 3 : 2,
      apiCallsDetails: isNewContact ? 'Find + Create + Update' : 'Find + Update',
      
      // Rate limiting info
      remainingRequests: rateCheck.remaining,
      
      // Redirect URL for frontend
      redirect: `https://www.turnkii.es/otp?email=${encodeURIComponent(email)}`
    };

    console.log(`[SP_GenerateMagicLink] Success for: ${email}`);
    return res.status(200).json(responseData);

  } catch (error) {
    console.error('[SP_GenerateMagicLink] Error:', error);
    return res.status(500).json({
      success: false,
      status: 'error',
      error: 'Failed to generate magic link',
      message: error.message
    });
  }
}

// ============================================================
// EXPORT HELPER FUNCTIONS FOR USE IN OTHER FILES
// ============================================================

export {
  generateOTP,
  generateToken,
  generateMagicLink
};