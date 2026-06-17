// api/test-onedrive.js
import { getOneDriveToken } from '../lib/onedrive.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.turnkii.es');
  
  try {
    console.log('🔍 Testing OneDrive token...');
    console.log('Environment variables check:');
    console.log('AZURE_TENANT_ID:', process.env.AZURE_TENANT_ID ? '✅ Set' : '❌ Missing');
    console.log('AZURE_CLIENT_ID:', process.env.AZURE_CLIENT_ID ? '✅ Set' : '❌ Missing');
    console.log('AZURE_CLIENT_SECRET:', process.env.AZURE_CLIENT_SECRET ? '✅ Set' : '❌ Missing');
    
    const token = await getOneDriveToken();
    console.log('✅ Token obtained:', token.substring(0, 20) + '...');
    
    res.status(200).json({
      success: true,
      message: 'OneDrive token works!',
      tokenPreview: token.substring(0, 20) + '...'
    });
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
}