// api/signforge/create-template.js
// Dedicated endpoint for SignForge template-based signing
// Uses /quick-sign endpoint with template_id

const SIGNFORGE_API_BASE = 'https://signforge.io/api/v1';
const SIGNFORGE_API_KEY = process.env.SIGNFORGE_API_KEY || process.env.SIGNFORGE_KEY;

// ⚠️ REPLACE THIS WITH YOUR ACTUAL TEMPLATE ID
const TEMPLATE_ID = '7c08b4a0-faf3-4787-ae06-3ae6cc49efc2';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Minimal PDF fallback
const FALLBACK_PDF_BASE64 = 'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqIDIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqIDMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL01lZGlhQm94IFswIDAgNjEyIDc5Ml0gL1BhcmVudCAyIDAgUiAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4gZW5kb2JqIDQgMCBvYmogPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+IGVuZG9iaiA1IDAgb2JqIDw8IC9MZW5ndGggNjMgPj4gc3RyZWFtCkJUIC9GMSAyNCBUZiAxMDAgNzAwIFRkIChUZXN0KSBUaiBFVE0KZW5kc3RyZWFtIGVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA2MiAwMDAwMCBuIAowMDAwMDAwMTE3IDAwMDAwIG4gCjAwMDAwMDAyMzQgMDAwMDAgbiAKMDAwMDAwMDI5NiAwMDAwMCBuIAp0cmFpbGVyIDw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjM3NQolJUVPRg==';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', 'https://www.turnkii.es');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let body = '';
    await new Promise((resolve) => {
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try { req.body = body ? JSON.parse(body) : {}; } catch (e) { req.body = {}; }
        resolve();
      });
    });

    const { email, firstName, lastName } = req.body;

    console.log('📄 [create-template] Received:', { email, firstName, lastName });
    console.log('📄 [create-template] Using template ID:', TEMPLATE_ID);

    if (!email || !firstName || !lastName) {
      return res.status(400).json({ error: 'Email, firstName, and lastName are required' });
    }

    if (!SIGNFORGE_API_KEY) {
      console.error('❌ API key missing');
      return res.status(500).json({ error: 'API key not configured' });
    }

    // 1. Find or create contact in Supabase
    const findUrl = `${SUPABASE_URL}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
    const findResponse = await fetch(findUrl, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });

    if (!findResponse.ok) {
      const errorText = await findResponse.text();
      console.error('❌ Supabase find failed:', errorText);
      throw new Error(`Supabase find failed: ${findResponse.status} ${errorText}`);
    }

    const findData = await findResponse.json();
    let contact = findData[0];

    if (!contact) {
      console.log('🆕 Creating new contact');
      const createUrl = `${SUPABASE_URL}/rest/v1/contacts`;
      const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          email: email,
          first_name: firstName,
          last_name: lastName,
        }),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error('❌ Supabase create failed:', errorText);
        throw new Error(`Supabase create failed: ${createResponse.status} ${errorText}`);
      }

      const createData = await createResponse.json();
      contact = createData[0] || createData;
      console.log('✅ Contact created:', contact.id);
    }

    // 2. Build template payload for /quick-sign
    // This endpoint works with a template_id and doesn't require fields
    const endpoint = `${SIGNFORGE_API_BASE}/quick-sign`;
    const payload = {
      template_id: TEMPLATE_ID,
      title: 'Turnkii Terms and Conditions',
      pdf_base64: FALLBACK_PDF_BASE64, // Required by /quick-sign
      signer_email: email,
      signer_name: `${firstName} ${lastName}`,
      // No fields array – the template provides them
      embedded: true,
      webhook_url: `https://project-qv4f9.vercel.app/api/signforge/webhook?envelope_id={envelope_id}`,
      redirect_url: 'https://www.turnkii.es/account',
    };

    console.log('📤 [create-template] Sending to SignForge:', endpoint);
    console.log('📤 Payload:', JSON.stringify(payload, null, 2));

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'X-API-Key': SIGNFORGE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ SignForge error:', data);
      return res.status(response.status).json({
        error: data.message || data.detail || 'SignForge API error',
        details: data,
        debug: { endpoint, payload },
      });
    }

    const envelopeId = data.id || data.envelope_id;
    const signingUrl = data.embedded_signing_url || data.signing_url || data.url;

    // Store in Supabase
    if (envelopeId) {
      try {
        const docInsertUrl = `${SUPABASE_URL}/rest/v1/documents`;
        await fetch(docInsertUrl, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            contact_id: contact.id,
            file_name: 'Turnkii_Terms_and_Conditions.pdf',
            provider_request_id: envelopeId,
            provider: 'signforge',
            status: 'sent',
            sent_at: new Date().toISOString(),
          }),
        });
      } catch (docError) {
        console.error('⚠️ Failed to store document:', docError);
      }
    }

    return res.status(200).json({
      success: true,
      envelopeId: envelopeId,
      signingUrl: signingUrl,
      debug: { endpoint, templateId: TEMPLATE_ID },
    });

  } catch (error) {
    console.error('❌ Unhandled error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      stack: error.stack,
    });
  }
}