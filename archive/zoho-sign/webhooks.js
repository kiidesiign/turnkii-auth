// api/webhooks.js – Consolidated webhook handler
import { downloadSignedDocument } from '../lib/zoho-sign.js';
import { getOneDriveToken, uploadToOneDrive } from '../lib/onedrive.js';
import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Determine which webhook source it is
  const { source } = req.query;
  
  if (source === 'zoho') {
    return handleZohoWebhook(req, res);
  } else if (source === 'calcom') {
    return handleCalcomWebhook(req, res);
  } else {
    return res.status(400).json({ error: 'Unknown webhook source' });
  }
}

// ============================================================
// ZOHO SIGN WEBHOOK
// ============================================================
async function handleZohoWebhook(req, res) {
  try {
    const payload = req.body;
    const { request_id, status } = payload;

    console.log(`📥 Zoho webhook: ${request_id} -> ${status}`);

    // Update document status in Supabase
    const { data: doc, error: findError } = await supabase
      .from('documents')
      .update({ 
        status: status === 'completed' ? 'signed' : status,
        updated_at: new Date().toISOString(),
        signed_at: status === 'completed' ? new Date().toISOString() : null
      })
      .eq('zoho_request_id', request_id)
      .select()
      .single();

    if (findError) {
      console.error('Document not found:', findError);
      return res.status(404).json({ error: 'Document not found' });
    }

    // If signed, download and store in OneDrive
    if (status === 'completed') {
      try {
        const signedPdfBuffer = await downloadSignedDocument(request_id);
        const oneDriveToken = await getOneDriveToken();
        
        const { data: contact } = await supabase
          .from('contacts')
          .select('email')
          .eq('id', doc.contact_id)
          .single();

        const fileName = `signed_${doc.file_name}`;
        const uploadResult = await uploadToOneDrive(
          oneDriveToken,
          contact?.email || 'unknown',
          fileName,
          signedPdfBuffer
        );

        await supabase
          .from('documents')
          .update({
            signed_url: uploadResult.webUrl,
            file_url: uploadResult.webUrl,
            file_id: uploadResult.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', doc.id);

        console.log(`✅ Signed document stored: ${uploadResult.webUrl}`);

      } catch (uploadError) {
        console.error('Error storing signed document:', uploadError);
      }
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('Zoho webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ============================================================
// CAL.COM WEBHOOK (placeholder for future)
// ============================================================
async function handleCalcomWebhook(req, res) {
  try {
    const payload = req.body;
    console.log('📥 Cal.com webhook:', payload);
    
    // TODO: Implement Cal.com webhook logic
    // - Store booking in Supabase
    // - Send confirmation email
    // - Update CRM
    
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Cal.com webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
}