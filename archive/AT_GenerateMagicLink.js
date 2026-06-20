// api/AT_GenerateMagicLink.js
// Airtable version of magic link generator - separate from Zoho version

import Airtable from 'airtable';

// ============================================================
// CONFIGURATION
// ============================================================

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Contacts';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://www.turnkii.es';

// ============================================================
// RATE LIMITING
// ============================================================

const rateLimits = new Map();

function checkRateLimit(email, limitMinutes = 5, maxRequests = 3) {
  const now = Date.now();
  const key = `at_generate_${email}`;
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
// AIRTABLE OPERATIONS
// ============================================================

/**
 * Initialize Airtable base
 */
function getBase() {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    throw new Error('Airtable environment variables not configured');
  }
  return new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
}

/**
 * Find a contact by email
 */
async function findContactByEmail(email) {
  try {
    const base = getBase();
    const records = await base(AIRTABLE_TABLE_NAME)
      .select({
        filterByFormula: `{Email} = "${email}"`,
        maxRecords: 1
      })
      .firstPage();
    
    return records.length > 0 ? records[0] : null;
  } catch (error) {
    console.error('Error finding contact:', error);
    throw new Error(`Failed to find contact: ${error.message}`);
  }
}

/**
 * Create a new contact
 */
async function createContact(email, firstName = '', lastName = '') {
  try {
    const base = getBase();
    const record = await base(AIRTABLE_TABLE_NAME).create({
      'Email': email,
      'First Name': firstName || email.split('@')[0],
      'Last Name': lastName || '',
      'Created_At': new Date().toISOString()
    });
    return record;
  } catch (error) {
    console.error('Error creating contact:', error);
    throw new Error(`Failed to create contact: ${error.message}`);
  }
}

/**
 * Update contact with magic link data
 */
async function updateContactWithMagicLink(recordId, otp, token, expiry) {
  try {
    const base = getBase();
    const record = await base(AIRTABLE_TABLE_NAME).update(recordId, {
      'OTP': otp,
      'Token': token,
      'OTP_Expiry': expiry,
      'OTP_Generated_At': new Date().toISOString(),
      'OTP_Verified': false,
      'Last_Magic_Link_Sent': new Date().toISOString()
    });
    return record;
  } catch (error) {
    console.error('Error updating contact:', error);
    throw new Error(`Failed to update contact: ${error.message}`);
  }
}

/**
 * Read contact with magic link data
 */
async function readContactMagicLink(recordId) {
  try {
    const base = getBase();
    const record = await base(AIRTABLE_TABLE_NAME).find(recordId);
    return {
      firstName: record.fields['First Name'] || '',
      lastName: record.fields['Last Name'] || '',
      email: record.fields.Email || '',
      otp: record.fields.OTP || '',
      token: record.fields.Token || '',
      expiry: record.fields.OTP_Expiry || '',
      generatedAt: record.fields.OTP_Generated_At || '',
      verified: record.fields.OTP_Verified || false
    };
  } catch (error) {
    console.error('Error reading contact:', error);
    throw new Error(`Failed to read contact: ${error.message}`);
  }
}

/**
 * Verify OTP for a contact
 */
async function verifyOTP(recordId, otp) {
  try {
    const magicLinkData = await readContactMagicLink(recordId);
    
    // Check if OTP matches
    if (magicLinkData.otp !== otp) {
      return { success: false, message: 'Invalid OTP' };
    }
    
    // Check if already verified
    if (magicLinkData.verified) {
      return { success: false, message: 'OTP already used' };
    }
    
    // Check if expired
    if (magicLinkData.expiry && new Date(magicLinkData.expiry) < new Date()) {
      return { success: false, message: 'OTP has expired' };
    }
    
    // Mark as verified
    const base = getBase();
    await base(AIRTABLE_TABLE_NAME).update(recordId, {
      'OTP_Verified': true,
      'OTP_Verified_At': new Date().toISOString()
    });
    
    return { success: true, message: 'OTP verified successfully' };
  } catch (error) {
    console.error('Error verifying OTP:', error);
    throw new Error(`Failed to verify OTP: ${error.message}`);
  }
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
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      console.error('Missing Airtable environment variables');
      return res.status(500).json({ 
        success: false,
        error: 'Server configuration error',
        details: 'Airtable credentials not configured'
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

    console.log(`[AT_GenerateMagicLink] Processing request for: ${email}`);

    // 1. Find or create contact
    let contact = await findContactByEmail(email);
    let isNewContact = false;

    if (!contact) {
      console.log(`[AT_GenerateMagicLink] Creating new contact: ${email}`);
      contact = await createContact(email, firstName, lastName);
      isNewContact = true;
    } else {
      console.log(`[AT_GenerateMagicLink] Found existing contact: ${contact.id}`);
    }

    // 2. Generate OTP and Token
    const otp = generateOTP();
    const token = generateToken();
    const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    
    console.log(`[AT_GenerateMagicLink] Generated OTP: ${otp}`);
    console.log(`[AT_GenerateMagicLink] Generated Token: ${token.substring(0, 10)}...`);

    // 3. Update contact in Airtable
    await updateContactWithMagicLink(contact.id, otp, token, expiry);
    console.log(`[AT_GenerateMagicLink] Updated contact with magic link data`);

    // 4. Generate magic link URL
    const magicLink = generateMagicLink(email, token, otp);

    // 5. Read back the updated contact to get all fields
    const contactData = await readContactMagicLink(contact.id);

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
      firstName: contactData.firstName,
      lastName: contactData.lastName,
      isNewContact: isNewContact,
      
      // Full contact data for display
      contact: {
        id: contact.id,
        fields: {
          'First Name': contactData.firstName,
          'Last Name': contactData.lastName,
          'Email': contactData.email,
          'OTP': contactData.otp,
          'Token': contactData.token,
          'OTP_Expiry': contactData.expiry,
          'OTP_Generated_At': contactData.generatedAt,
          'OTP_Verified': contactData.verified
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

    console.log(`[AT_GenerateMagicLink] Success for: ${email}`);
    return res.status(200).json(responseData);

  } catch (error) {
    console.error('[AT_GenerateMagicLink] Error:', error);
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
  findContactByEmail,
  createContact,
  updateContactWithMagicLink,
  readContactMagicLink,
  verifyOTP,
  generateOTP,
  generateToken,
  generateMagicLink
};