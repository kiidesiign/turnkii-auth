// api/sp-get-contact-test.js
// TEMPORARY TEST VERSION - Hardcoded Supabase keys
// DELETE AFTER TESTING

import { createClient } from '@supabase/supabase-js';

// HARDCODED FOR TESTING ONLY - YOUR WORKING KEYS
const supabaseUrl = 'https://njieyqkdsrkkmgtwrmlg.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qaWV5cWtkc3Jra21ndHdybWxnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MTA0MzksImV4cCI6MjA5NzI4NjQzOX0.5saOCpl3_OsMe4Nchv3kgaC7oAo9fpGIU2dMPRx41OU';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default async function handler(req, res) {
  const CORS_ORIGIN = 'https://www.turnkii.es';

  // Handle CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    console.log(`🔍 Testing - Searching for email: ${email}`);

    const { data: contact, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('email', email)
      .single();

    if (error) {
      console.log(`❌ Supabase error:`, error);
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Contact not found' });
      }
      throw error;
    }

    console.log(`✅ Contact found with ID: ${contact.id}`);

    return res.status(200).json({
      success: true,
      contact: {
        id: contact.id,
        email: contact.email || '',
        firstName: contact.first_name || '',
        lastName: contact.last_name || '',
        phone: contact.phone || '',
        otp: contact.otp || '',
        token: contact.magic_link || '',
        linkExpiry: contact.link_expiry || '',
        createdAt: contact.created_at || '',
        updatedAt: contact.updated_at || '',
      }
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      error: 'Failed to fetch contact',
      details: error.message
    });
  }
}