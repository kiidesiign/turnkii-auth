// api/sp-get-contact.js
// UPDATED: Use service role key to bypass RLS

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

  // Only allow GET
  if (req.method !== 'GET') {
    console.log(`Method not allowed: ${req.method}`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.query;
  console.log(`📧 Request received for email: ${email}`);

  if (!email) {
    console.log('❌ No email provided');
    return res.status(400).json({ error: 'Email is required' });
  }

  // Use SERVICE ROLE KEY to bypass RLS
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  console.log('🔍 Environment check:', {
    hasSupabaseUrl: !!supabaseUrl,
    hasSupabaseKey: !!supabaseKey,
    supabaseUrlValue: supabaseUrl,
    supabaseKeyPrefix: supabaseKey ? supabaseKey.substring(0, 20) + '...' : 'missing'
  });

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing environment variables');
    return res.status(500).json({
      error: 'Server configuration error',
      missing: {
        supabaseUrl: !supabaseUrl,
        supabaseKey: !supabaseKey
      }
    });
  }

  try {
    console.log(`🔍 Searching for email: ${email}`);

    // Use native fetch with service role key
    const url = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
    console.log(`🔍 URL: ${url}`);

    const response = await fetch(url, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ API error: ${response.status} - ${errorText}`);
      return res.status(response.status).json({
        error: `Supabase API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();

    if (!data || data.length === 0) {
      console.log(`❌ No contact found for email: ${email}`);
      return res.status(404).json({ error: 'Contact not found' });
    }

    const contact = data[0];
    console.log(`✅ Contact found with ID: ${contact.id}`);

    // Format the contact data
    const formattedContact = {
      id: contact.id,
      email: contact.email || '',
      firstName: contact.first_name || '',
      lastName: contact.last_name || '',
      phone: contact.phone || '',
      otp: contact.otp || '',
      token: contact.magic_link || '',
      otpVerified: false,
      otpGeneratedAt: contact.updated_at || '',
      linkExpiry: contact.link_expiry || '',
      createdAt: contact.created_at || '',
      updatedAt: contact.updated_at || '',
    };

    console.log('📤 Returning contact data');
    return res.status(200).json({
      success: true,
      contact: formattedContact,
      fields: contact,
      id: contact.id
    });

  } catch (error) {
    console.error('❌ Supabase error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });

    return res.status(500).json({
      error: 'Failed to fetch contact',
      details: error.message
    });
  }
}