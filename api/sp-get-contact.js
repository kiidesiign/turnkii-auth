// api/sp-get-contact.js
import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  const CORS_ORIGIN = 'https://www.turnkii.es';

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Only allow GET
  if (req.method !== 'GET') {
    console.log(`Method not allowed: ${req.method}`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.query;
  console.log(`📧 Request received for email: ${email}`);

  if (!email) {
    console.log('❌ No email provided');
    return res.status(400).json({ error: 'Email is required' });
  }

  // Check environment variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  console.log('🔍 Environment check:', {
    hasSupabaseUrl: !!supabaseUrl,
    hasSupabaseAnonKey: !!supabaseAnonKey,
    supabaseUrlPrefix: supabaseUrl ? supabaseUrl.substring(0, 20) + '...' : 'missing'
  });

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('❌ Missing environment variables');
    return res.status(500).json({
      error: 'Server configuration error',
      missing: {
        supabaseUrl: !supabaseUrl,
        supabaseAnonKey: !supabaseAnonKey
      }
    });
  }

  try {
    console.log(`🔍 Searching for email: ${email}`);

    // Search for the contact in Supabase
    const { data: contact, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('email', email)
      .single();

    if (error) {
      console.log(`❌ Supabase error:`, error);
      if (error.code === 'PGRST116') {
        // No rows found - contact doesn't exist
        console.log(`❌ No contact found for email: ${email}`);
        return res.status(404).json({ error: 'Contact not found' });
      }
      throw error;
    }

    console.log(`✅ Contact found with ID: ${contact.id}`);

    // Format the contact data
    const formattedContact = {
      id: contact.id,
      // Original fields
      email: contact.email || '',
      firstName: contact.first_name || '',
      lastName: contact.last_name || '',
      phone: contact.phone || '',
      
      // Magic link fields
      otp: contact.otp || '',
      token: contact.magic_link || '',
      otpVerified: false, // No separate verified field in this schema
      otpGeneratedAt: contact.updated_at || '',
      linkExpiry: contact.link_expiry || '',
      createdAt: contact.created_at || '',
      updatedAt: contact.updated_at || '',
    };

    console.log('📤 Returning contact data with magic link fields');
    return res.status(200).json({
      success: true,
      contact: formattedContact,
      // Also return raw fields for compatibility with existing HTML
      fields: contact,
      id: contact.id
    });

  } catch (error) {
    console.error('❌ Supabase error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });

    return res.status(500).json({
      error: 'Failed to fetch contact',
      details: error.message
    });
  }
}