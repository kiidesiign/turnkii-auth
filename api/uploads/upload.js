// api/documents/upload.js
// Handles file uploads for documents that do NOT require signing (e.g., PASSPORT)

import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_STORAGE_BUCKET = 'documents'; // change to your bucket name

export const config = {
  api: {
    bodyParser: false, // required for formidable
  },
};

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', 'https://www.turnkii.es');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Parse the multipart form
    const form = new formidable.IncomingForm({
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10 MB
    });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const email = fields.email?.[0] || fields.email;
    const documentType = fields.documentType?.[0] || fields.documentType;
    const file = files.file; // formidable returns an object with file properties

    if (!email || !documentType || !file) {
      return res.status(400).json({ error: 'Missing email, documentType, or file' });
    }

    // 2. Validate file type (optional: restrict to PDF and images)
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({ error: 'File must be PDF, JPEG, or PNG' });
    }

    // 3. Find the contact ID from the email
    const findContactUrl = `${SUPABASE_URL}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=id`;
    const contactRes = await fetch(findContactUrl, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!contactRes.ok) {
      const errorText = await contactRes.text();
      return res.status(contactRes.status).json({ error: 'Failed to find contact', details: errorText });
    }
    const contactData = await contactRes.json();
    if (!contactData || contactData.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    const contactId = contactData[0].id;

    // 4. Upload file to Supabase Storage (or OneDrive)
    //    Option A: Supabase Storage (recommended for simplicity)
    //    Option B: OneDrive – you’d replace this block with your OneDrive SDK call
    const fileBuffer = fs.readFileSync(file.filepath);
    const fileName = `${contactId}/${documentType}_${Date.now()}_${file.originalFilename}`;
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${fileName}`;

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': file.mimetype,
      },
      body: fileBuffer,
    });

    if (!uploadRes.ok) {
      const errorText = await uploadRes.text();
      return res.status(uploadRes.status).json({ error: 'Failed to upload file', details: errorText });
    }

    const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/${fileName}`;

    // 5. Update the document record (using upsert to be safe, but we expect it exists)
    const docUpdateUrl = `${SUPABASE_URL}/rest/v1/documents?contact_id=eq.${contactId}&document_type=eq.${encodeURIComponent(documentType)}`;
    const updateRes = await fetch(docUpdateUrl, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        file_name: file.originalFilename,
        file_url: fileUrl,
        file_id: fileName, // you can store the path or ID
        status: 'completed',
        updated_at: new Date().toISOString(),
      }),
    });

    if (!updateRes.ok) {
      const errorText = await updateRes.text();
      return res.status(updateRes.status).json({ error: 'Failed to update document', details: errorText });
    }

    const updatedDoc = await updateRes.json();

    // 6. Clean up temporary file
    fs.unlink(file.filepath, (err) => {
      if (err) console.warn('Could not delete temp file:', err);
    });

    return res.status(200).json({
      success: true,
      document: updatedDoc[0] || updatedDoc,
    });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}