// api/documents/upload.js
// Consolidated endpoint for document operations: upload (POST), view (GET), delete (DELETE)

import { getOneDriveToken, uploadToOneDrive, uploadToOneDriveById, deleteOneDriveFile } from '../../lib/onedrive.js';
import multer from 'multer';
import { promisify } from 'util';
import {
  validateFile,
  basicSecurityScan,
  compressImage,
  validatePDF,
} from '../../lib/file-validator.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Multer config
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Please upload a JPEG, PNG, or PDF.`));
    }
  },
});

export const config = {
  api: { bodyParser: false },
};

// ============================================================
// HELPERS
// ============================================================

async function findContactId(email) {
  const url = `${SUPABASE_URL}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=id`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to find contact: ${err}`);
  }
  const data = await res.json();
  if (!data || data.length === 0) throw new Error('Contact not found');
  return data[0].id;
}

async function getDocument(contactId, documentType) {
  const url = `${SUPABASE_URL}/rest/v1/documents?contact_id=eq.${contactId}&document_type=eq.${encodeURIComponent(documentType)}&select=*`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to fetch document: ${err}`);
  }
  const data = await res.json();
  if (!data || data.length === 0) throw new Error('Document not found');
  return data[0];
}

async function updateDocument(docId, updates) {
  const url = `${SUPABASE_URL}/rest/v1/documents?id=eq.${docId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to update document: ${err}`);
  }
  const data = await res.json();
  return data[0] || data;
}

async function createSharingLink(accessToken, fileId) {
  const url = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/createLink`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'view',
      scope: 'anonymous',
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    console.warn(`Failed to create sharing link: ${errorText}`);
    return null;
  }
  const data = await response.json();
  return data.link?.webUrl || null;
}

// ============================================================
// MAIN HANDLER
// ============================================================

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', 'https://www.turnkii.es');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    // ----------------------------------------------------------
    // GET: View file (returns both URLs)
    // ----------------------------------------------------------
    if (req.method === 'GET') {
      const { email, documentType } = req.query;
      if (!email || !documentType) {
        return res.status(400).json({ error: 'email and documentType are required' });
      }

      const contactId = await findContactId(email);
      const doc = await getDocument(contactId, documentType);

      if (!doc.file_url) {
        return res.status(404).json({ error: 'No file uploaded for this document' });
      }

      return res.status(200).json({
        success: true,
        fileUrl: doc.file_url,
        fileWebUrl: doc.file_web_url,
        fileName: doc.file_name,
        fileId: doc.file_id,
        status: doc.status,
      });
    }

    // ----------------------------------------------------------
    // DELETE: Remove file
    // ----------------------------------------------------------
    if (req.method === 'DELETE') {
      let body = '';
      await new Promise((resolve) => {
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          try { req.body = body ? JSON.parse(body) : {}; } catch (e) { req.body = {}; }
          resolve();
        });
      });

      const { email, documentType } = req.body;
      if (!email || !documentType) {
        return res.status(400).json({ error: 'email and documentType are required' });
      }

      const contactId = await findContactId(email);
      const doc = await getDocument(contactId, documentType);

      if (!doc.file_id) {
        return res.status(400).json({ error: 'No file to delete' });
      }

      const accessToken = await getOneDriveToken();
      await deleteOneDriveFile(accessToken, doc.file_id);

      const updated = await updateDocument(doc.id, {
        file_name: null,
        file_url: null,
        file_web_url: null,
        file_id: null,
        status: 'pending',
        updated_at: new Date().toISOString(),
      });

      return res.status(200).json({
        success: true,
        message: 'File deleted successfully',
        document: updated,
      });
    }

    // ----------------------------------------------------------
    // POST: Upload file
    // ----------------------------------------------------------
    if (req.method === 'POST') {
      const parseUpload = promisify(upload.single('file'));
      await parseUpload(req, res);

      const file = req.file;
      const { email, documentType } = req.body;

      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }
      if (!documentType) {
        return res.status(400).json({ error: 'documentType is required' });
      }

      // ---- VALIDATION ----
      const validation = validateFile(file, {
        maxSize: 10 * 1024 * 1024,
        allowedTypes: ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'],
      });
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: 'File validation failed', details: validation.errors });
      }

      const securityScan = basicSecurityScan(file.buffer);
      if (!securityScan.safe) {
        return res.status(400).json({ success: false, error: 'Security scan failed', details: securityScan.errors });
      }

      let pdfValidation = null;
      if (file.mimetype === 'application/pdf') {
        pdfValidation = await validatePDF(file.buffer);
        if (!pdfValidation.valid) {
          return res.status(400).json({ success: false, error: 'PDF validation failed', details: pdfValidation.errors });
        }
      }

      let processedBuffer = file.buffer;
      let compressionInfo = null;
      if (file.mimetype.startsWith('image/')) {
        const compressionResult = await compressImage(file.buffer);
        if (compressionResult.success) {
          processedBuffer = compressionResult.buffer;
          compressionInfo = {
            originalSize: compressionResult.originalSize,
            compressedSize: compressionResult.compressedSize,
            ratio: compressionResult.compressionRatio,
          };
        }
      }

      // ---- Find contact ----
      const contactId = await findContactId(email);

      // ---- Upload to OneDrive ----
      const fileExtension = file.originalname.split('.').pop();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${documentType.toLowerCase()}_${timestamp}.${fileExtension}`;
      const accessToken = await getOneDriveToken();
      const uploadResult = await uploadToOneDriveById(
        accessToken,
        contactId,  // <-- new way using contact ID
        filename,
        processedBuffer
      );
      console.log('✅ Uploaded to OneDrive. File ID:', uploadResult.id);

      // ---- Fetch direct download URL ----
      const itemUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${uploadResult.id}?select=id,name,webUrl,@microsoft.graph.downloadUrl`;
      const itemRes = await fetch(itemUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (!itemRes.ok) {
        const errorText = await itemRes.text();
        console.error('Failed to fetch item metadata:', errorText);
        throw new Error('Failed to get download URL');
      }
      const itemData = await itemRes.json();
      const directDownloadUrl = itemData['@microsoft.graph.downloadUrl'];
      const webUrl = itemData.webUrl || uploadResult.webUrl;

      // ---- Create anonymous sharing link (for viewing without login) ----
      let shareLink = webUrl; // fallback
      try {
        const link = await createSharingLink(accessToken, uploadResult.id);
        if (link) {
          shareLink = link;
          console.log('✅ Created anonymous sharing link:', shareLink);
        } else {
          console.warn('⚠️ Could not create sharing link, using webUrl as fallback');
        }
      } catch (err) {
        console.warn('⚠️ Error creating sharing link:', err.message);
      }

      // ---- Update Supabase with both URLs ----
      const docUpdateUrl = `${SUPABASE_URL}/rest/v1/documents?contact_id=eq.${contactId}&document_type=eq.${encodeURIComponent(documentType)}`;
      const updateRes = await fetch(docUpdateUrl, {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          file_name: file.originalname,
          file_url: directDownloadUrl,       // for download
          file_web_url: shareLink,           // for viewing (anonymous share)
          file_id: uploadResult.id,
          status: 'completed',
          updated_at: new Date().toISOString(),
        }),
      });
      if (!updateRes.ok) {
        const errorText = await updateRes.text();
        throw new Error(`Failed to update document: ${errorText}`);
      }
      const updatedDoc = await updateRes.json();

      return res.status(200).json({
        success: true,
        message: 'File uploaded and document updated successfully',
        filename: filename,
        fileUrl: directDownloadUrl,
        fileWebUrl: shareLink,
        fileId: uploadResult.id,
        document: updatedDoc[0] || updatedDoc,
        validation: {
          passed: true,
          securityWarnings: securityScan.warnings,
          pdfInfo: pdfValidation ? { pageCount: pdfValidation.pageCount, textLength: pdfValidation.textLength } : null,
          compression: compressionInfo,
        },
      });
    }

    // If method not allowed
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('❌ Document operation error:', error);
    return res.status(500).json({ error: error.message });
  }
}