// api/sp-generate-magic-link.js
// Supabase version of magic link generator - uses service role key

// ============================================================
// CONFIGURATION
// ============================================================

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://www.turnkii.es';
// FIX: Ensure URL has https:// protocol
const APP_URL = process.env.VERCEL_URL 
  ? `https://${process.env.VERCEL_URL}` 
  : 'https://project-qv4f9.vercel.app';

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

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken() {
  return [...Array(32)]
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join("");
}

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

  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase environment variables');
      return res.status(500).json({ 
        success: false,
        error: 'Server configuration error',
        details: 'Supabase credentials not configured'
      });
    }

    const rateCheck = checkRateLimit(email, 5, 3);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: `Too many requests. Please wait ${rateCheck.waitMinutes} minute(s) before requesting another code.`
      });
    }

    console.log(`[SP_GenerateMagicLink] Processing request for: ${email}`);

    // 1. Find existing contact
    let contact = null;
    let isNewContact = false;

    const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
    const findResponse = await fetch(findUrl, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    });

    if (!findResponse.ok) {
      const errorText = await findResponse.text();
      console.error('Error finding contact:', errorText);
      throw new Error(`Failed to find contact: ${findResponse.status}`);
    }

    const findData = await findResponse.json();

    if (findData && findData.length > 0) {
      contact = findData[0];
      console.log(`[SP_GenerateMagicLink] Found existing contact: ${contact.id}`);
    } else {
      console.log(`[SP_GenerateMagicLink] Creating new contact: ${email}`);
      const createUrl = `${supabaseUrl}/rest/v1/contacts`;
      const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          email: email,
          first_name: firstName || email.split('@')[0],
          last_name: lastName || ''
        })
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error('Error creating contact:', errorText);
        throw new Error(`Failed to create contact: ${createResponse.status}`);
      }

      const createData = await createResponse.json();
      contact = createData[0] || createData;
      isNewContact = true;
      console.log(`[SP_GenerateMagicLink] Created new contact: ${contact.id}`);
    }

    // 2. Generate OTP and Token
    const otp = generateOTP();
    const token = generateToken();
    const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    
    console.log(`[SP_GenerateMagicLink] Generated OTP: ${otp}`);
    console.log(`[SP_GenerateMagicLink] Generated Token: ${token.substring(0, 10)}...`);

    // 3. Update contact with magic link data
    const updateUrl = `${supabaseUrl}/rest/v1/contacts?id=eq.${contact.id}`;
    const updateResponse = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        otp: otp,
        magic_link: token,
        link_expiry: expiry,
        updated_at: new Date().toISOString()
      })
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('Error updating contact:', errorText);
      throw new Error(`Failed to update contact: ${updateResponse.status}`);
    }

    let updatedContact;
    const responseText = await updateResponse.text();
    
    if (responseText && responseText.length > 0) {
      try {
        const parsed = JSON.parse(responseText);
        updatedContact = parsed[0] || parsed;
      } catch (e) {
        console.warn('Could not parse update response, using existing contact data');
        updatedContact = {
          ...contact,
          otp: otp,
          magic_link: token,
          link_expiry: expiry,
          updated_at: new Date().toISOString()
        };
      }
    } else {
      updatedContact = {
        ...contact,
        otp: otp,
        magic_link: token,
        link_expiry: expiry,
        updated_at: new Date().toISOString()
      };
    }
    
    console.log(`[SP_GenerateMagicLink] Updated contact with magic link data`);

    // 4. Send OTP email
    console.log(`[SP_GenerateMagicLink] Sending OTP email to: ${email}`);
    
    let emailSent = false;
    try {
      const emailUrl = `${APP_URL}/api/send-otp-email`;
      console.log(`[SP_GenerateMagicLink] Email URL: ${emailUrl}`);
      
      const emailResponse = await fetch(emailUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, token })
      });

      const emailResult = await emailResponse.json();
      
      if (emailResult.success) {
        emailSent = true;
        console.log(`[SP_GenerateMagicLink] ✅ Email sent to: ${email}`);
      } else {
        console.error(`[SP_GenerateMagicLink] ❌ Email failed:`, emailResult.error);
      }
    } catch (emailError) {
      console.error(`[SP_GenerateMagicLink] ❌ Email error:`, emailError);
      // Non-critical - continue even if email fails
    }

    // 5. Generate magic link URL
    const magicLink = generateMagicLink(email, token, otp);

    // ============================================================
    // RESPONSE
    // ============================================================

    const responseData = {
      success: true,
      status: 'success',
      message: emailSent ? 'Magic link generated successfully. Check your email for the OTP.' : 'Magic link generated but email could not be sent. Please contact support.',
      
      otp: otp,
      token: token,
      magicLink: magicLink,
      
      contactId: contact.id,
      email: email,
      firstName: updatedContact.first_name || '',
      lastName: updatedContact.last_name || '',
      isNewContact: isNewContact,
      
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
      
      apiCallsUsed: isNewContact ? 3 : 2,
      apiCallsDetails: isNewContact ? 'Find + Create + Update' : 'Find + Update',
      remainingRequests: rateCheck.remaining,
      emailSent: emailSent,
      redirect: `https://www.turnkii.es/otp?email=${encodeURIComponent(email)}&token=${token}`
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

export {
  generateOTP,
  generateToken,
  generateMagicLink
};