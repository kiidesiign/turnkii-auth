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
    const { event, envelope_id } = payload;

    console.log(`📥 SignForge webhook: ${event} for envelope ${envelope_id}`);
    console.log(`📥 Full payload:`, JSON.stringify(payload, null, 2));

    if (event !== 'envelope.completed') {
      return res.status(200).json({ received: true });
    }

    // 1. Find the document in Supabase
    console.log(`🔍 Looking for document with provider_request_id = "${envelope_id}"`);
    const { data: doc, error: findError } = await supabase
      .from('documents')
      .select('*')
      .eq('provider_request_id', envelope_id)
      .maybeSingle(); // Use maybeSingle to avoid 406 if no rows

    if (findError) {
      console.error('❌ Error querying documents:', findError);
      return res.status(500).json({ error: 'Database query error' });
    }

    let foundDoc = doc;

    if (!foundDoc) {
      console.warn(`⚠️ No document found with provider_request_id = "${envelope_id}"`);
      // Fallback: try using the `id` field from the payload (if present)
      if (payload.id) {
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
        return res.status(404).json({ error: 'Document not found' });
      }
    }

    console.log(`✅ Found document: ${foundDoc.id} (${foundDoc.document_type})`);

    // 2. Download signed PDF from SignForge
    console.log(`📥 Downloading signed PDF from SignForge...`);
    const downloadResponse = await fetch(`${SIGNFORGE_API_BASE}/envelopes/${envelope_id}/pdf`, {
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
    console.log(`📤 Uploading to OneDrive...`);
    const oneDriveToken = await getOneDriveToken();
    const fileName = `signed_${foundDoc.file_name}`;
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
        file_url: uploadResult.webUrl,
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