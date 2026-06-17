// api/get-contact.js
import Airtable from 'airtable';

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
  console.log(`Request received for email: ${email}`);

  if (!email) {
    console.log('No email provided');
    return res.status(400).json({ error: 'Email is required' });
  }

  // Check environment variables
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME;

  console.log('Environment check:', {
    hasApiKey: !!apiKey,
    hasBaseId: !!baseId,
    hasTableName: !!tableName,
    apiKeyPrefix: apiKey ? apiKey.substring(0, 10) : 'missing',
    baseIdPrefix: baseId ? baseId.substring(0, 10) : 'missing'
  });

  if (!apiKey || !baseId || !tableName) {
    console.error('Missing environment variables');
    return res.status(500).json({ 
      error: 'Server configuration error',
      missing: {
        apiKey: !apiKey,
        baseId: !baseId,
        tableName: !tableName
      }
    });
  }

  try {
    // Initialize Airtable
    console.log('Initializing Airtable...');
    const base = new Airtable({ apiKey: apiKey }).base(baseId);
    
    console.log(`Searching for email: ${email}`);
    
    // Search for the contact
    const records = await base(tableName)
      .select({
        filterByFormula: `{Email} = "${email}"`,
        maxRecords: 1
      })
      .firstPage();

    console.log(`Found ${records.length} records`);

    if (records.length === 0) {
      console.log(`No contact found for email: ${email}`);
      return res.status(404).json({ error: 'Contact not found' });
    }

    const record = records[0];
    console.log(`Contact found with ID: ${record.id}`);
    
    // Extract all fields including magic link fields
    const fields = record.fields;
    
    const contact = {
      id: record.id,
      // Original fields
      email: fields.Email || '',
      firstName: fields['First Name'] || '',
      lastName: fields['Last Name'] || '',
      phone: fields.Phone || '',
      passportUrl: fields['Passport URL'] || '',
      gdprSigned: fields['GDPR Signed'] || false,
      
      // New magic link fields
      otp: fields.OTP || '',
      token: fields.Token || '',
      otpVerified: fields['OTP_Verified'] || false,
      otpGeneratedAt: fields['OTP_Generated_At'] || '',
      lastMagicLinkSent: fields['Last_Magic_Link_Sent'] || '',
      createdAt: fields['Created_At'] || '',
      
      // Full fields object for debugging
      allFields: fields
    };

    console.log('Returning contact data with magic link fields');
    return res.status(200).json({ 
      success: true, 
      contact: contact,
      // Also return the raw fields for the HTML page
      fields: fields,
      id: record.id
    });

  } catch (error) {
    console.error('Airtable error details:', {
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