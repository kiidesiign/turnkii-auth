// api/sp-verify-token.js
// Verify magic link token and return contact data
// Extended to ensure account and documents exist

export default async function handler(req, res) {
  const CORS_ORIGIN = 'https://www.turnkii.es';

  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, token } = req.body;

    if (!email || !token) {
      return res.status(400).json({ valid: false, message: 'Email and token are required' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('❌ Supabase credentials missing');
      return res.status(500).json({ valid: false, message: 'Server configuration error' });
    }

    // ============================================================
    // HELPERS (copied from sp-contact.js)
    // ============================================================
    async function ensureAccount(contactId) {
      const findUrl = `${supabaseUrl}/rest/v1/contacts?id=eq.${contactId}&select=account_id,role`;
      const findRes = await fetch(findUrl, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
      });
      if (!findRes.ok) return;
      const data = await findRes.json();
      const contact = data[0];
      if (!contact) return;
      if (contact.account_id) return;

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
        console.error('❌ Failed to create account for contact', contactId);
        return;
      }
      const accountData = await accountRes.json();
      const accountId = accountData[0]?.id;
      if (!accountId) return;

      const updateUrl = `${supabaseUrl}/rest/v1/contacts?id=eq.${contactId}`;
      await fetch(updateUrl, {
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
      console.log(`✅ Account ${accountId} assigned to contact ${contactId}`);
    }

    async function ensureDocuments(contactId) {
      const typesUrl = `${supabaseUrl}/rest/v1/document_types?created_on_signup=eq.true&select=name`;
      const typesRes = await fetch(typesUrl, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
      });
      if (!typesRes.ok) return;
      const types = await typesRes.json();
      if (!types || types.length === 0) return;

      const docsUrl = `${supabaseUrl}/rest/v1/documents?contact_id=eq.${contactId}&select=document_type`;
      const docsRes = await fetch(docsUrl, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
      });
      if (!docsRes.ok) return;
      const existingDocs = await docsRes.json();
      const existingTypes = existingDocs.map(d => d.document_type);

      const missing = types.filter(t => !existingTypes.includes(t.name));
      if (missing.length === 0) return;

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
      console.log(`✅ Inserted missing documents for contact ${contactId}: ${missing.map(t => t.name).join(', ')}`);
    }

    // ============================================================
    // Find contact by email
    // ============================================================
    const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
    const findResponse = await fetch(findUrl, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    });

    if (!findResponse.ok) {
      const errorText = await findResponse.text();
      console.error('❌ Failed to find contact:', errorText);
      return res.status(findResponse.status).json({
        valid: false,
        message: 'Failed to find contact',
        details: errorText
      });
    }

    const data = await findResponse.json();
    if (!data || data.length === 0) {
      return res.status(404).json({ valid: false, message: 'Contact not found' });
    }

    const contact = data[0];

    // Verify token and expiry
    if (contact.magic_link !== token) {
      return res.status(401).json({ valid: false, message: 'Invalid token' });
    }

    if (contact.link_expiry && new Date(contact.link_expiry) < new Date()) {
      return res.status(401).json({ valid: false, message: 'Token has expired' });
    }

    // ============================================================
    // 🔧 FIX: Ensure account and documents exist for this contact
    // ============================================================
    await ensureAccount(contact.id);
    await ensureDocuments(contact.id);

    // Return contact data
    return res.status(200).json({
      valid: true,
      contact: {
        id: contact.id,
        email: contact.email,
        firstName: contact.first_name || '',
        lastName: contact.last_name || '',
        fullName: (contact.first_name || '' + ' ' + contact.last_name || '').trim(),
        mobileNumber: contact.mobile_number || '',
        mobileCountryCode: contact.mobile_country_code || '+34',
      }
    });

  } catch (error) {
    console.error('❌ sp-verify-token error:', error);
    return res.status(500).json({
      valid: false,
      message: 'Server error',
      details: error.message
    });
  }
}