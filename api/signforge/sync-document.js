// api/signforge/sync-document.js
// Manually sync a document's signed PDF URL from SignForge

import { getOneDriveToken, uploadToOneDrive, uploadToOneDriveById } from '../../lib/onedrive.js';
import { supabase } from '../../lib/supabase.js';

const SIGNFORGE_API_KEY = process.env.SIGNFORGE_API_KEY;
const SIGNFORGE_API_BASE = 'https://signforge.io/api/v1';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', 'https://www.turnkii.es');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, documentType } = req.body;
    console.log(`🔄 Sync request for: ${email}, ${documentType}`);

    if (!email || !documentType) {
      return res.status(400).json({ error: 'email and documentType are required' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('❌ Supabase credentials missing');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // 1. Find the contact
    console.log(`🔍 Finding contact by email: ${email}`);
    const findContactUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=id`;
    const contactRes = await fetch(findContactUrl, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    });
    if (!contactRes.ok) {
      const errorText = await contactRes.text();
      console.error(`❌ Failed to find contact: ${errorText}`);
      return res.status(contactRes.status).json({ error: 'Failed to find contact', details: errorText });
    }
    const contactData = await contactRes.json();
    if (!contactData || contactData.length === 0) {
      console.error(`❌ Contact not found for email: ${email}`);
      return res.status(404).json({ error: 'Contact not found' });
    }
    const contactId = contactData[0].id;
    console.log(`✅ Found contact ID: ${contactId}`);

    // 2. Find the document
    console.log(`🔍 Finding document: ${documentType} for contact ${contactId}`);
    const docUrl = `${supabaseUrl}/rest/v1/documents?contact_id=eq.${contactId}&document_type=eq.${encodeURIComponent(documentType)}&select=*`;
    const docRes = await fetch(docUrl, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    });
    if (!docRes.ok) {
      const errorText = await docRes.text();
      console.error(`❌ Failed to fetch document: ${errorText}`);
      return res.status(docRes.status).json({ error: 'Failed to fetch document', details: errorText });
    }
    const docs = await docRes.json();
    if (!docs || docs.length === 0) {
      console.error(`❌ Document not found: ${documentType}`);
      return res.status(404).json({ error: 'Document not found' });
    }
    const doc = docs[0];
    console.log(`✅ Found document: ${doc.id}, status: ${doc.status}, provider_request_id: ${doc.provider_request_id}`);

    // If already signed and has signed_url, return it
    if (doc.status === 'signed' && doc.signed_url && doc.signed_url.includes('download')) {
      console.log(`✅ Document already has direct signed_url`);
      return res.status(200).json({
        success: true,
        document: doc,
        message: 'Document already has signed URL',
      });
    }

    // If no provider_request_id, can't sync
    if (!doc.provider_request_id) {
      console.error('❌ No provider_request_id found for document');
      return res.status(400).json({ 
        error: 'No provider_request_id found. Document may not have been sent for signing yet.',
        document: doc
      });
    }

    console.log(`🔄 Syncing document ${doc.id} with envelope ${doc.provider_request_id}`);

    // 3. Get envelope details from SignForge
    console.log(`🔍 Fetching envelope from SignForge: ${doc.provider_request_id}`);
    const envUrl = `${SIGNFORGE_API_BASE}/envelopes/${doc.provider_request_id}`;
    const envResponse = await fetch(envUrl, {
      headers: { 'X-API-Key': SIGNFORGE_API_KEY },
    });

    if (!envResponse.ok) {
      const errorText = await envResponse.text();
      console.error(`❌ Failed to fetch envelope: ${envResponse.status} - ${errorText}`);
      return res.status(envResponse.status).json({ 
        error: 'Failed to fetch envelope from SignForge', 
        details: errorText,
        status: envResponse.status
      });
    }

    const envData = await envResponse.json();
    console.log(`✅ Envelope status: ${envData.status}`);

    // 4. If envelope is completed, get signed URL
    if (envData.status !== 'completed') {
      console.log(`ℹ️ Envelope status is ${envData.status}, not completed yet`);
      return res.status(200).json({
        success: true,
        document: doc,
        message: `Envelope status is ${envData.status}, not completed yet`,
        envelopeStatus: envData.status,
      });
    }

    const signedDoc = envData.documents?.find(d => d.kind === 'signed');
    if (!signedDoc || !signedDoc.download_url) {
      console.error('❌ No signed document found in envelope');
      return res.status(200).json({
        success: true,
        document: doc,
        message: 'No signed document found in envelope',
      });
    }

    const signedUrl = signedDoc.download_url;
    console.log(`✅ Found signed URL: ${signedUrl}`);

    // 5. Try to download and upload to OneDrive
    let uploadResult = null;
    let oneDriveToken = null;
    let directUrl = null;
    let webUrl = null;

    try {
      console.log(`📥 Downloading signed PDF...`);
      const downloadRes = await fetch(signedUrl, {
        headers: { 'X-API-Key': SIGNFORGE_API_KEY },
      });
      if (downloadRes.ok) {
        const pdfBuffer = Buffer.from(await downloadRes.arrayBuffer());
        console.log(`✅ Downloaded PDF (${pdfBuffer.length} bytes)`);

        oneDriveToken = await getOneDriveToken();
        if (oneDriveToken) {
          const fileName = `signed_${doc.file_name || 'document.pdf'}`;
          // 🔥 FIX: Use contact ID for folder structure
          uploadResult = await uploadToOneDriveById(
            oneDriveToken,
            contactId,
            fileName,
            pdfBuffer
          );
          webUrl = uploadResult.webUrl;
          console.log(`✅ Uploaded to OneDrive: ${webUrl}`);

          // Get the direct download URL from OneDrive
          try {
            const itemUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${uploadResult.id}?select=@microsoft.graph.downloadUrl`;
            const itemRes = await fetch(itemUrl, {
              headers: { 'Authorization': `Bearer ${oneDriveToken}` }
            });
            if (itemRes.ok) {
              const itemData = await itemRes.json();
              directUrl = itemData['@microsoft.graph.downloadUrl'];
              if (directUrl) {
                console.log(`✅ Got direct download URL: ${directUrl}`);
              }
            }
          } catch (err) {
            console.warn('⚠️ Could not fetch direct download URL:', err.message);
          }
        }
      } else {
        console.warn(`⚠️ Download failed: ${downloadRes.status} - ${await downloadRes.text()}`);
      }
    } catch (err) {
      console.error('❌ Download/upload error:', err.message);
    }

    // 6. Update the document
    const updateData = {
      status: 'signed',
      signed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (directUrl) {
      // Use direct download URL for viewing (opens in browser)
      updateData.signed_url = directUrl;
      updateData.file_url = directUrl;
      updateData.file_web_url = webUrl; // Store the web UI link separately
      updateData.file_id = uploadResult.id;
      console.log(`✅ Storing direct URL: ${directUrl}`);
    } else if (uploadResult) {
      // Fallback to OneDrive web URL
      updateData.signed_url = uploadResult.webUrl;
      updateData.file_url = uploadResult.webUrl;
      updateData.file_id = uploadResult.id;
      console.log(`⚠️ Storing OneDrive web URL (no direct URL): ${uploadResult.webUrl}`);
    } else {
      // Ultimate fallback: store the SignForge URL (short-lived but better than nothing)
      updateData.signed_url = signedUrl;
      console.log(`⚠️ Storing SignForge URL as fallback: ${signedUrl}`);
    }

    const updateRes = await supabase
      .from('documents')
      .update(updateData)
      .eq('id', doc.id);

    if (updateRes.error) {
      console.error('❌ Update failed:', updateRes.error);
      return res.status(500).json({ error: 'Update failed', details: updateRes.error });
    }

    // Get the updated document
    const { data: updatedDoc } = await supabase
      .from('documents')
      .select('*')
      .eq('id', doc.id)
      .single();

    console.log(`✅ Document ${doc.id} synced successfully`);
    return res.status(200).json({
      success: true,
      document: updatedDoc,
      message: 'Document synced successfully',
    });

  } catch (error) {
    console.error('❌ Sync error:', error);
    return res.status(500).json({ error: error.message, stack: error.stack });
  }
}