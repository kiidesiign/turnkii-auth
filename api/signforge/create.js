// api/signforge/create.js
import path from 'path';

// ============================================================
// MINIMAL VALID PDF (base64)
// A simple one-page PDF with "Test" text, created from the curl test
// ============================================================
const FALLBACK_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqIDIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqIDMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL01lZGlhQm94IFswIDAgNjEyIDc5Ml0gL1BhcmVudCAyIDAgUiAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4gZW5kb2JqIDQgMCBvYmogPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+IGVuZG9iaiA1IDAgb2JqIDw8IC9MZW5ndGggNjMgPj4gc3RyZWFtCkJUIC9GMSAyNCBUZiAxMDAgNzAwIFRkIChUZXN0KSBUaiBFVE0KZW5kc3RyZWFtIGVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA2MiAwMDAwMCBuIAowMDAwMDAwMTE3IDAwMDAwIG4gCjAwMDAwMDAyMzQgMDAwMDAgbiAKMDAwMDAwMDI5NiAwMDAwMCBuIAp0cmFpbGVyIDw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjM3NQolJUVPRg==';

const SIGNFORGE_API_BASE = 'https://signforge.io/api/v1';
const SIGNFORGE_API_KEY = process.env.SIGNFORGE_API_KEY;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', 'https://www.turnkii.es');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

  if (!email || !firstName || !lastName) {
    return res.status(400).json({ error: 'Email, firstName, and lastName are required' });
  }

  // Validate environment variables
  if (!SIGNFORGE_API_KEY) {
    console.error('❌ SIGNFORGE_API_KEY is not set');
    return res.status(500).json({ error: 'Server configuration error: API key missing' });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Supabase credentials missing');
    return res.status(500).json({ error: 'Server configuration error: Supabase credentials missing' });
  }

  try {
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
        throw new Error(`Supabase create failed: ${createResponse.status} ${errorText}`);
      }

      const createData = await createResponse.json();
      contact = createData[0] || createData;
      console.log('✅ Contact created:', contact.id);
    } else {
      console.log('✅ Contact found:', contact.id);
    }

    // 2. Prepare the PDF (use embedded base64)
    const pdfBase64 = FALLBACK_PDF_BASE64;
    console.log('📄 Using embedded PDF (size:', pdfBase64.length, 'chars)');

    // 3. Call SignForge API
    const signforgePayload = {
      title: 'Test Agreement',
      pdf_base64: pdfBase64,
      fields: [
        {
          name: 'signature',
          type: 'signature',
          page: 1,
          x: 100,
          y: 200,
          width: 200,
          height: 60,
          recipient_email: email,
        },
        {
          name: 'full_name',
          type: 'text',
          page: 1,
          x: 100,
          y: 280,
          width: 200,
          height: 30,
          recipient_email: email,
        },
        {
          name: 'date',
          type: 'date',
          page: 1,
          x: 100,
          y: 330,
          width: 150,
          height: 30,
          recipient_email: email,
        },
      ],
      recipients: [
        {
          email: email,
          name: `${firstName} ${lastName}`,
          role: 'signer',
        },
      ],
      embedded: true,
      webhook_url: `https://project-qv4f9.vercel.app/api/signforge/webhook?envelope_id={envelope_id}`,
      redirect_url: 'https://www.turnkii.es/account',
    };

    console.log('📤 Sending to SignForge...');
    const signforgeResponse = await fetch(`${SIGNFORGE_API_BASE}/envelopes`, {
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

    const envelopeId = data.id;
    const signingUrl = data.embedded_signing_url || data.signing_url;
    console.log('✅ SignForge envelope created:', envelopeId);

    // 4. Store document in Supabase
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
      console.log('✅ Document stored in Supabase');
    } catch (docError) {
      console.error('⚠️ Failed to store document:', docError);
    }

    return res.status(200).json({
      success: true,
      envelopeId: envelopeId,
      signingUrl: signingUrl,
    });

  } catch (error) {
    console.error('❌ SignForge create error:', error);
    return res.status(500).json({
      error: error.message,
      stack: error.stack,
    });
  }
}