// api/signforge/webhook.js
// Handles SignForge webhook events, downloads signed PDF, uploads to OneDrive.

import { getOneDriveToken, uploadToOneDrive } from '../../lib/onedrive.js';
import { supabase } from '../../lib/supabase.js';

const SIGNFORGE_API_BASE = 'https://api.signforge.io/v1';
const SIGNFORGE_API_KEY = process.env.SIGNFORGE_API_KEY;

export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const { event, envelope_id } = payload;

    console.log(`📥 SignForge webhook: ${event} for envelope ${envelope_id}`);

    // Only process completed envelopes
    if (event !== 'envelope.completed') {
      return res.status(200).json({ received: true });
    }

    // 1. Find the document in Supabase using the correct column name
    const { data: doc, error: findError } = await supabase
      .from('documents')
      .select('*')
      .eq('provider_request_id', envelope_id)  // ← FIXED: was 'zoho_request_id'
      .single();

    if (findError || !doc) {
      console.error('Document not found:', envelope_id);
      return res.status(404).json({ error: 'Document not found' });
    }

    // 2. Download signed PDF from SignForge
    const downloadResponse = await fetch(`${SIGNFORGE_API_BASE}/envelopes/${envelope_id}/pdf`, {
      headers: {
        'Authorization': `Bearer ${SIGNFORGE_API_KEY}`,
      },
    });

    if (!downloadResponse.ok) {
      const errorText = await downloadResponse.text();
      console.error('Failed to download PDF:', errorText);
      throw new Error('Failed to download signed PDF');
    }

    const pdfBuffer = Buffer.from(await downloadResponse.arrayBuffer());

    // 3. Get contact email for folder structure
    const { data: contact } = await supabase
      .from('contacts')
      .select('email')
      .eq('id', doc.contact_id)
      .single();

    // 4. Upload to OneDrive
    const oneDriveToken = await getOneDriveToken();
    const fileName = `signed_${doc.file_name}`;
    const uploadResult = await uploadToOneDrive(
      oneDriveToken,
      contact?.email || 'unknown',
      fileName,
      pdfBuffer
    );

    // 5. Update document record with signed URL
    await supabase
      .from('documents')
      .update({
        signed_url: uploadResult.webUrl,
        file_url: uploadResult.webUrl,
        file_id: uploadResult.id,
        status: 'signed',
        signed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', doc.id);

    console.log(`✅ Signed document stored: ${uploadResult.webUrl}`);

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: error.message });
  }
}