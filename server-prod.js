// server-prod.js
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://www.turnkii.es',
    'https://turnkii.es',
    'https://project-qv4f9.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static('public'));

// ============================================================
// CONFIGURATION
// ============================================================

const EVENT_TYPE_ID = parseInt(process.env.EVENT_TYPE_ID || process.env.NEXT_PUBLIC_CAL_EVENT_TYPE_ID || '344929', 10);
const CAL_API_KEY = process.env.CAL_API_KEY || '';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@mail.turnkii.es';
const NOTIFY_EMAIL = process.env.RESEND_TO_EMAIL || 'gavin911@proton.me';

// Supabase Configuration
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

console.log('📋 Server Configuration:');
console.log(`  Event Type ID: ${EVENT_TYPE_ID}`);
console.log(`  CAL_API_KEY exists: ${CAL_API_KEY ? 'Yes' : 'No'}`);
console.log(`  RESEND_API_KEY exists: ${RESEND_API_KEY ? 'Yes' : 'No'}`);
console.log(`  Supabase exists: ${supabaseUrl ? 'Yes' : 'No'}`);
console.log(`  FROM_EMAIL: ${FROM_EMAIL}`);
console.log(`  NOTIFY_EMAIL: ${NOTIFY_EMAIL}`);

// Initialize Resend
let resend = null;
if (RESEND_API_KEY) {
  try {
    resend = new Resend(RESEND_API_KEY);
    console.log('✅ Resend initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize Resend:', error.message);
  }
} else {
  console.log('⚠️ Resend not configured - emails will be skipped');
}

// ============================================================
// RATE LIMITING (for magic_link)
// ============================================================

const rateLimits = new Map();

function checkRateLimit(email, limitMinutes = 5, maxRequests = 3) {
  const now = Date.now();
  const key = `sp_magic_${email}`;
  const windowMs = limitMinutes * 60 * 1000;
  
  if (!rateLimits.has(key)) {
    rateLimits.set(key, { count: 1, firstRequest: now });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  
  const record = rateLimits.get(key);
  
  if (now - record.firstRequest > windowMs) {
    rateLimits.set(key, { count: 1, firstRequest: now });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  
  if (record.count >= maxRequests) {
    const waitMinutes = Math.ceil((windowMs - (now - record.firstRequest)) / 60000);
    return { allowed: false, remaining: 0, waitMinutes };
  }
  
  record.count++;
  rateLimits.set(key, record);
  return { allowed: true, remaining: maxRequests - record.count };
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken() {
  return [...Array(32)]
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join("");
}

// ============================================================
// AVAILABILITY SCHEDULE
// ============================================================

const AVAILABILITY_SCHEDULE = {
  monday:    { start: 12, end: 15 },
  tuesday:   { start: 12, end: 15 },
  wednesday: { start: 12, end: 15 },
  thursday:  { start: 12, end: 15 },
  friday:    { start: 12, end: 14 },
  saturday:  null,
  sunday:    null
};

// ============================================================
// API: Get available slots
// ============================================================

app.get('/api/slots', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }

    const slots = getManualSlots(new Date(date));
    console.log(`📅 Slots for ${date}:`, slots.map(s => s.display));
    res.json({ slots });
  } catch (error) {
    console.error('Error getting slots:', error);
    res.status(500).json({ error: 'Failed to get slots' });
  }
});

// ============================================================
// API: Create a booking
// ============================================================

app.post('/api/book', async (req, res) => {
  try {
    const { startTime, name, email, notes } = req.body;

    console.log('📤 Booking request:', { startTime, name, email });

    if (!startTime || !name || !email) {
      return res.status(400).json({ 
        error: 'Missing required fields: startTime, name, email' 
      });
    }

    const bookingDate = new Date(startTime);
    const dayOfWeek = bookingDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const hour = bookingDate.getUTCHours();
    const minute = bookingDate.getUTCMinutes();

    const schedule = AVAILABILITY_SCHEDULE[dayOfWeek];
    if (!schedule) {
      return res.status(400).json({ 
        error: 'Bookings are only available Monday-Friday' 
      });
    }

    if (minute !== 0 && minute !== 30) {
      return res.status(400).json({ 
        error: 'Bookings must start on the hour or half-hour' 
      });
    }

    if (hour < schedule.start || hour > schedule.end || (hour === schedule.end && minute > 0)) {
      const startCest = schedule.start + 2;
      const endCest = schedule.end + 2;
      return res.status(400).json({ 
        error: `Bookings are only available ${startCest}:00-${endCest}:00 CEST on ${dayOfWeek}` 
      });
    }

    let start = startTime;
    if (!start.endsWith('Z')) {
      start = new Date(startTime).toISOString();
    }

    console.log('📤 Creating booking in Cal.eu...');
    const response = await fetch('https://api.cal.eu/v2/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cal-api-version': '2024-08-13',
        'Authorization': `Bearer ${CAL_API_KEY}`
      },
      body: JSON.stringify({
        eventTypeId: EVENT_TYPE_ID,
        start: start,
        attendee: {
          name: name,
          email: email,
          timeZone: 'Europe/Berlin'
        },
        bookingFieldsResponses: {
          notes: notes || ''
        }
      })
    });

    const data = await response.json();
    console.log('📥 Cal.eu response:', response.status);

    if (!response.ok) {
      throw new Error(data.error?.message || `HTTP ${response.status}`);
    }

    if (data.status !== 'success') {
      throw new Error(data.error?.message || 'Booking failed');
    }

    const booking = data.data;

    // Send email
    if (resend) {
      console.log('📧 Sending confirmation email via Resend...');
      try {
        const meetingTime = new Date(booking.start);
        const meetingEnd = new Date(booking.end);
        
        const cestTime = new Date(meetingTime.getTime() + 2 * 60 * 60 * 1000);
        const cestEnd = new Date(meetingEnd.getTime() + 2 * 60 * 60 * 1000);
        const ukTime = new Date(meetingTime.getTime() + 60 * 60 * 1000);
        
        const emailData = {
          from: FROM_EMAIL,
          to: [email, NOTIFY_EMAIL],
          subject: `Meeting Confirmed: ${meetingTime.toLocaleDateString()} at ${cestTime.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',hour12:false})} CEST`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb; border-radius: 12px;">
              <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
                <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 8px;">✅ Meeting Confirmed</h1>
                <p style="color: #666; margin-bottom: 24px;">Your meeting has been scheduled successfully.</p>
                
                <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
                  <p style="margin: 4px 0;"><strong>📅 Date:</strong> ${cestTime.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                  <p style="margin: 4px 0;"><strong>⏰ Time:</strong> ${cestTime.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',hour12:false})} - ${cestEnd.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',hour12:false})} CEST (${ukTime.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',hour12:false})} UK)</p>
                  <p style="margin: 4px 0;"><strong>👤 Attendee:</strong> ${name}</p>
                  <p style="margin: 4px 0;"><strong>📧 Email:</strong> ${email}</p>
                  ${notes ? `<p style="margin: 4px 0;"><strong>📝 Notes:</strong> ${notes}</p>` : ''}
                </div>

                ${booking.meetingUrl ? `
                  <div style="text-align: center; margin: 24px 0;">
                    <a href="${booking.meetingUrl}" target="_blank" style="display: inline-block; background: #3b82f6; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 500;">
                      🔗 Join Meeting
                    </a>
                  </div>
                ` : ''}

                <p style="color: #999; font-size: 14px; border-top: 1px solid #e5e7eb; padding-top: 16px; margin-top: 16px;">
                  This meeting was booked via Turnkii.
                </p>
              </div>
            </div>
          `,
          text: `
            Meeting Confirmed!
            Date: ${cestTime.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            Time: ${cestTime.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',hour12:false})} - ${cestEnd.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',hour12:false})} CEST (${ukTime.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',hour12:false})} UK)
            Attendee: ${name}
            Email: ${email}
            ${notes ? `Notes: ${notes}` : ''}
            ${booking.meetingUrl ? `Meeting Link: ${booking.meetingUrl}` : ''}
          `
        };

        const emailResult = await resend.emails.send(emailData);
        console.log('✅ Email sent:', emailResult);
      } catch (emailError) {
        console.error('❌ Email sending failed:', emailError.message);
      }
    }

    res.json({
      success: true,
      booking: {
        uid: booking.uid,
        start: booking.start,
        end: booking.end,
        meetingUrl: booking.meetingUrl,
        attendee: booking.attendees[0]
      }
    });

  } catch (error) {
    console.error('❌ Booking error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to create booking' 
    });
  }
});

// ============================================================
// Helper: Generate slots with CEST as primary time
// ============================================================

function getManualSlots(date) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = days[date.getDay()];
  const schedule = AVAILABILITY_SCHEDULE[dayName];

  if (!schedule) return [];

  const slots = [];
  const dateStr = date.toISOString().split('T')[0];
  
  for (let hour = schedule.start; hour < schedule.end; hour++) {
    const timeStr1 = `${dateStr}T${String(hour).padStart(2, '0')}:00:00Z`;
    const utc1 = new Date(timeStr1);
    const cest1 = new Date(utc1.getTime() + 2 * 60 * 60 * 1000);
    const uk1 = new Date(utc1.getTime() + 60 * 60 * 1000);
    slots.push({
      start: timeStr1,
      display: `${cest1.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })} CEST / ${uk1.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })} UK`
    });

    const timeStr2 = `${dateStr}T${String(hour).padStart(2, '0')}:30:00Z`;
    const utc2 = new Date(timeStr2);
    const cest2 = new Date(utc2.getTime() + 2 * 60 * 60 * 1000);
    const uk2 = new Date(utc2.getTime() + 60 * 60 * 1000);
    slots.push({
      start: timeStr2,
      display: `${cest2.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })} CEST / ${uk2.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })} UK`
    });
  }

  return slots;
}

// ============================================================
// API: Webhook handler
// ============================================================

app.post('/api/cal-webhook', async (req, res) => {
  try {
    const secret = req.headers['x-cal-secret'];
    if (secret !== process.env.CAL_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { triggerEvent, payload } = req.body;
    console.log(`📅 Webhook received: ${triggerEvent}`);

    switch(triggerEvent) {
      case 'BOOKING_CREATED':
        console.log('✅ New booking:', payload.data.uid);
        break;
      default:
        console.log(`Unhandled event: ${triggerEvent}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// API: GET sp-contact (fetch contact + documents)
// ============================================================

app.get('/api/sp-contact', async (req, res) => {
  try {
    const { email, action } = req.query;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    console.log('📤 GET /api/sp-contact:', { email, action });

    // Fetch contact from Supabase
    const { data: contact, error: findError } = await supabase
      .from('contacts')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (findError || !contact) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }

    // If action is get_documents, fetch documents for this contact
    if (action === 'get_documents') {
      console.log('📄 Fetching documents for contact:', contact.id);

      const { data: documents, error: docsError } = await supabase
        .from('documents')
        .select('*')
        .eq('contact_id', contact.id);

      if (docsError) {
        console.error('❌ Error fetching documents:', docsError);
        return res.status(500).json({ success: false, error: 'Failed to fetch documents' });
      }

      return res.status(200).json({
        success: true,
        documents: documents || []
      });
    }

    // Default: return contact info
    return res.status(200).json({
      success: true,
      contact: {
        id: contact.id,
        email: contact.email,
        firstName: contact.first_name || '',
        lastName: contact.last_name || '',
        mobileNumber: contact.mobile_number || '',
        mobileCountryCode: contact.mobile_country_code || '',
        otp: contact.otp || '',
        magicLink: contact.magic_link || '',
        linkExpiry: contact.link_expiry || '',
      }
    });

  } catch (error) {
    console.error('❌ GET /api/sp-contact error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// API: Send OTP (sp-contact) - POST handler
// ============================================================

app.post('/api/sp-contact', async (req, res) => {
  try {
    const { email, firstName, lastName, mobileNumber, mobileCountryCode, action, otp, token } = req.body;

    // ============================================================
    // UPDATE contact
    // ============================================================
    if (action === 'update') {
      if (!firstName || !lastName) {
        return res.status(400).json({ success: false, error: 'First name and last name are required' });
      }

      const { data: existingContact, error: findError } = await supabase
        .from('contacts')
        .select('id')
        .eq('email', email.toLowerCase())
        .single();

      if (findError || !existingContact) {
        return res.status(404).json({ success: false, error: 'Contact not found' });
      }

      const { error: updateError } = await supabase
        .from('contacts')
        .update({
          first_name: firstName,
          last_name: lastName,
          mobile_number: mobileNumber || '',
          mobile_country_code: mobileCountryCode || '+34',
          updated_at: new Date().toISOString()
        })
        .eq('id', existingContact.id);

      if (updateError) {
        return res.status(500).json({ success: false, error: 'Failed to update contact' });
      }

      return res.status(200).json({
        success: true,
        message: 'Profile updated successfully'
      });
    }

    // ============================================================
    // MAGIC_LINK - Generate OTP and send email
    // ============================================================
    if (action === 'magic_link' || !action) {
      // Rate limiting
      const rateCheck = checkRateLimit(email, 5, 3);
      if (!rateCheck.allowed) {
        return res.status(429).json({
          success: false,
          error: `Too many requests. Please wait ${rateCheck.waitMinutes} minute(s) before requesting another code.`
        });
      }

      const otpCode = generateOTP();
      const tokenCode = generateToken();
      const expiryTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      // Check if contact exists
      const { data: existingContact, error: findError } = await supabase
        .from('contacts')
        .select('*')
        .eq('email', email.toLowerCase())
        .single();

      let contactId;
      let isNewContact = false;

      if (findError && findError.code === 'PGRST116') {
        // Create account first
        const { data: newAccount, error: accountError } = await supabase
          .from('accounts')
          .insert({})
          .select()
          .single();

        if (accountError) {
          console.error('❌ Failed to create account:', accountError);
          return res.status(500).json({ error: 'Failed to create account' });
        }

        const { data: newContact, error: createError } = await supabase
          .from('contacts')
          .insert({
            email: email.toLowerCase(),
            first_name: firstName || email.split('@')[0],
            last_name: lastName || '',
            account_id: newAccount.id,
            role: 'primary',
            mobile_number: mobileNumber || '',
            mobile_country_code: mobileCountryCode || '+34',
            otp: otpCode,
            magic_link: tokenCode,
            link_expiry: expiryTime
          })
          .select()
          .single();

        if (createError) {
          console.error('❌ Failed to create contact:', createError);
          return res.status(500).json({ error: 'Failed to create contact' });
        }

        contactId = newContact.id;
        isNewContact = true;
        console.log('✅ Created new contact with OTP');
      } else if (existingContact) {
        contactId = existingContact.id;
        isNewContact = false;

        const { error: updateError } = await supabase
          .from('contacts')
          .update({
            otp: otpCode,
            magic_link: tokenCode,
            link_expiry: expiryTime,
            updated_at: new Date().toISOString()
          })
          .eq('id', contactId);

        if (updateError) {
          console.error('❌ Failed to update OTP:', updateError);
          return res.status(500).json({ error: 'Failed to update OTP' });
        }
        console.log('✅ Updated OTP for existing contact');
      } else {
        return res.status(500).json({ error: 'Database error' });
      }

      // Send OTP email
      let emailSent = false;
      if (resend) {
        try {
          await resend.emails.send({
            from: FROM_EMAIL,
            to: email,
            subject: `🔐 Your OTP Code for Turnkii`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb; border-radius: 12px;">
                <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
                  <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 8px;">🔐 Your OTP Code</h1>
                  <p style="color: #666; margin-bottom: 24px;">Use this code to verify your email address.</p>
                  <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 24px 0;">
                    <div style="font-size: 36px; font-weight: bold; letter-spacing: 12px; color: #1a1a1a;">${otpCode}</div>
                  </div>
                  <p style="color: #666; font-size: 14px;">This code expires in <strong>10 minutes</strong>.</p>
                </div>
              </div>
            `,
            text: `Your OTP code is: ${otpCode}\n\nThis code expires in 10 minutes.`
          });
          emailSent = true;
          console.log('✅ OTP email sent to:', email);
        } catch (emailError) {
          console.error('❌ Failed to send OTP email:', emailError.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: 'OTP sent successfully',
        otp: otpCode,
        token: tokenCode,
        expiry: expiryTime,
        contactId: contactId,
        isNewContact: isNewContact,
        emailSent: emailSent,
        remainingRequests: rateCheck.remaining
      });
    }

    // ============================================================
    // VERIFY OTP
    // ============================================================
    if (action === 'verify_otp') {
      if (!otp) {
        return res.status(400).json({ success: false, error: 'OTP is required' });
      }

      const { data: contact, error: findError } = await supabase
        .from('contacts')
        .select('*')
        .eq('email', email.toLowerCase())
        .single();

      if (findError || !contact) {
        return res.status(404).json({ success: false, error: 'Contact not found' });
      }

      if (contact.otp !== otp) {
        return res.status(401).json({ success: false, error: 'Invalid OTP' });
      }

      if (contact.link_expiry && new Date(contact.link_expiry) < new Date()) {
        return res.status(401).json({ success: false, error: 'OTP has expired' });
      }

      await supabase
        .from('contacts')
        .update({
          otp: null,
          email_verified: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', contact.id);

      return res.status(200).json({
        success: true,
        message: 'OTP verified successfully',
        token: contact.magic_link,
        email: contact.email,
        firstName: contact.first_name || '',
        lastName: contact.last_name || ''
      });
    }

    // ============================================================
    // VERIFY TOKEN
    // ============================================================
    if (action === 'verify_token') {
      if (!token) {
        return res.status(400).json({ success: false, error: 'Token is required' });
      }

      const { data: contact, error: findError } = await supabase
        .from('contacts')
        .select('*')
        .eq('email', email.toLowerCase())
        .single();

      if (findError || !contact) {
        return res.status(404).json({ success: false, error: 'Contact not found' });
      }

      if (contact.magic_link !== token) {
        return res.status(401).json({ success: false, error: 'Invalid token' });
      }

      if (contact.link_expiry && new Date(contact.link_expiry) < new Date()) {
        return res.status(401).json({ success: false, error: 'Token has expired' });
      }

      return res.status(200).json({
        success: true,
        message: 'Token verified successfully',
        email: contact.email,
        firstName: contact.first_name || '',
        lastName: contact.last_name || '',
        mobileNumber: contact.mobile_number || '',
        mobileCountryCode: contact.mobile_country_code || ''
      });
    }

    // ============================================================
    // LOGOUT
    // ============================================================
    if (action === 'logout') {
      if (!token) {
        return res.status(400).json({ success: false, error: 'Token is required' });
      }

      const { data: contact, error: findError } = await supabase
        .from('contacts')
        .select('*')
        .eq('email', email.toLowerCase())
        .single();

      if (findError || !contact) {
        return res.status(404).json({ success: false, error: 'Contact not found' });
      }

      if (contact.magic_link !== token) {
        return res.status(401).json({ success: false, error: 'Invalid token' });
      }

      await supabase
        .from('contacts')
        .update({
          magic_link: null,
          link_expiry: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', contact.id);

      return res.status(200).json({ success: true, message: 'Logged out successfully' });
    }

    return res.status(400).json({
      success: false,
      error: 'Invalid action. Valid actions: update, magic_link, verify_otp, verify_token, logout'
    });

  } catch (error) {
    console.error('❌ sp-contact error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
});

// ============================================================
// API: Verify OTP (standalone endpoint for compatibility)
// ============================================================

app.post('/api/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    console.log('🔍 Verifying OTP for:', email);

    const { data: contact, error: findError } = await supabase
      .from('contacts')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (findError || !contact) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }

    if (contact.otp !== otp) {
      return res.status(401).json({ success: false, error: 'Invalid OTP' });
    }

    if (contact.link_expiry && new Date(contact.link_expiry) < new Date()) {
      return res.status(401).json({ success: false, error: 'OTP has expired' });
    }

    const token = contact.magic_link;

    await supabase
      .from('contacts')
      .update({
        otp: null,
        email_verified: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', contact.id);

    console.log('✅ OTP verified for:', email);

    res.json({
      success: true,
      message: 'OTP verified successfully',
      token: token,
      email: contact.email,
      firstName: contact.first_name || '',
      lastName: contact.last_name || ''
    });

  } catch (error) {
    console.error('❌ OTP verification error:', error);
    res.status(500).json({ error: error.message || 'Failed to verify OTP' });
  }
});

// ============================================================
// Serve the booking page
// ============================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'booking.html'));
});

// ============================================================
// Health check
// ============================================================

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    eventTypeId: EVENT_TYPE_ID,
    hasApiKey: !!CAL_API_KEY,
    hasResend: !!RESEND_API_KEY,
    hasSupabase: !!supabaseUrl
  });
});

// ============================================================
// TEMPORARY: Clear rate limit for testing
// ============================================================

app.post('/api/clear-rate-limit', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  
  const key = `sp_magic_${email}`;
  rateLimits.delete(key);
  console.log(`✅ Rate limit cleared for ${email}`);
  res.json({ success: true, message: `Rate limit cleared for ${email}` });
});

// ============================================================
// Start server
// ============================================================

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📅 Booking page: http://localhost:${PORT}/`);
    console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);
  });
}

export default app;