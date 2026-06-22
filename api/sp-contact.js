// api/sp-contact.js
// Consolidated Supabase contact operations - handles GET, CREATE, UPDATE, MAGIC_LINK, VERIFY_OTP, VERIFY_TOKEN, LOGOUT
// Includes rate limiting, email sending, account creation, and document management

// ============================================================
// CONFIGURATION
// ============================================================

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://www.turnkii.es';
const APP_URL = process.env.APP_URL || 'https://project-qv4f9.vercel.app';

// ============================================================
// RATE LIMITING (per email for magic_link)
// ============================================================

const rateLimits = new Map();

function checkRateLimit(email, limitMinutes = 5, maxRequests = 3) {
  const now = Date.now();
  const key = `sp_magic_${email}`;
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
// HELPERS
// ============================================================

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken() {
  return [...Array(32)]
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join("");
}

// Ensure contact has an account (create if missing)
async function ensureAccount(contactId, supabaseUrl, supabaseKey) {
  const findUrl = `${supabaseUrl}/rest/v1/contacts?id=eq.${contactId}&select=account_id,role`;
  const findRes = await fetch(findUrl, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  if (!findRes.ok) return false;
  const data = await findRes.json();
  const contact = data[0];
  if (!contact) return false;
  if (contact.account_id) return true;

  const createAccountUrl = `${supabaseUrl}/rest/v1/accounts`;
  const accountRes = await fetch(createAccountUrl, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({}),
  });
  if (!accountRes.ok) return false;
  const accountData = await accountRes.json();
  const accountId = accountData[0]?.id;
  if (!accountId) return false;

  const updateUrl = `${supabaseUrl}/rest/v1/contacts?id=eq.${contactId}`;
  const updateRes = await fetch(updateUrl, {
    method: 'PATCH',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      account_id: accountId,
      role: 'primary',
      updated_at: new Date().toISOString()
    })
  });
  return updateRes.ok;
}

// Ensure documents exist for a contact (trigger will handle this for new contacts,
// but this is a safety net)
async function ensureDocuments(contactId, supabaseUrl, supabaseKey) {
  const typesUrl = `${supabaseUrl}/rest/v1/document_types?created_on_signup=eq.true&select=name`;
  const typesRes = await fetch(typesUrl, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  if (!typesRes.ok) return false;
  const types = await typesRes.json();
  if (!types || types.length === 0) return true;

  const docsUrl = `${supabaseUrl}/rest/v1/documents?contact_id=eq.${contactId}&select=document_type`;
  const docsRes = await fetch(docsUrl, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  if (!docsRes.ok) return false;
  const existingDocs = await docsRes.json();
  const existingTypes = existingDocs.map(d => d.document_type);

  const missing = types.filter(t => !existingTypes.includes(t.name));
  if (missing.length === 0) return true;

  const insertPromises = missing.map(t => {
    return fetch(`${supabaseUrl}/rest/v1/documents`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contact_id: contactId,
        document_type: t.name,
        status: 'pending',
        provider: null,
      })
    });
  });
  await Promise.all(insertPromises);
  return true;
}

// ============================================================
// MAIN HANDLER
// ============================================================

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Parse body for POST
  let body = '';
  await new Promise((resolve) => {
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try { req.body = body ? JSON.parse(body) : {}; } catch (e) { req.body = {}; }
      resolve();
    });
  });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      success: false,
      error: 'Server configuration error'
    });
  }

  try {
    // ============================================================
    // GET: Fetch contact by email OR fetch documents for a user
    // ============================================================
    if (req.method === 'GET') {
      const { email, action } = req.query;

      if (!email) {
        return res.status(400).json({ success: false, error: 'Email is required' });
      }

      if (action === 'get_documents') {
        // Find contact
        const findContactUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=id`;
        const contactResponse = await fetch(findContactUrl, {
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
        });
        if (!contactResponse.ok) {
          const errorText = await contactResponse.text();
          return res.status(contactResponse.status).json({
            success: false,
            error: 'Failed to fetch contact',
            details: errorText
          });
        }
        const contactData = await contactResponse.json();
        if (!contactData || contactData.length === 0) {
          return res.status(404).json({ success: false, error: 'Contact not found' });
        }
        const contactId = contactData[0].id;

        // Fetch documents
        const docsUrl = `${supabaseUrl}/rest/v1/documents?contact_id=eq.${contactId}&select=*`;
        const docsResponse = await fetch(docsUrl, {
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
        });
        if (!docsResponse.ok) {
          const errorText = await docsResponse.text();
          return res.status(docsResponse.status).json({
            success: false,
            error: 'Failed to fetch documents',
            details: errorText
          });
        }
        let documents = await docsResponse.json();

        // Enrich with document types
        try {
          const typesUrl = `${supabaseUrl}/rest/v1/document_types?select=*`;
          const typesResponse = await fetch(typesUrl, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
          });
          if (typesResponse.ok) {
            const types = await typesResponse.json();
            const typeMap = {};
            types.forEach(t => { typeMap[t.name] = t; });
            documents = documents.map(doc => {
              const type = typeMap[doc.document_type] || {};
              return {
                ...doc,
                display_name: type.display_name || doc.document_type,
                requires_signing: type.requires_signing || false,
                store_file_1d: type.store_file_1d || false,
                file_template: type.file_template || null,
              };
            });
          }
        } catch (typeError) {
          console.error('Error fetching document types:', typeError);
        }

        return res.status(200).json({ success: true, documents });
      }

      // Default GET: Fetch contact by email
      const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
      const response = await fetch(findUrl, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
      });
      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({
          success: false,
          error: 'Failed to fetch contact',
          details: errorText
        });
      }
      const data = await response.json();
      if (!data || data.length === 0) {
        return res.status(404).json({ success: false, error: 'Contact not found' });
      }
      const contact = data[0];

      return res.status(200).json({
        success: true,
        contact: {
          id: contact.id,
          email: contact.email || '',
          firstName: contact.first_name || '',
          lastName: contact.last_name || '',
          mobileNumber: contact.mobile_number || '',
          mobileCountryCode: contact.mobile_country_code || '+34',
          fullName: (contact.first_name || '' + ' ' + contact.last_name || '').trim(),
          otp: contact.otp || '',
          magicLink: contact.magic_link || '',
          linkExpiry: contact.link_expiry || '',
        }
      });
    }

    // ============================================================
    // POST: Actions
    // ============================================================
    if (req.method === 'POST') {
      const { action, email, firstName, lastName, mobileNumber, mobileCountryCode, otp, token, expiry } = req.body;

      if (!email) {
        return res.status(400).json({ success: false, error: 'Email is required' });
      }

      // ----------------------------------------------------------
      // UPDATE
      // ----------------------------------------------------------
      if (action === 'update') {
        if (!firstName) {
          return res.status(400).json({ success: false, error: 'First name is required' });
        }
        if (!lastName) {
          return res.status(400).json({ success: false, error: 'Last name is required' });
        }

        const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
        const findResponse = await fetch(findUrl, {
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
        });
        if (!findResponse.ok) {
          const errorText = await findResponse.text();
          return res.status(findResponse.status).json({
            success: false,
            error: 'Failed to find contact',
            details: errorText
          });
        }
        const findData = await findResponse.json();
        if (!findData || findData.length === 0) {
          return res.status(404).json({ success: false, error: 'Contact not found' });
        }
        const contact = findData[0];

        // Only set country code if mobileNumber is provided and not empty
        const finalCountryCode = (mobileNumber && mobileNumber.trim() !== '') 
          ? (mobileCountryCode || contact.mobile_country_code || '+34')
          : contact.mobile_country_code;
        const finalMobileNumber = mobileNumber || contact.mobile_number || '';

        const updateUrl = `${supabaseUrl}/rest/v1/contacts?id=eq.${contact.id}`;
        const updateResponse = await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            first_name: firstName,
            last_name: lastName,
            mobile_country_code: finalCountryCode,
            mobile_number: finalMobileNumber,
            updated_at: new Date().toISOString()
          })
        });
        if (!updateResponse.ok) {
          const errorText = await updateResponse.text();
          return res.status(updateResponse.status).json({
            success: false,
            error: 'Failed to update contact',
            details: errorText
          });
        }
        const updateData = await updateResponse.json();
        const updatedContact = updateData[0] || updateData;

        return res.status(200).json({
          success: true,
          message: 'Profile updated successfully',
          contact: {
            id: updatedContact.id,
            email: updatedContact.email || '',
            firstName: updatedContact.first_name || '',
            lastName: updatedContact.last_name || '',
            mobileNumber: updatedContact.mobile_number || '',
            mobileCountryCode: updatedContact.mobile_country_code || '+34',
            fullName: (updatedContact.first_name || '' + ' ' + updatedContact.last_name || '').trim(),
          }
        });
      }

      // ----------------------------------------------------------
      // CREATE
      // ----------------------------------------------------------
      if (action === 'create') {
        if (!firstName) {
          return res.status(400).json({ success: false, error: 'First name is required' });
        }
        if (!lastName) {
          return res.status(400).json({ success: false, error: 'Last name is required' });
        }

        // Check if contact already exists
        const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
        const findResponse = await fetch(findUrl, {
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
        });
        if (findResponse.ok) {
          const findData = await findResponse.json();
          if (findData && findData.length > 0) {
            return res.status(409).json({
              success: false,
              error: 'Contact already exists with this email'
            });
          }
        }

        // Create account
        const createAccountUrl = `${supabaseUrl}/rest/v1/accounts`;
        const accountRes = await fetch(createAccountUrl, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({}),
        });
        if (!accountRes.ok) {
          const errorText = await accountRes.text();
          throw new Error(`Failed to create account: ${errorText}`);
        }
        const accountData = await accountRes.json();
        const accountId = accountData[0]?.id;

        // Create contact with account_id
        const createContactUrl = `${supabaseUrl}/rest/v1/contacts`;
        const contactRes = await fetch(createContactUrl, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            email,
            first_name: firstName,
            last_name: lastName,
            account_id: accountId,
            role: 'primary',
            mobile_country_code: mobileCountryCode || '+34',
            mobile_number: mobileNumber || '',
          }),
        });
        if (!contactRes.ok) {
          const errorText = await contactRes.text();
          throw new Error(`Failed to create contact: ${errorText}`);
        }
        const contactData = await contactRes.json();
        const newContact = contactData[0] || contactData;

        return res.status(200).json({
          success: true,
          message: 'Contact created successfully',
          contact: {
            id: newContact.id,
            email: newContact.email || '',
            firstName: newContact.first_name || '',
            lastName: newContact.last_name || '',
            mobileNumber: newContact.mobile_number || '',
            mobileCountryCode: newContact.mobile_country_code || '+34',
          }
        });
      }

      // ----------------------------------------------------------
      // MAGIC_LINK (generate OTP and send email)
      // ----------------------------------------------------------
      if (action === 'magic_link') {
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return res.status(400).json({ success: false, error: 'Invalid email format' });
        }

        // Rate limiting
        const rateCheck = checkRateLimit(email, 5, 3);
        if (!rateCheck.allowed) {
          return res.status(429).json({
            success: false,
            error: `Too many requests. Please wait ${rateCheck.waitMinutes} minute(s) before requesting another code.`
          });
        }

        console.log(`[MAGIC_LINK] Starting for email:`, email);

        const otpCode = generateOTP();
        const tokenCode = generateToken();
        const expiryTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        try {
          // Check if contact exists
          const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
          const findResponse = await fetch(findUrl, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
          });
          if (!findResponse.ok) {
            const errorText = await findResponse.text();
            console.error('[MAGIC_LINK] Failed to find contact:', errorText);
            return res.status(findResponse.status).json({
              success: false,
              error: 'Failed to find contact',
              details: errorText
            });
          }
          const findData = await findResponse.json();
          let contact = findData[0];
          let isNewContact = false;

          // If contact does not exist, create one (and an account)
          if (!contact) {
            console.log('[MAGIC_LINK] Contact not found; creating new account and contact...');
            try {
              // Create account
              const createAccountUrl = `${supabaseUrl}/rest/v1/accounts`;
              const accountRes = await fetch(createAccountUrl, {
                method: 'POST',
                headers: {
                  'apikey': supabaseKey,
                  'Authorization': `Bearer ${supabaseKey}`,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=representation',
                },
                body: JSON.stringify({}),
              });
              if (!accountRes.ok) {
                const errorText = await accountRes.text();
                console.error('[MAGIC_LINK] Failed to create account:', errorText);
                throw new Error(`Failed to create account: ${errorText}`);
              }
              const accountData = await accountRes.json();
              const accountId = accountData[0]?.id;
              console.log('[MAGIC_LINK] Account created with id:', accountId);

              // Create contact
              const createContactUrl = `${supabaseUrl}/rest/v1/contacts`;
              const contactRes = await fetch(createContactUrl, {
                method: 'POST',
                headers: {
                  'apikey': supabaseKey,
                  'Authorization': `Bearer ${supabaseKey}`,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=representation',
                },
                body: JSON.stringify({
                  email,
                  first_name: firstName || email.split('@')[0],
                  last_name: lastName || '',
                  account_id: accountId,
                  role: 'primary',
                  mobile_country_code: '+34',
                  mobile_number: '',
                }),
              });
              if (!contactRes.ok) {
                const errorText = await contactRes.text();
                console.error('[MAGIC_LINK] Failed to create contact:', errorText);
                throw new Error(`Failed to create contact: ${errorText}`);
              }
              const contactData = await contactRes.json();
              contact = contactData[0] || contactData;
              isNewContact = true;
              console.log('[MAGIC_LINK] Contact created with id:', contact.id);
            } catch (createError) {
              console.error('[MAGIC_LINK] Error during account/contact creation:', createError);
              return res.status(500).json({
                success: false,
                error: 'Failed to create account/contact',
                details: createError.message
              });
            }
          } else {
            console.log('[MAGIC_LINK] Contact found with id:', contact.id);
          }

          // Update contact with OTP and magic link
          const updateUrl = `${supabaseUrl}/rest/v1/contacts?id=eq.${contact.id}`;
          const updateResponse = await fetch(updateUrl, {
            method: 'PATCH',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation',
            },
            body: JSON.stringify({
              otp: otpCode,
              magic_link: tokenCode,
              link_expiry: expiryTime,
              updated_at: new Date().toISOString()
            })
          });
          if (!updateResponse.ok) {
            const errorText = await updateResponse.text();
            console.error('[MAGIC_LINK] Failed to update contact:', errorText);
            return res.status(updateResponse.status).json({
              success: false,
              error: 'Failed to update contact with magic link',
              details: errorText
            });
          }
          const updateData = await updateResponse.json();
          const updatedContact = updateData[0] || updateData;
          console.log('[MAGIC_LINK] Contact updated successfully');

          // Send OTP email
          let emailSent = false;
          try {
            const emailRes = await fetch(`${APP_URL}/api/send-otp-email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, otp: otpCode })
            });
            const emailResult = await emailRes.json();
            if (emailResult.success) {
              emailSent = true;
              console.log(`[MAGIC_LINK] Email sent to ${email}`);
            } else {
              console.error('[MAGIC_LINK] Email sending failed:', emailResult.error);
            }
          } catch (emailError) {
            console.error('[MAGIC_LINK] Email error:', emailError);
          }

          // Return success (token is included for compatibility, but frontend shouldn't rely on it)
          return res.status(200).json({
            success: true,
            otp: otpCode,
            token: tokenCode,
            expiry: expiryTime,
            contactId: contact.id,
            email: email,
            firstName: updatedContact.first_name || '',
            lastName: updatedContact.last_name || '',
            isNewContact: isNewContact,
            emailSent: emailSent,
            remainingRequests: rateCheck.remaining,
            redirect: `https://www.turnkii.es/otp?email=${encodeURIComponent(email)}`
          });
        } catch (error) {
          console.error('[MAGIC_LINK] Unhandled error:', error);
          return res.status(500).json({
            success: false,
            error: 'Failed to generate magic link',
            details: error.message
          });
        }
      }

      // ----------------------------------------------------------
      // VERIFY_OTP
      // ----------------------------------------------------------
      if (action === 'verify_otp') {
        if (!otp) {
          return res.status(400).json({ success: false, error: 'OTP is required' });
        }

        const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
        const findResponse = await fetch(findUrl, {
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
        });
        if (!findResponse.ok) {
          const errorText = await findResponse.text();
          return res.status(findResponse.status).json({
            success: false,
            error: 'Failed to find contact',
            details: errorText
          });
        }
        const findData = await findResponse.json();
        if (!findData || findData.length === 0) {
          return res.status(404).json({ success: false, error: 'Contact not found' });
        }
        const contact = findData[0];

         // Verify OTP
        if (contact.otp !== otp) {
          return res.status(401).json({ success: false, error: 'Invalid OTP' });
        }
        if (contact.link_expiry && new Date(contact.link_expiry) < new Date()) {
          return res.status(401).json({ success: false, error: 'OTP has expired' });
        }
        
        // Mark email as verified (if not already)
        const updatePayload = {
          otp: null,
          email_verified: true,
          updated_at: new Date().toISOString()
        };

        const updateUrl = `${supabaseUrl}/rest/v1/contacts?id=eq.${contact.id}`;
        await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updatePayload)
        });

        // Ensure account and documents exist (safety net)
        await ensureAccount(contact.id, supabaseUrl, supabaseKey);
        await ensureDocuments(contact.id, supabaseUrl, supabaseKey);

        // Clear OTP
        const updateUrl = `${supabaseUrl}/rest/v1/contacts?id=eq.${contact.id}`;
        await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            otp: null,
            updated_at: new Date().toISOString()
          })
        });

        return res.status(200).json({
          success: true,
          message: 'OTP verified successfully',
          token: contact.magic_link,
          email: contact.email,
        });
      }

      // ----------------------------------------------------------
      // VERIFY_TOKEN
      // ----------------------------------------------------------
      if (action === 'verify_token') {
        if (!token) {
          return res.status(400).json({ success: false, error: 'Token is required' });
        }

        const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
        const findResponse = await fetch(findUrl, {
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
        });
        if (!findResponse.ok) {
          const errorText = await findResponse.text();
          return res.status(findResponse.status).json({
            success: false,
            error: 'Failed to find contact',
            details: errorText
          });
        }
        const findData = await findResponse.json();
        if (!findData || findData.length === 0) {
          return res.status(404).json({ success: false, error: 'Contact not found' });
        }
        const contact = findData[0];

        if (contact.magic_link !== token) {
          return res.status(401).json({ success: false, error: 'Invalid token' });
        }
        if (contact.link_expiry && new Date(contact.link_expiry) < new Date()) {
          return res.status(401).json({ success: false, error: 'Token has expired' });
        }

        // Ensure account and documents exist (safety net)
        await ensureAccount(contact.id, supabaseUrl, supabaseKey);
        await ensureDocuments(contact.id, supabaseUrl, supabaseKey);

        return res.status(200).json({
          success: true,
          message: 'Token verified successfully',
          email: contact.email,
          firstName: contact.first_name || '',
          lastName: contact.last_name || '',
          fullName: (contact.first_name || '' + ' ' + contact.last_name || '').trim(),
          mobileNumber: contact.mobile_number || '',
          mobileCountryCode: contact.mobile_country_code || '+34',
        });
      }

      // ----------------------------------------------------------
      // LOGOUT
      // ----------------------------------------------------------
      if (action === 'logout') {
        if (!token) {
          return res.status(400).json({ success: false, error: 'Token is required' });
        }

        const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
        const findResponse = await fetch(findUrl, {
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
        });
        if (!findResponse.ok) {
          const errorText = await findResponse.text();
          return res.status(findResponse.status).json({
            success: false,
            error: 'Failed to find contact',
            details: errorText
          });
        }
        const findData = await findResponse.json();
        if (!findData || findData.length === 0) {
          return res.status(404).json({ success: false, error: 'Contact not found' });
        }
        const contact = findData[0];

        if (contact.magic_link !== token) {
          return res.status(401).json({ success: false, error: 'Invalid token' });
        }

        const updateUrl = `${supabaseUrl}/rest/v1/contacts?id=eq.${contact.id}`;
        const updateResponse = await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            magic_link: null,
            link_expiry: null,
            updated_at: new Date().toISOString()
          })
        });
        if (!updateResponse.ok) {
          const errorText = await updateResponse.text();
          return res.status(updateResponse.status).json({
            success: false,
            error: 'Failed to logout',
            details: errorText
          });
        }
        return res.status(200).json({ success: true, message: 'Logged out successfully' });
      }

      // Unrecognized action
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Valid actions: update, create, magic_link, verify_otp, verify_token, logout'
      });
    }

    // Unsupported method
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (error) {
    console.error('[SP_Contact] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error',
      details: error.message
    });
  }
}