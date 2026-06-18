// api/sp-get-contact-test.js
// This version uses native fetch, bypassing the supabase-js client for debugging

export default async function handler(req, res) {
  const CORS_ORIGIN = 'https://www.turnkii.es';

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  // === HARDCODED FOR DEBUGGING ===
  const supabaseUrl = 'https://njieyqkdsrkkmgtwrmlg.supabase.co';
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qaWV5cWtkc3Jra21ndHdybWxnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MTA0MzksImV4cCI6MjA5NzI4NjQzOX0.5saOCpl3_OsMe4Nchv3kgaC7oAo9fpGIU2dMPRx41OU';
  // ===============================

  try {
    console.log(`🔍 fetch-test: Searching for email: ${email}`);

    // Construct the Supabase REST API URL
    const url = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
    console.log(`🔍 fetch-test: URL: ${url}`);

    const response = await fetch(url, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    });

    console.log(`🔍 fetch-test: Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ fetch-test: API error: ${response.status} - ${errorText}`);
      return res.status(response.status).json({
        error: `Supabase API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    console.log(`🔍 fetch-test: Data received:`, data);

    if (!data || data.length === 0) {
      console.log(`❌ fetch-test: No contact found for email: ${email}`);
      return res.status(404).json({ error: 'Contact not found' });
    }

    const contact = data[0];
    console.log(`✅ fetch-test: Contact found with ID: ${contact.id}`);

    return res.status(200).json({
      success: true,
      contact: {
        id: contact.id,
        email: contact.email || '',
        firstName: contact.first_name || '',
        lastName: contact.last_name || '',
        phone: contact.phone || '',
        otp: contact.otp || '',
        token: contact.magic_link || '',
        linkExpiry: contact.link_expiry || '',
        createdAt: contact.created_at || '',
        updatedAt: contact.updated_at || '',
      }
    });

  } catch (error) {
    console.error('❌ fetch-test: Unhandled error:', error);
    return res.status(500).json({
      error: 'Failed to fetch contact',
      details: error.message
    });
  }
}