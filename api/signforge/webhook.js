// api/signforge/webhook.js
import { getOneDriveToken, uploadToOneDrive } from '../../lib/onedrive.js';
import { supabase } from '../../lib/supabase.js';

const SIGNFORGE_API_BASE = 'https://signforge.io/api/v1';
const SIGNFORGE_API_KEY = process.env.SIGNFORGE_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const { event } = payload;

    // --- Determine envelope_id from query or body ---
    const envelopeIdFromQuery = req.query.envelope_id;
    const envelopeIdFromBody = payload.envelope_id || payload.id;
    const envelopeId = envelopeIdFromQuery || envelopeIdFromBody;

    console.log(`📥 SignForge webhook: ${event} for envelope ${envelopeId}`);
    console.log(`📥 Full payload:`, JSON.stringify(payload, null, 2));
    console.log(`📥 Query:`, req.query);

    if (!envelopeId) {
      console.error('❌ No envelope ID found in request');
      return res.status(400).json({ error: 'Missing envelope_id' });
    }

    if (event !== 'envelope.completed') {
      return res.status(200).json({ received: true });
    }

    // 1. Find the document in Supabase
    console.log(`🔍 Looking for document with provider_request_id = "${envelopeId}"`);
    const { data: doc, error: findError } = await supabase
      .from('documents')
      .select('*')
      .eq('provider_request_id', envelopeId)
      .maybeSingle();

    if (findError) {
      console.error('❌ Database error:', findError);
      return res.status(500).json({ error: 'Database error' });
    }

    let foundDoc = doc;

    if (!foundDoc) {
      console.warn(`⚠️ No document found with provider_request_id = "${envelopeId}"`);
      // Fallback: try using the id field from the payload (if present and different)
      if (payload.id && payload.id !== envelopeId) {
        console.log(`🔄 Fallback: trying to find document with id = ${payload.id}`);
        const { data: fallbackDoc, error: fallbackError } = await supabase
          .from('documents')
          .select('*')
          .eq('id', payload.id)
          .maybeSingle();
        if (!fallbackError && fallbackDoc) {
          console.log(`✅ Found document via fallback id: ${fallbackDoc.id}`);
          foundDoc = fallbackDoc;
        } else {
          console.error('❌ Fallback also failed:', fallbackError);
        }
      }

      if (!foundDoc) {
        console.error('❌ Document not found after all attempts.');
        // Return 200 to avoid SignForge retrying (we've already logged the error)
        return res.status(200).json({ received: true, error: 'Document not found' });
      }
    }

    console.log(`✅ Found document: ${foundDoc.id} (${foundDoc.document_type})`);

    // 2. Download signed PDF from SignForge
    console.log(`📥 Downloading signed PDF from SignForge...`);
    const downloadResponse = await fetch(`${SIGNFORGE_API_BASE}/envelopes/${envelopeId}/pdf`, {
      headers: { 'Authorization': `Bearer ${SIGNFORGE_API_KEY}` },
    });

    if (!downloadResponse.ok) {
      const errorText = await downloadResponse.text();
      console.error('❌ Failed to download PDF:', errorText);
      throw new Error('Failed to download signed PDF');
    }

    const pdfBuffer = Buffer.from(await downloadResponse.arrayBuffer());
    console.log(`✅ Downloaded PDF (${pdfBuffer.length} bytes)`);

    // 3. Get contact email for folder structure
    const { data: contact } = await supabase
      .from('contacts')
      .select('email')
      .eq('id', foundDoc.contact_id)
      .single();

    // 4. Upload to OneDrive
    console.log(`📤 Uploading signed PDF to OneDrive...`);
    const oneDriveToken = await getOneDriveToken();
    const fileName = `signed_${foundDoc.file_name || 'document.pdf'}`;
    const uploadResult = await uploadToOneDrive(
      oneDriveToken,
      contact?.email || 'unknown',
      fileName,
      pdfBuffer
    );
    console.log(`✅ Uploaded to OneDrive: ${uploadResult.webUrl}`);

    // 5. Update document record
    const updateResult = await supabase
      .from('documents')
      .update({
        signed_url: uploadResult.webUrl,
        file_url: uploadResult.webUrl,   // also store the signed PDF as the main file (optional)
        file_id: uploadResult.id,
        status: 'signed',
        signed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', foundDoc.id);

    if (updateResult.error) {
      console.error('❌ Failed to update document:', updateResult.error);
      return res.status(500).json({ error: 'Update failed' });
    }

    console.log(`✅ Document ${foundDoc.id} updated to status 'signed'`);

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    return res.status(500).json({ error: error.message });
  }
}