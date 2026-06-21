// api/sp-contact.js
// Consolidated Supabase contact operations - handles GET, CREATE, UPDATE
// Extended to support fetching user documents with enriched type info

export default async function handler(req, res) {
  const CORS_ORIGIN = 'https://www.turnkii.es';

  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Parse request body for POST
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

      // GET action: 'get_documents' - fetch documents enriched with type metadata
      if (action === 'get_documents') {
        // 1. Find contact id
        const findContactUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=id`;
        const contactResponse = await fetch(findContactUrl, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
          },
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

        // 2. Fetch documents
        const docsUrl = `${supabaseUrl}/rest/v1/documents?contact_id=eq.${contactId}&select=*`;
        const docsResponse = await fetch(docsUrl, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
          },
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

        // 3. Fetch document types to enrich the documents with display_name, requires_signing, etc.
        try {
          const typesUrl = `${supabaseUrl}/rest/v1/document_types?select=*`;
          const typesResponse = await fetch(typesUrl, {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
            },
          });

          if (typesResponse.ok) {
            const types = await typesResponse.json();
            // Create a map keyed by document_type name
            const typeMap = {};
            types.forEach(t => {
              typeMap[t.name] = t;
            });

            // Enrich each document with type metadata
            documents = documents.map(doc => {
              const type = typeMap[doc.document_type] || {};
              return {
                ...doc,
                display_name: type.display_name || doc.document_type,
                requires_signing: type.requires_signing || false,
                store_file_1d: type.store_file_1d || false,
                file_template: type.file_template || null,
                // You can add more fields if needed
              };
            });
          } else {
            // If types fetch fails, still return documents without enrichment (fallback)
            console.warn('Could not fetch document types; returning raw documents');
          }
        } catch (typeError) {
          console.error('Error fetching document types:', typeError);
          // Continue with raw documents
        }

        return res.status(200).json({ success: true, documents });
      }

      // Default GET: Fetch contact by email
      const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
      const response = await fetch(findUrl, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
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
          mobile: contact.mobile || '',
          fullName: (contact.first_name || '' + ' ' + contact.last_name || '').trim(),
          otp: contact.otp || '',
          magicLink: contact.magic_link || '',
          linkExpiry: contact.link_expiry || '',
          createdAt: contact.created_at || '',
          updatedAt: contact.updated_at || '',
        }
      });
    }

    // ============================================================
    // POST: Create or Update contact
    // ============================================================
    if (req.method === 'POST') {
      const { action, email, firstName, lastName, mobileNumber, mobileCountryCode, otp, token, expiry } = req.body;

      if (!email) {
        return res.status(400).json({ success: false, error: 'Email is required' });
      }

      // UPDATE
      if (action === 'update') {
        if (!firstName) {
          return res.status(400).json({ success: false, error: 'First name is required' });
        }
        if (!lastName) {
          return res.status(400).json({ success: false, error: 'Last name is required' });
        }

        const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
        const findResponse = await fetch(findUrl, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
          },
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

        const finalCountryCode = mobileCountryCode || contact.mobile_country_code || '+34';
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
            mobile: updatedContact.mobile || '',
            fullName: (updatedContact.first_name || '' + ' ' + updatedContact.last_name || '').trim(),
          }
        });
      }

      // CREATE
      if (action === 'create') {
        if (!firstName) {
          return res.status(400).json({ success: false, error: 'First name is required' });
        }
        if (!lastName) {
          return res.status(400).json({ success: false, error: 'Last name is required' });
        }

        const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
        const findResponse = await fetch(findUrl, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
          },
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

        const finalCountryCode = mobileCountryCode || '+34';
        const finalMobileNumber = mobileNumber || '';

        const createUrl = `${supabaseUrl}/rest/v1/contacts`;
        const createResponse = await fetch(createUrl, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            email: email,
            first_name: firstName,
            last_name: lastName,
            mobile_country_code: finalCountryCode,
            mobile_number: finalMobileNumber,
          })
        });

        if (!createResponse.ok) {
          const errorText = await createResponse.text();
          return res.status(createResponse.status).json({
            success: false,
            error: 'Failed to create contact',
            details: errorText
          });
        }

        const createData = await createResponse.json();
        const newContact = createData[0] || createData;

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
            mobile: newContact.mobile || '',
          }
        });
      }

      // MAGIC_LINK
      if (action === 'magic_link') {
        const otpCode = otp || Math.floor(100000 + Math.random() * 900000).toString();
        const tokenCode = token || [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");
        const expiryTime = expiry || new Date(Date.now() + 60 * 60 * 1000).toISOString();

        const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
        const findResponse = await fetch(findUrl, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
          },
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
          otp: otpCode,
          token: tokenCode,
          expiry: expiryTime,
          contact: {
            id: updatedContact.id,
            email: updatedContact.email || '',
            firstName: updatedContact.first_name || '',
            lastName: updatedContact.last_name || '',
          }
        });
      }

      // VERIFY_OTP
      if (action === 'verify_otp') {
        const { otp } = req.body;

        if (!otp) {
          return res.status(400).json({ success: false, error: 'OTP is required' });
        }

        const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
        const findResponse = await fetch(findUrl, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
          },
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

        if (contact.otp !== otp) {
          return res.status(401).json({ success: false, error: 'Invalid OTP' });
        }

        if (contact.link_expiry && new Date(contact.link_expiry) < new Date()) {
          return res.status(401).json({ success: false, error: 'OTP has expired' });
        }

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

      // LOGOUT
      if (action === 'logout') {
        const { token } = req.body;

        if (!token) {
          return res.status(400).json({ success: false, error: 'Token is required' });
        }

        const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
        const findResponse = await fetch(findUrl, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
          },
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

        return res.status(200).json({
          success: true,
          message: 'Logged out successfully'
        });
      }

      // VERIFY_TOKEN
      if (action === 'verify_token') {
        const { token } = req.body;

        if (!token) {
          return res.status(400).json({ success: false, error: 'Token is required' });
        }

        const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
        const findResponse = await fetch(findUrl, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
          },
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

        return res.status(200).json({
          success: true,
          message: 'Token verified successfully',
          email: contact.email,
          firstName: contact.first_name || '',
          lastName: contact.last_name || '',
          fullName: (contact.first_name || '' + ' ' + contact.last_name || '').trim(),
          mobileNumber: contact.mobile_number || '',
          mobileCountryCode: contact.mobile_country_code || '+34',
          mobile: contact.mobile || '',
        });
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