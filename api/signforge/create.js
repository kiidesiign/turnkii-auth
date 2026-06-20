// api/signforge/create.js
import fs from 'fs';
import path from 'path';

const SIGNFORGE_API_BASE = 'https://api.signforge.io/v1';
const SIGNFORGE_API_KEY = process.env.SIGNFORGE_API_KEY;

// Supabase service role key (bypasses RLS)
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

  try {
    // 1. Find or create contact in Supabase (using service role key)
    // First, try to find the contact
    const findUrl = `${SUPABASE_URL}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
    const findResponse = await fetch(findUrl, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });

    if (!findResponse.ok) {
      throw new Error('Failed to query contacts');
    }

    const findData = await findResponse.json();
    let contact = findData[0];

    // If not found, create it
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
        throw new Error(`Failed to create contact: ${errorText}`);
      }

      const createData = await createResponse.json();
      contact = createData[0] || createData;
    }

    // 2. Prepare the PDF document
    let pdfBase64;
    try {
      const pdfPath = path.join(process.cwd(), 'public', 'sample-document.pdf');
      const pdfBuffer = fs.readFileSync(pdfPath);
      pdfBase64 = pdfBuffer.toString('base64');
    } catch (fileError) {
      console.error('PDF file not found:', fileError);
      return res.status(400).json({
        error: 'Sample PDF not found. Please add sample-document.pdf to the public folder.',
      });
    }

    // 3. Call SignForge API
    const signforgeResponse = await fetch(`${SIGNFORGE_API_BASE}/envelopes`, {
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
       // webhook_url: `https://sloped-overdraft-unvarying.ngrok-free.dev/api/signforge/webhook?envelope_id={envelope_id}`,
        webhook_url: `https://project-qv4f9.vercel.app/api/signforge/webhook?envelope_id={envelope_id}`,
        redirect_url: 'https://www.turnkii.es/account',
        embedded: true,
      }),
    });

    const data = await signforgeResponse.json();

    if (!signforgeResponse.ok) {
      console.error('SignForge error:', data);
      throw new Error(data.message || 'Failed to create signing request');
    }

    const envelopeId = data.id;
    const signingUrl = data.embedded_signing_url || data.signing_url;

    // 4. Store the envelope in Supabase (using service role key)
    const docInsertUrl = `${SUPABASE_URL}/rest/v1/documents`;
    const insertResponse = await fetch(docInsertUrl, {
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

    if (!insertResponse.ok) {
      const errorText = await insertResponse.text();
      console.error('Failed to insert document:', errorText);
      // Non-critical, continue
    }

    return res.status(200).json({
      success: true,
      envelopeId: envelopeId,
      signingUrl: signingUrl,
    });

  } catch (error) {
    console.error('SignForge create error:', error);
    return res.status(500).json({ error: error.message });
  }
}