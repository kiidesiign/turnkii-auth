// lib/file-validator.js
import pdfParse from 'pdf-parse';
import sharp from 'sharp';
import { lookup } from 'mime-types';

/**
 * Validate a PDF file
 */
export async function validatePDF(fileBuffer) {
  try {
    const data = await pdfParse(fileBuffer);
    return {
      valid: true,
      pageCount: data.numpages,
      info: data.info,
      metadata: data.metadata,
      textLength: data.text ? data.text.length : 0,
      errors: []
    };
  } catch (error) {
    return {
      valid: false,
      errors: [`Invalid PDF: ${error.message}`]
    };
  }
}

/**
 * Compress an image file
 */
export async function compressImage(fileBuffer, options = {}) {
  const {
    maxWidth = 1200,
    maxHeight = 1200,
    quality = 80,
    format = 'jpeg'
  } = options;
  
  try {
    const compressed = await sharp(fileBuffer)
      .resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: quality, progressive: true })
      .toBuffer();
    
    return {
      success: true,
      buffer: compressed,
      originalSize: fileBuffer.length,
      compressedSize: compressed.length,
      compressionRatio: ((1 - compressed.length / fileBuffer.length) * 100).toFixed(1) + '%'
    };
  } catch (error) {
    console.error('Image compression error:', error);
    return {
      success: false,
      error: error.message,
      buffer: fileBuffer
    };
  }
}

/**
 * Validate file type and size
 */
export function validateFile(file, options = {}) {
  const errors = [];
  const warnings = [];
  
  const config = {
    maxSize: options.maxSize || 5 * 1024 * 1024,
    allowedTypes: options.allowedTypes || ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'],
    minSize: options.minSize || 1 * 1024,
    ...options
  };
  
  if (!file || !file.buffer) {
    errors.push('No file provided');
    return { valid: false, errors, warnings };
  }
  
  if (file.size > config.maxSize) {
    errors.push(`File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum (${(config.maxSize / 1024 / 1024).toFixed(1)}MB)`);
  }
  
  if (file.size < config.minSize) {
    errors.push(`File is too small (${(file.size / 1024).toFixed(0)}KB). Minimum size is ${(config.minSize / 1024).toFixed(0)}KB`);
  }
  
  if (!config.allowedTypes.includes(file.mimetype)) {
    errors.push(`File type "${file.mimetype}" is not allowed. Allowed types: ${config.allowedTypes.join(', ')}`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    config
  };
}

/**
 * Basic security scan for potential malware
 */
export function basicSecurityScan(fileBuffer) {
  const warnings = [];
  const errors = [];
  
  const fileString = fileBuffer.toString('utf8', 0, Math.min(fileBuffer.length, 10000));
  
  const suspiciousPatterns = [
    { pattern: /eval\s*\(/i, name: 'eval() usage' },
    { pattern: /document\.write/i, name: 'document.write usage' },
    { pattern: /<script/i, name: 'script tag' },
    { pattern: /onerror\s*=/i, name: 'onerror event' },
    { pattern: /onload\s*=/i, name: 'onload event' },
    { pattern: /exec\s*\(/i, name: 'exec() usage' },
    { pattern: /system\s*\(/i, name: 'system() usage' },
    { pattern: /powershell/i, name: 'powershell reference' },
    { pattern: /cmd\.exe/i, name: 'cmd.exe reference' },
  ];
  
  for (const { pattern, name } of suspiciousPatterns) {
    if (pattern.test(fileString)) {
      warnings.push(`Suspicious pattern detected: ${name}`);
    }
  }
  
  return {
    safe: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Get file extension
 */
export function getFileExtension(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return ext;
}

/**
 * Generate a safe filename
 */
export function generateSafeFilename(originalName, prefix = 'file') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const extension = getFileExtension(originalName);
  const sanitizedName = originalName
    .replace(/[^a-zA-Z0-9.]/g, '_')
    .substring(0, 50);
  
  return `${prefix}_${timestamp}_${sanitizedName}`;
}

export default {
  validatePDF,
  compressImage,
  validateFile,
  basicSecurityScan,
  getFileExtension,
  generateSafeFilename
};