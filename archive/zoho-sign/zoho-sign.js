// lib/zoho-sign.js
const ZOHO_ACCOUNTS_BASE = process.env.ZOHO_SIGN_REGION || 'https://accounts.zoho.eu';
const ZOHO_SIGN_API_BASE = process.env.ZOHO_SIGN_REGION 
  ? `https://sign.zoho.${process.env.ZOHO_SIGN_REGION.split('.')[1] || 'eu'}/api/v1`
  : 'https://sign.zoho.eu/api/v1';

/**
 * Get a fresh access token using the refresh token
 */
export async function getZohoAccessToken() {
  const url = `${ZOHO_ACCOUNTS_BASE}/oauth/v2/token`;
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_SIGN_REFRESH_TOKEN,
    client_id: process.env.ZOHO_SIGN_CLIENT_ID,
    client_secret: process.env.ZOHO_SIGN_CLIENT_SECRET,
    grant_type: 'refresh_token'
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get Zoho access token: ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Create a signing request
 */
export async function createSigningRequest({
  email,
  firstName,
  lastName,
  documentName = 'Service Agreement',
  documentBase64,
  redirectUrl = 'https://www.turnkii.es/account'
}) {
  const accessToken = await getZohoAccessToken();

  const payload = {
    requests: [{
      request_name: documentName,
      request_description: 'Please review and sign this document',
      actions: [{
        recipient_name: `${firstName} ${lastName}`,
        recipient_email: email,
        action_type: 'SIGN',
        is_embedded: false, // Set to true for in-app signing
        redirect_url: redirectUrl
      }],
      documents: [{
        document_name: `${documentName}.pdf`,
        document: documentBase64 // base64 encoded PDF
      }]
    }]
  };

  const response = await fetch(`${ZOHO_SIGN_API_BASE}/requests`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Failed to create signing request');
  }

  return data;
}

/**
 * Get request status
 */
export async function getRequestStatus(requestId) {
  const accessToken = await getZohoAccessToken();
  const response = await fetch(`${ZOHO_SIGN_API_BASE}/requests/${requestId}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error('Failed to get request status');
  }

  return response.json();
}

/**
 * Download signed document
 */
export async function downloadSignedDocument(requestId) {
  const accessToken = await getZohoAccessToken();
  const response = await fetch(`${ZOHO_SIGN_API_BASE}/requests/${requestId}/pdf`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error('Failed to download signed document');
  }

  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer);
}