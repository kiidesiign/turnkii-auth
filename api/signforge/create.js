// api/signforge/create.js
import fs from 'fs';
import path from 'path';

const SIGNFORGE_API_BASE = 'https://signforge.io/api/v1';
const SIGNFORGE_API_KEY = process.env.SIGNFORGE_API_KEY || process.env.SIGNFORGE_KEY;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Map document types to file paths and display names (internal keys)
const DOCUMENTS = {
  privacy: {
    path: path.join(process.cwd(), 'api', 'signforge', 'pdf', 'Turnkii-TC-v1a.pdf'),
    name: 'Privacy and Data Handling Agreement',
    fileName: 'Privacy_and_Data_Handling_Agreement.pdf',
  },
  nie: {
    path: path.join(process.cwd(), 'api', 'signforge', 'pdf', 'Turnkii-NIE-Apoderado.pdf'),
    name: 'NIE Representative (Apoderado)',
    fileName: 'NIE_Representative_Apoderado.pdf',
  },
};

// Reverse mapping: database type → internal key
const DB_TO_INTERNAL = {
  'DATA_POLICY': 'privacy',
  'NIE_APODERADO': 'nie',
};

const FALLBACK_PDF_BASE64 = 'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqIDIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqIDMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL01lZGlhQm94IFswIDAgNjEyIDc5Ml0gL1BhcmVudCAyIDAgUiAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4gZW5kb2JqIDQgMCBvYmogPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+IGVuZG9iaiA1IDAgb2JqIDw8IC9MZW5ndGggNjMgPj4gc3RyZWFtCkJUIC9GMSAyNCBUZiAxMDAgNzAwIFRkIChUZXN0KSBUaiBFVE0KZW5kc3RyZWFtIGVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA2MiAwMDAwMCBuIAowMDAwMDAwMTE3IDAwMDAwIG4gCjAwMDAwMDAyMzQgMDAwMDAgbiAKMDAwMDAwMDI5NiAwMDAwMCBuIAp0cmFpbGVyIDw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjM3NQolJUVPRg==';

function getPdfBase64(internalType) {
  const doc = DOCUMENTS[internalType];
  if (!doc) {
    console.warn(`⚠️ Unknown internal type: ${internalType}, using fallback.`);
    return FALLBACK_PDF_BASE64;
  }
  try {
    if (fs.existsSync(doc.path)) {
      const pdfBuffer = fs.readFileSync(doc.path);
      return pdfBuffer.toString('base64');
    } else {
      console.warn(`⚠️ PDF file not found at ${doc.path}, using fallback.`);
      return FALLBACK_PDF_BASE64;
    }
  } catch (error) {
    console.error('❌ Error reading PDF file:', error);
    return FALLBACK_PDF_BASE64;
  }
}

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

    const { email, firstName, lastName, documentType } = req.body;

    // documentType is expected to be a database type like 'NIE_APODERADO' or 'DATA_POLICY'
    // If not provided, default to 'privacy' (fallback)
    const dbType = documentType || 'privacy';

    console.log('🔍 Received request:', { email, firstName, lastName, dbType });

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

    // 2. Map database type to internal key, then get the PDF
    const internalType = DB_TO_INTERNAL[dbType] || dbType; // fallback if unknown
    const pdfBase64 = getPdfBase64(internalType);
    const docInfo = DOCUMENTS[internalType] || DOCUMENTS.privacy;
    const fileName = docInfo.fileName || 'Document.pdf';

    console.log(`📄 Using PDF for ${dbType} (internal: ${internalType}) (${pdfBase64.length} chars)`);

    // 3. Build SignForge payload
    const endpoint = `${SIGNFORGE_API_BASE}/quick-sign`;
    const payload = {
      title: docInfo.name,
      pdf_base64: pdfBase64,
      signer_email: email,
      signer_name: `${firstName} ${lastName}`,
      fields: [
        {
          recipient_index: 0,
          field_type: 'signature',
          page_index: 0,
          x_norm: 0.1,
          y_norm: 0.8,
          w_norm: 0.3,
          h_norm: 0.08,
        },
        {
          recipient_index: 0,
          field_type: 'date',
          page_index: 0,
          x_norm: 0.5,
          y_norm: 0.8,
          w_norm: 0.2,
          h_norm: 0.05,
          label: 'Date',
        },
      ],
      embedded: true,
      webhook_url: `https://project-qv4f9.vercel.app/api/signforge/webhook?envelope_id={envelope_id}`,
      redirect_url: 'https://www.turnkii.es/account',
    };

    console.log('📤 Sending to SignForge...');
    console.log('📤 Payload:', JSON.stringify(payload, null, 2));

    const signforgeResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'X-API-Key': SIGNFORGE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
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
    const signingUrl = data.embedded_signing_url || data.signing_url || data.url;

    // ============================================================
    // 4. Upsert document record – uses the database type (dbType)
    // ============================================================
    console.log('📝 Upserting document record for contact:', contact.id);
    console.log('📝 Document data:', {
      contact_id: contact.id,
      file_name: fileName,
      document_type: dbType,
      provider_request_id: envelopeId,
      provider: 'signforge',
      status: 'sent',
      sent_at: new Date().toISOString(),
    });

    let documentId = null;

    if (envelopeId) {
      try {
        // Use PUT with on_conflict to upsert – this ensures existing records are updated
        const docUpsertUrl = `${SUPABASE_URL}/rest/v1/documents?on_conflict=contact_id,document_type`;
        console.log('📝 Upsert URL:', docUpsertUrl);

        const upsertResponse = await fetch(docUpsertUrl, {
          method: 'PUT', // CHANGED from POST to PUT to correctly perform upsert
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation', // ensures we get the updated/inserted row
          },
          body: JSON.stringify({
            contact_id: contact.id,
            file_name: fileName,
            document_type: dbType, // store the database type
            provider_request_id: envelopeId,
            provider: 'signforge',
            status: 'sent',
            sent_at: new Date().toISOString(),
          }),
        });

        console.log('📝 Upsert response status:', upsertResponse.status);

        if (!upsertResponse.ok) {
          const errorText = await upsertResponse.text();
          console.error('❌ Failed to upsert document:', upsertResponse.status, errorText);
        } else {
          const upsertedDoc = await upsertResponse.json();
          const docRecord = Array.isArray(upsertedDoc) ? upsertedDoc[0] : upsertedDoc;
          documentId = docRecord?.id || null;
          console.log('✅ Document record upserted successfully:', docRecord);
        }
      } catch (docError) {
        console.error('⚠️ Exception during document upsert:', docError);
      }
    } else {
      console.warn('⚠️ No envelopeId, skipping document upsert');
    }

    return res.status(200).json({
      success: true,
      envelopeId: envelopeId,
      signingUrl: signingUrl,
      documentType: dbType,
      documentId: documentId,
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