// lib/zoho.js
const ZOHO_API_BASE = process.env.ZOHO_API_BASE || 'https://www.zohoapis.eu/crm/v2';

// Token management
let cachedAccessToken = null;
let tokenExpiry = null;

// Function to get a fresh access token using refresh token
async function getAccessToken() {
  // Return cached token if still valid (within 55 minutes of 1-hour expiry)
  if (cachedAccessToken && tokenExpiry && Date.now() < tokenExpiry) {
    console.log('Using cached access token');
    return cachedAccessToken;
  }

  console.log('Fetching new access token from Zoho EU...');
  
  try {
    const response = await fetch('https://accounts.zoho.eu/oauth/v2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        grant_type: 'refresh_token'
      })
    });

    const data = await response.json();
    
    if (data.access_token) {
      cachedAccessToken = data.access_token;
      // Set expiry to 55 minutes (API token lasts 1 hour)
      tokenExpiry = Date.now() + 55 * 60 * 1000;
      console.log('Access token obtained successfully from EU');
      return cachedAccessToken;
    } else {
      console.error('Zoho token error:', data);
      throw new Error(`Failed to get access token: ${data.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Error getting Zoho access token:', error);
    throw error;
  }
}

// Helper function to handle Zoho API responses safely
async function zohoRequest(endpoint, options = {}) {
  const accessToken = await getAccessToken();
  const url = `${ZOHO_API_BASE}${endpoint}`;
  const headers = {
    'Authorization': `Zoho-oauthtoken ${accessToken}`,
    'Content-Type': 'application/json',
    ...options.headers
  };

  console.log(`Making Zoho API request: ${options.method || 'GET'} ${endpoint}`);
  console.log(`Full URL: ${url}`);
  console.log(`Headers:`, JSON.stringify(headers, null, 2));
  if (options.body) {
    console.log(`Body: ${options.body}`);
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers
    });

    console.log(`Response status: ${response.status}`);
    console.log(`Response status text: ${response.statusText}`);
    console.log(`Response headers:`, Object.fromEntries(response.headers));
    
    // First, get the response as text
    const responseText = await response.text();
    console.log(`Response body length: ${responseText.length}`);
    console.log(`Response body preview: ${responseText.substring(0, 500)}`);
    
    // Check if response is empty
    if (!responseText || responseText.trim() === '') {
      console.error('Empty response from Zoho API:', { 
        url, 
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers)
      });
      throw new Error(`Zoho API returned empty response (${response.status} ${response.statusText})`);
    }

    // Try to parse JSON
    let data;
    try {
      data = JSON.parse(responseText);
      console.log(`Successfully parsed JSON response`);
    } catch (parseError) {
      console.error('Failed to parse Zoho response as JSON:', {
        url,
        status: response.status,
        responseText: responseText.substring(0, 500)
      });
      throw new Error(`Invalid JSON response from Zoho: ${responseText.substring(0, 200)}`);
    }

    // Check for Zoho API errors
    if (data.code === 'INVALID_TOKEN' || data.code === 'AUTHENTICATION_FAILURE') {
      console.error('Zoho authentication error:', data);
      // Clear cached token so next request gets a new one
      cachedAccessToken = null;
      tokenExpiry = null;
      throw new Error('Zoho authentication failed. Please check your credentials.');
    }

    if (data.code === 'INVALID_REQUEST' || (data.data && data.data.code === 'INVALID_DATA')) {
      console.error('Zoho API error:', data);
      throw new Error(data.message || 'Zoho API returned an error');
    }

    return data;
  } catch (error) {
    console.error('Zoho request failed:', {
      endpoint,
      error: error.message,
    });
    throw error;
  }
}

// Find contact by email
export async function findContactByEmail(email) {
  try {
    console.log(`Searching for contact with email: ${email}`);
    
    // First, try searching with criteria
    const query = `Email:equals:${encodeURIComponent(email)}`;
    console.log(`Query: ${query}`);
    
    const response = await zohoRequest(`/Contacts/search?criteria=${query}`);
    
    if (response.data && response.data.length > 0) {
      console.log(`Contact found: ${response.data[0].id}`);
      return response.data[0];
    }
    
    console.log('Contact not found by search criteria, trying to fetch all contacts...');
    
    // If search fails, try to get all contacts and filter manually
    try {
      const allContactsResponse = await zohoRequest(`/Contacts?fields=id,Email,First_Name,Last_Name,Title,Twitter,Assistant`);
      if (allContactsResponse.data && allContactsResponse.data.length > 0) {
        console.log(`Found ${allContactsResponse.data.length} total contacts`);
        const contact = allContactsResponse.data.find(c => c.Email === email);
        if (contact) {
          console.log(`Contact found in all contacts: ${contact.id}`);
          return contact;
        }
      }
    } catch (allContactsError) {
      console.log('Could not fetch all contacts:', allContactsError.message);
    }
    
    console.log('Contact not found');
    return null;
  } catch (error) {
    console.error('Error finding contact by email:', error);
    throw error;
  }
}

// Create new contact
export async function createContact(email) {
  try {
    console.log(`Creating new contact for email: ${email}`);
    
    const requestData = {
      data: [
        {
          Email: email,
          Last_Name: ' ', // Zoho requires Last Name
          First_Name: ' ' // Add First Name as placeholder
        }
      ]
    };

    console.log(`Create contact request data:`, JSON.stringify(requestData, null, 2));

    const response = await zohoRequest('/Contacts', {
      method: 'POST',
      body: JSON.stringify(requestData)
    });

    if (response.data && response.data[0]) {
      console.log(`Contact created with ID: ${response.data[0].id}`);
      return response.data[0];
    }
    throw new Error('Failed to create contact: No data returned');
  } catch (error) {
    console.error('Error creating contact:', error);
    throw error;
  }
}

// Update contact
export async function updateContact(contactId, updates) {
  try {
    console.log(`Updating contact ${contactId} with:`, updates);
    
    const requestData = {
      data: [updates]
    };

    console.log(`Update contact request data:`, JSON.stringify(requestData, null, 2));

    const response = await zohoRequest(`/Contacts/${contactId}`, {
      method: 'PUT',
      body: JSON.stringify(requestData)
    });

    console.log(`Contact ${contactId} updated successfully`);
    return response;
  } catch (error) {
    console.error('Error updating contact:', error);
    throw error;
  }
}