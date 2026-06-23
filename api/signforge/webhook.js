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

    // For non-completed events, just acknowledge
    if (event !== 'envelope.completed') {
      return res.status(200).json({ received: true });
    }

    // ============================================================
    // 1. Find the document in Supabase
    // ============================================================
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

    // ============================================================
    // 2. Download signed PDF from SignForge (temporarily disabled)
    // ============================================================
    /*
    let pdfBuffer = null;
    try {
      console.log(`📥 Downloading signed PDF from SignForge...`);
      const downloadUrl = `${SIGNFORGE_API_BASE}/envelopes/${envelopeId}/pdf`;
      console.log(`   URL: ${downloadUrl}`);
      
      const downloadResponse = await fetch(downloadUrl, {
        headers: { 'Authorization': `Bearer ${SIGNFORGE_API_KEY}` },
      });

      console.log(`   Download response status: ${downloadResponse.status}`);

      if (!downloadResponse.ok) {
        const errorText = await downloadResponse.text();
        console.error('❌ Failed to download PDF:', downloadResponse.status, errorText);
        throw new Error(`PDF download failed: ${downloadResponse.status} - ${errorText}`);
      }

      pdfBuffer = Buffer.from(await downloadResponse.arrayBuffer());
      console.log(`✅ Downloaded PDF (${pdfBuffer.length} bytes)`);
    } catch (downloadErr) {
      console.error('❌ PDF download error:', downloadErr.message);
      return res.status(500).json({ error: 'PDF download failed' });
    }
    */

    // ============================================================
    // 3. Get contact email for folder structure (temporarily disabled)
    // ============================================================
    /*
    let contactEmail = 'unknown';
    try {
      const { data: contact, error: contactErr } = await supabase
        .from('contacts')
        .select('email')
        .eq('id', foundDoc.contact_id)
        .single();
      if (contactErr) {
        console.warn('⚠️ Could not fetch contact email:', contactErr.message);
      } else if (contact?.email) {
        contactEmail = contact.email;
      }
    } catch (contactErr) {
      console.warn('⚠️ Contact fetch error:', contactErr.message);
    }
    */

    // ============================================================
    // 4. Upload to OneDrive (temporarily disabled)
    // ============================================================
    /*
    let uploadResult = null;
    try {
      console.log(`📤 Uploading signed PDF to OneDrive...`);
      const oneDriveToken = await getOneDriveToken();
      if (!oneDriveToken) {
        throw new Error('Failed to get OneDrive token');
      }
      const fileName = `signed_${foundDoc.file_name || 'document.pdf'}`;
      uploadResult = await uploadToOneDrive(
        oneDriveToken,
        contactEmail,
        fileName,
        pdfBuffer
      );
      console.log(`✅ Uploaded to OneDrive: ${uploadResult.webUrl}`);
    } catch (uploadErr) {
      console.error('❌ OneDrive upload error:', uploadErr.message);
      return res.status(500).json({ error: 'OneDrive upload failed' });
    }
    */

    // ============================================================
    // 5. Update document record – status only (PDF download/upload skipped)
    // ============================================================
    try {
      const updateResult = await supabase
        .from('documents')
        .update({
          // signed_url: uploadResult.webUrl,  // temporarily disabled
          // file_url: uploadResult.webUrl,    // temporarily disabled
          // file_id: uploadResult.id,         // temporarily disabled
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
    } catch (dbErr) {
      console.error('❌ Database update error:', dbErr.message);
      return res.status(500).json({ error: 'Database update failed' });
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    console.error('Stack:', error.stack);
    return res.status(500).json({ error: error.message });
  }
}