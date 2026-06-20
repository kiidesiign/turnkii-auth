// api/signforge/create.js
const SIGNFORGE_API_BASE = 'https://signforge.io/api/v1';
const SIGNFORGE_API_KEY = process.env.SIGNFORGE_API_KEY || process.env.SIGNFORGE_KEY;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Minimal valid PDF (base64)
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
    // Parse request body
    let body = '';
    await new Promise((resolve) => {
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try { req.body = body ? JSON.parse(body) : {}; } catch (e) { req.body = {}; }
        resolve();
      });
    });

    const { email, firstName, lastName } = req.body;

    console.log('🔍 Received request:', { email, firstName, lastName });

    if (!email || !firstName || !lastName) {
      return res.status(400).json({ error: 'Email, firstName, and lastName are required' });
    }

    if (!SIGNFORGE_API_KEY) {
      console.error('❌ SIGNFORGE_API_KEY is not set');
      return res.status(500).json({ error: 'API key not configured' });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      console.error('❌ Supabase credentials missing');
      return res.status(500).json({ error: 'Supabase credentials missing' });
    }

    // 1. Find or create contact in Supabase
    console.log('🔍 Finding/creating contact:', email);
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
    } else {
      console.log('✅ Contact found:', contact.id);
    }

    // 2. Call SignForge API
    const signforgePayload = {
      title: 'Test Agreement',
      pdf_base64: FALLBACK_PDF_BASE64,
      signer_email: email,
      signer_name: `${firstName} ${lastName}`,
      fields: [
        {
          recipient_index: 0,
          field_type: 'signature',
          page_index: 0,
          x_norm: 0.1,
          y_norm: 0.3,
          w_norm: 0.3,
          h_norm: 0.08,
        },
        {
          recipient_index: 0,
          field_type: 'text',
          page_index: 0,
          x_norm: 0.1,
          y_norm: 0.4,
          w_norm: 0.3,
          h_norm: 0.05,
          label: 'Full Name',
        },
        {
          recipient_index: 0,
          field_type: 'date',
          page_index: 0,
          x_norm: 0.1,
          y_norm: 0.47,
          w_norm: 0.2,
          h_norm: 0.05,
          label: 'Date',
        },
      ],
      webhook_url: `https://project-qv4f9.vercel.app/api/signforge/webhook?envelope_id={envelope_id}`,
      redirect_url: 'https://www.turnkii.es/account',
    };

    console.log('📤 Sending to SignForge...');
    console.log('📤 Payload:', JSON.stringify(signforgePayload, null, 2));

    const signforgeResponse = await fetch(`${SIGNFORGE_API_BASE}/quick-sign`, {
      method: 'POST',
      headers: {
        'X-API-Key': SIGNFORGE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(signforgePayload),
    });

    const data = await signforgeResponse.json();

    if (!signforgeResponse.ok) {
      console.error('❌ SignForge error response:', data);
      return res.status(signforgeResponse.status).json({
        error: data.message || data.detail || 'SignForge API error',
        details: data,
      });
    }

    const envelopeId = data.id || data.envelope_id;
    const signingUrl = data.signing_url || data.embedded_signing_url || data.url;

    // 3. Store in Supabase (optional)
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
            file_name: 'Test_Agreement.pdf',
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