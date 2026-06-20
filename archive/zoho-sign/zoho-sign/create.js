// api/zoho-sign/webhook.js
import { downloadSignedDocument } from '../../lib/zoho-sign.js';
import { supabase } from '../../lib/supabase.js';
import { uploadToOneDrive } from '../../lib/onedrive.js';
import { getOneDriveToken } from '../../lib/onedrive.js';

export default async function handler(req, res) {
  // Accept only POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;

    // ⚠️ Security: Verify the webhook signature (optional but recommended)
    // Zoho sends a signature header; implement verification if needed

    const { request_id, status } = payload;

    if (!request_id) {
      return res.status(400).json({ error: 'Missing request_id' });
    }

    console.log(`📥 Zoho webhook received: ${request_id} -> ${status}`);

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
        // 1. Download signed PDF from Zoho
        const signedPdfBuffer = await downloadSignedDocument(request_id);

        // 2. Get OneDrive token and upload
        const oneDriveToken = await getOneDriveToken();
        
        // Get contact email for folder structure
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

        // 3. Update document with signed URL
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
        // Non-critical – we still return 200 to acknowledge the webhook
      }
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
}