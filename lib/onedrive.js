// lib/onedrive.js
import fetch from 'node-fetch';
import crypto from 'crypto';

/**
 * Get an access token using refresh token (delegated flow)
 * This works with personal OneDrive accounts and /me endpoints
 */
export async function getOneDriveToken() {
  const clientId = process.env.ONEDRIVE_CLIENT_ID || process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET;
  const refreshToken = process.env.ONEDRIVE_REFRESH_TOKEN;
   
  console.log('🔍 getOneDriveToken: Checking environment variables...');
  console.log('  ONEDRIVE_CLIENT_ID:', clientId ? '✅ Set' : '❌ Missing');
  console.log('  ONEDRIVE_CLIENT_SECRET:', clientSecret ? '✅ Set' : '❌ Missing');
  console.log('  ONEDRIVE_REFRESH_TOKEN:', refreshToken ? '✅ Set' : '❌ Missing');

  if (!clientId || !clientSecret || !refreshToken) {
    const missing = [];
    if (!clientId) missing.push('ONEDRIVE_CLIENT_ID');
    if (!clientSecret) missing.push('ONEDRIVE_CLIENT_SECRET');
    if (!refreshToken) missing.push('ONEDRIVE_REFRESH_TOKEN');
    throw new Error(`Missing OneDrive delegated authentication variables: ${missing.join(', ')}`);
  }

  const tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: 'https://graph.microsoft.com/Files.ReadWrite offline_access',
  });

  try {
    console.log('🔍 Refreshing OneDrive token...');
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    console.log('🔍 Token response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Token refresh failed:', errorText);
      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('✅ Token obtained successfully');
    
    if (data.refresh_token) {
      console.log('🔄 New refresh token received (you may want to update your environment variable)');
    }
    
    return data.access_token;
  } catch (error) {
    console.error('❌ Error getting OneDrive token:', error);
    throw new Error(`Failed to get OneDrive token: ${error.message}`);
  }
}

/**
 * Generate a unique, privacy-safe folder name from email
 * This creates a consistent, non-reversible hash
 */
export function getUserFolderName(email) {
  // Create a hash of the email for privacy
  const hash = crypto
    .createHash('sha256')
    .update(email.toLowerCase().trim())
    .digest('hex')
    .substring(0, 16); // Shorten for readability
  
  // Add a prefix for easy identification
  return `user_${hash}`;
}

/**
 * Get or create a folder by name in the root directory
 */
export async function getOrCreateFolder(accessToken, folderName) {
  console.log('🔍 getOrCreateFolder: Finding/creating folder...');
  console.log('  Folder name:', folderName);

  try {
    // First, search for the folder
    const searchUrl = `https://graph.microsoft.com/v1.0/me/drive/root/children?$filter=name eq '${folderName}'`;
    console.log('  Searching for folder:', searchUrl);
    
    const searchResponse = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('❌ Failed to search for folder:', errorText);
      throw new Error(`Failed to search for folder: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();

    if (searchData.value && searchData.value.length > 0) {
      const folderId = searchData.value[0].id;
      console.log('✅ Folder found:', folderId);
      return searchData.value[0];
    }

    // Folder doesn't exist, create it
    console.log('🔍 Folder not found, creating...');
    const createResponse = await fetch('https://graph.microsoft.com/v1.0/me/drive/root/children', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'rename',
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('❌ Failed to create folder:', errorText);
      throw new Error(`Failed to create folder: ${createResponse.status} - ${errorText}`);
    }

    const folderData = await createResponse.json();
    console.log('✅ Folder created:', folderData.id);
    return folderData;
  } catch (error) {
    console.error('❌ getOrCreateFolder error:', error);
    throw new Error(`Failed to get or create folder: ${error.message}`);
  }
}

/**
 * Get or create a subfolder within a parent folder
 */
export async function getOrCreateSubfolder(accessToken, parentFolderId, folderName) {
  console.log(`🔍 Finding/creating subfolder: ${folderName}`);
  
  try {
    // Search for subfolder in parent
    const searchUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${parentFolderId}/children?$filter=name eq '${folderName}'`;
    const searchResponse = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('❌ Failed to search for subfolder:', errorText);
      throw new Error(`Failed to search for subfolder: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();

    if (searchData.value && searchData.value.length > 0) {
      console.log('✅ Subfolder found:', searchData.value[0].id);
      return searchData.value[0];
    }

    // Create subfolder
    console.log('🔍 Creating subfolder...');
    const createResponse = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${parentFolderId}/children`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'rename',
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('❌ Failed to create subfolder:', errorText);
      throw new Error(`Failed to create subfolder: ${createResponse.status} - ${errorText}`);
    }

    const folderData = await createResponse.json();
    console.log('✅ Subfolder created:', folderData.id);
    return folderData;
  } catch (error) {
    console.error('❌ getOrCreateSubfolder error:', error);
    throw new Error(`Failed to get or create subfolder: ${error.message}`);
  }
}

/**
 * Get or create a user-specific folder
 * Structure: TurnkiiClientUploads/user_[hash]/
 */
export async function getUserFolder(accessToken, email) {
  const folderName = getUserFolderName(email);
  console.log(`🔍 Getting folder for user: ${folderName}`);
  
  // First, get or create the main TurnkiiClientUploads folder
  const mainFolder = await getOrCreateFolder(accessToken, 'TurnkiiClientUploads');
  
  // Now get or create the user subfolder
  const userFolder = await getOrCreateSubfolder(accessToken, mainFolder.id, folderName);
  
  return userFolder;
}

/**
 * Upload a file to OneDrive (user-specific folder)
 */
export async function uploadToOneDrive(accessToken, email, filename, fileBuffer) {
  console.log('🔍 uploadToOneDrive: Starting upload...');
  console.log('  User:', email);
  console.log('  Filename:', filename);
  console.log('  File size:', fileBuffer.length, 'bytes');

  try {
    // Get user-specific folder
    const userFolder = await getUserFolder(accessToken, email);
    const folderId = userFolder.id;
    console.log('✅ Using folder ID:', folderId);

    // Upload to user folder
    const uploadUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}:/${encodeURIComponent(filename)}:/content`;
    console.log('🔍 Uploading to:', uploadUrl);

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
      },
      body: fileBuffer,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Upload failed:', response.status, errorText);
      
      let errorMessage = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorText;
      } catch (e) {
        // Keep the raw error text
      }
      
      throw new Error(`Upload failed: ${response.status} - ${errorMessage}`);
    }

    const data = await response.json();
    console.log('✅ Upload successful!');
    console.log('  File ID:', data.id);
    console.log('  Web URL:', data.webUrl);
    
    return {
      id: data.id,
      name: data.name,
      webUrl: data.webUrl,
      downloadUrl: data['@microsoft.graph.downloadUrl'] || null,
      size: data.size,
      createdDateTime: data.createdDateTime,
      lastModifiedDateTime: data.lastModifiedDateTime,
    };
  } catch (error) {
    console.error('❌ uploadToOneDrive error:', error);
    throw new Error(`Failed to upload file to OneDrive: ${error.message}`);
  }
}

/**
 * Get the user's drive information
 */
export async function getDrive(accessToken) {
  console.log('🔍 getDrive: Getting user drive...');
  
  const response = await fetch('https://graph.microsoft.com/v1.0/me/drive', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Failed to get drive:', errorText);
    throw new Error(`Failed to get drive: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log('✅ Drive found:', data.id);
  return data;
}

/**
 * List files in a specific folder
 */
export async function listFilesInFolder(accessToken, folderId) {
  console.log('🔍 listFilesInFolder: Listing files...');
  
  const url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`;
  console.log('  URL:', url);

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Failed to list files:', errorText);
    throw new Error(`Failed to list files: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log('✅ Files found:', data.value.length);
  return data.value;
}

/**
 * List files for a specific user
 */
export async function listUserFiles(accessToken, email) {
  console.log(`🔍 listUserFiles: Getting files for user: ${email}`);
  
  const userFolder = await getUserFolder(accessToken, email);
  return listFilesInFolder(accessToken, userFolder.id);
}

/**
 * Delete a file from OneDrive
 */
export async function deleteFile(accessToken, fileId) {
  console.log('🔍 deleteFile: Deleting file...');
  console.log('  File ID:', fileId);

  const response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Failed to delete file:', errorText);
    throw new Error(`Failed to delete file: ${response.status} - ${errorText}`);
  }

  console.log('✅ File deleted successfully');
  return true;
}

/**
 * Get download URL for a file
 */
export async function getFileDownloadUrl(accessToken, fileId) {
  console.log('🔍 getFileDownloadUrl: Getting download URL...');
  
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Failed to get file:', errorText);
    throw new Error(`Failed to get file: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log('✅ Download URL obtained');
  return data['@microsoft.graph.downloadUrl'] || null;
}

// lib/onedrive.js – add this function
export async function deleteOneDriveFile(accessToken, fileId) {
  const url = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (response.status === 204) return true; // deleted
  if (response.status === 404) return false; // already gone
  const errorText = await response.text();
  throw new Error(`OneDrive delete failed: ${response.status} ${errorText}`);
}

export default {
  getOneDriveToken,
  getDrive,
  getOrCreateFolder,
  getOrCreateSubfolder,
  getUserFolder,
  getUserFolderName,
  uploadToOneDrive,
  listFilesInFolder,
  listUserFiles,
  deleteFile,
  getFileDownloadUrl
};