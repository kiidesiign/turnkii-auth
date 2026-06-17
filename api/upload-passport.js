// api/upload-passport.js
import { getOneDriveToken, uploadToOneDrive } from '../lib/onedrive.js';
import multer from 'multer';
import { promisify } from 'util';
import { validateFile, basicSecurityScan, compressImage, validatePDF, generateSafeFilename } from '../lib/file-validator.js';

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 
      'image/png', 
      'image/jpg', 
      'application/pdf'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Please upload a JPEG, PNG, or PDF.`));
    }
  }
});

// Disable bodyParser for this route (multer handles it)
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', 'https://www.turnkii.es');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔍 Step 1: Starting upload process...');
    
    // Parse the multipart form data
    const parseUpload = promisify(upload.single('passport'));
    await parseUpload(req, res);

    console.log('🔍 Step 2: File parsed successfully');

    const file = req.file;
    const { email, name } = req.body;

    console.log('🔍 Step 3: File details -', { 
      hasFile: !!file, 
      email: email || 'not provided',
      name: name || 'not provided',
      fileType: file?.mimetype,
      fileSize: file?.size
    });

    if (!file) {
      console.error('❌ No file uploaded');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!email) {
      console.error('❌ No email provided');
      return res.status(400).json({ error: 'Email is required' });
    }

    // ============================================================
    // VALIDATION STEP 1: Basic File Validation
    // ============================================================
    console.log('🔍 Step 4: Validating file...');
    const validation = validateFile(file, {
      maxSize: 5 * 1024 * 1024, // 5MB
      allowedTypes: ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf']
    });

    if (!validation.valid) {
      console.error('❌ Validation failed:', validation.errors);
      return res.status(400).json({
        success: false,
        error: 'File validation failed',
        details: validation.errors
      });
    }
    console.log('✅ File validation passed');

    // ============================================================
    // VALIDATION STEP 2: Security Scan
    // ============================================================
    console.log('🔍 Step 5: Running security scan...');
    const securityScan = basicSecurityScan(file.buffer);
    
    if (!securityScan.safe) {
      console.error('❌ Security scan failed:', securityScan.errors);
      return res.status(400).json({
        success: false,
        error: 'Security scan failed',
        details: securityScan.errors,
        warnings: securityScan.warnings
      });
    }
    if (securityScan.warnings.length > 0) {
      console.warn('⚠️ Security warnings:', securityScan.warnings);
    } else {
      console.log('✅ Security scan passed');
    }

    // ============================================================
    // VALIDATION STEP 3: PDF Validation (if PDF)
    // ============================================================
    let pdfValidation = null;
    if (file.mimetype === 'application/pdf') {
      console.log('🔍 Step 6: Validating PDF...');
      pdfValidation = await validatePDF(file.buffer);
      if (!pdfValidation.valid) {
        console.error('❌ PDF validation failed:', pdfValidation.errors);
        return res.status(400).json({
          success: false,
          error: 'PDF validation failed',
          details: pdfValidation.errors
        });
      }
      console.log('✅ PDF validation passed:', {
        pages: pdfValidation.pageCount,
        textLength: pdfValidation.textLength
      });
    }

    // ============================================================
    // OPTIONAL: Image Compression (if image)
    // ============================================================
    let processedBuffer = file.buffer;
    let compressionInfo = null;
    
    if (file.mimetype.startsWith('image/')) {
      console.log('🔍 Step 7: Compressing image...');
      const compressionResult = await compressImage(file.buffer);
      if (compressionResult.success) {
        processedBuffer = compressionResult.buffer;
        compressionInfo = {
          originalSize: compressionResult.originalSize,
          compressedSize: compressionResult.compressedSize,
          ratio: compressionResult.compressionRatio
        };
        console.log('✅ Image compressed:', compressionInfo.ratio);
      } else {
        console.warn('⚠️ Compression failed, using original file');
      }
    }

    // ============================================================
    // UPLOAD TO ONEDRIVE
    // ============================================================
    console.log('🔍 Step 8: Generating filename...');
    const fileExtension = file.originalname.split('.').pop();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `passport_${timestamp}.${fileExtension}`;
    console.log('  Filename:', filename);

    console.log('🔍 Step 9: Getting OneDrive token...');
    const accessToken = await getOneDriveToken();
    console.log('✅ OneDrive token obtained');

    console.log('🔍 Step 10: Uploading to OneDrive...');
    const uploadResult = await uploadToOneDrive(
      accessToken,
      email,
      filename,
      processedBuffer
    );
    console.log('✅ File uploaded to OneDrive:', uploadResult.webUrl);

    // ============================================================
    // RESPONSE
    // ============================================================
    return res.status(200).json({
      success: true,
      message: 'Passport uploaded successfully',
      filename: filename,
      fileUrl: uploadResult.webUrl,
      fileId: uploadResult.id,
      validation: {
        passed: true,
        securityWarnings: securityScan.warnings,
        pdfInfo: pdfValidation ? {
          pageCount: pdfValidation.pageCount,
          textLength: pdfValidation.textLength
        } : null,
        compression: compressionInfo
      }
    });

  } catch (error) {
    console.error('❌ Upload error:', error);
    console.error('❌ Error stack:', error.stack);
    
    // Handle multer errors
    if (error.message && error.message.includes('Invalid file type')) {
      return res.status(400).json({ 
        success: false,
        error: error.message 
      });
    }

    return res.status(500).json({ 
      success: false,
      error: 'Failed to upload passport',
      details: error.message
    });
  }
}