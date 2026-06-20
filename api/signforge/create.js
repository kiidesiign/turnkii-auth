// api/signforge/create.js
import fs from 'fs';
import path from 'path';

const SIGNFORGE_API_BASE = 'https://api.signforge.io/v1';
const SIGNFORGE_API_KEY = process.env.SIGNFORGE_API_KEY;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', 'https://www.turnkii.es');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

  console.log('🔍 SignForge create - Environment check:', {
    hasSignforgeKey: !!SIGNFORGE_API_KEY,
    hasSupabaseUrl: !!SUPABASE_URL,
    hasSupabaseKey: !!SUPABASE_SERVICE_KEY,
  });

  try {
    // 1. Find or create contact
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
    }

    // 2. Prepare the PDF
    let pdfBase64;
    try {
      const pdfPath = path.join(process.cwd(), 'public', 'sample-document.pdf');
      const pdfBuffer = fs.readFileSync(pdfPath);
      pdfBase64 = pdfBuffer.toString('base64');
    } catch (fileError) {
      return res.status(400).json({
        error: 'Sample PDF not found. Please add sample-document.pdf to the public folder.',
      });
    }

    // 3. Call SignForge API with detailed error handling
    console.log('📤 Calling SignForge API...');
    console.log('🔑 Using API key:', SIGNFORGE_API_KEY ? 'Yes' : 'No');

    let signforgeResponse;
    try {
      signforgeResponse = await fetch(`${SIGNFORGE_API_BASE}/envelopes`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SIGNFORGE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documents: [{
            name: 'Test Agreement',
            file_base64: pdfBase64,
          }],
          recipients: [{
            email: email,
            name: `${firstName} ${lastName}`,
            role: 'signer',
          }],
          webhook_url: `https://project-qv4f9.vercel.app/api/signforge/webhook?envelope_id={envelope_id}`,
          redirect_url: 'https://www.turnkii.es/account',
          embedded: true,
        }),
      });
    } catch (fetchError) {
      console.error('❌ SignForge fetch failed:', fetchError.message);
      return res.status(500).json({
        error: 'Failed to connect to SignForge API',
        details: fetchError.message,
      });
    }

    console.log('📡 SignForge response status:', signforgeResponse.status);

    const data = await signforgeResponse.json();

    if (!signforgeResponse.ok) {
      console.error('❌ SignForge error response:', data);
      return res.status(signforgeResponse.status).json({
        error: data.message || 'SignForge API error',
        details: data,
      });
    }

    const envelopeId = data.id;
    const signingUrl = data.embedded_signing_url || data.signing_url;

    // 4. Store in Supabase
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