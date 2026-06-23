// api/signforge/webhook.js
import { getOneDriveToken, uploadToOneDrive } from '../../lib/onedrive.js';
import { supabase } from '../../lib/supabase.js';

const SIGNFORGE_API_KEY = process.env.SIGNFORGE_API_KEY;

// Helper: download with retry
async function downloadWithRetry(url, maxRetries = 3, delay = 1000) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📥 Download attempt ${attempt}/${maxRetries}...`);
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${SIGNFORGE_API_KEY}` },
      });
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        console.log(`✅ Downloaded PDF (${buffer.length} bytes)`);
        return buffer;
      }
      const errorText = await response.text();
      console.warn(`⚠️ Attempt ${attempt} failed: ${response.status} - ${errorText}`);
      lastError = new Error(`Download failed: ${response.status}`);
      if (attempt < maxRetries) {
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (err) {
      console.warn(`⚠️ Attempt ${attempt} error: ${err.message}`);
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError || new Error('Download failed after retries');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const { event } = payload;

    // Determine envelope_id from query or body
    const envelopeIdFromQuery = req.query.envelope_id;
    const envelopeIdFromBody = payload.envelope_id || payload.id;
    const envelopeId = envelopeIdFromQuery || envelopeIdFromBody;

    console.log(`📥 SignForge webhook: ${event} for envelope ${envelopeId}`);
    console.log(`📥 Full payload:`, JSON.stringify(payload, null, 2));

    if (!envelopeId) {
      console.error('❌ No envelope ID found in request');
      return res.status(400).json({ error: 'Missing envelope_id' });
    }

    // Only process completed events
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
      // Fallback: try using the id field from the payload
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
        return res.status(200).json({ received: true, error: 'Document not found' });
      }
    }

    console.log(`✅ Found document: ${foundDoc.id} (${foundDoc.document_type})`);

    // 2. Get signed PDF URL from the webhook payload directly
    const signedUrl = payload.data?.download_urls?.signed || payload.download_urls?.signed;
    if (!signedUrl) {
      console.error('❌ No signed PDF URL in payload');
      // Still update status to 'signed' without file
      const updateResult = await supabase
        .from('documents')
        .update({
          status: 'signed',
          signed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', foundDoc.id);
      if (updateResult.error) {
        console.error('❌ Failed to update document:', updateResult.error);
        return res.status(500).json({ error: 'Update failed' });
      }
      console.log(`✅ Document ${foundDoc.id} updated to status 'signed' (no PDF)`);
      return res.status(200).json({ received: true });
    }

    console.log(`✅ Found signed PDF URL: ${signedUrl}`);

    // 3. Download signed PDF with retry
    let pdfBuffer = null;
    let downloadSuccess = false;
    try {
      pdfBuffer = await downloadWithRetry(signedUrl, 3, 1000);
      downloadSuccess = true;
    } catch (downloadErr) {
      console.error('❌ PDF download error after retries:', downloadErr.message);
      // We'll still try to store the signed URL as a fallback
    }

    // 4. Get contact info (keep email for reference, but use contact_id for folder)
    let contactEmail = 'unknown';
    let contactId = foundDoc.contact_id; // Use this for folder structure
    if (downloadSuccess) {
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
    }

    // 5. Upload to OneDrive using contact ID (only if download succeeded)
    let uploadResult = null;
    if (downloadSuccess && pdfBuffer) {
      try {
        console.log(`📤 Uploading signed PDF to OneDrive...`);
        const oneDriveToken = await getOneDriveToken();
        if (!oneDriveToken) {
          throw new Error('Failed to get OneDrive token');
        }
        const fileName = `signed_${foundDoc.file_name || 'document.pdf'}`;
        // 🔥 FIX: Use contact ID for folder structure
        uploadResult = await uploadToOneDriveById(
          oneDriveToken,
          contactId,
          fileName,
          pdfBuffer
        );
        console.log(`✅ Uploaded to OneDrive: ${uploadResult.webUrl}`);
      } catch (uploadErr) {
        console.error('❌ OneDrive upload error:', uploadErr.message);
        uploadResult = null;
      }
    }

    // 6. Update document record
    try {
      const updateData = {
        status: 'signed',
        signed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // If OneDrive upload succeeded, store those URLs
      if (uploadResult) {
        updateData.signed_url = uploadResult.webUrl;
        updateData.file_url = uploadResult.webUrl;
        updateData.file_id = uploadResult.id;
        console.log(`✅ Storing OneDrive URL: ${uploadResult.webUrl}`);
      } else if (signedUrl) {
        // If upload failed but we have the signed URL, store it as signed_url
        // (this is a fallback so the user can at least view the signed PDF)
        updateData.signed_url = signedUrl;
        console.log(`⚠️ Storing SignForge signed URL as fallback: ${signedUrl}`);
      } else {
        console.warn('⚠️ No URL to store');
      }

      const updateResult = await supabase
        .from('documents')
        .update(updateData)
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