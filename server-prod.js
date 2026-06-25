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

// ============ CORS Configuration ============
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

// ============ Configuration ============
const EVENT_TYPE_ID = parseInt(process.env.EVENT_TYPE_ID || process.env.NEXT_PUBLIC_CAL_EVENT_TYPE_ID || '344929', 10);
const CAL_API_KEY = process.env.CAL_API_KEY || '';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@turnkii.es';
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

// ============ Availability Schedule ============
const AVAILABILITY_SCHEDULE = {
  monday:    { start: 12, end: 15 },
  tuesday:   { start: 12, end: 15 },
  wednesday: { start: 12, end: 15 },
  thursday:  { start: 12, end: 15 },
  friday:    { start: 12, end: 14 },
  saturday:  null,
  sunday:    null
};

// ============ Helper Functions ============
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

// ============ API: Get available slots ============
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

// ============ API: Create a booking ============
app.post('/api/book', async (req, res) => {
  try {
    const { startTime, firstName, lastName, email, phone, notes, acceptTerms, acceptMarketing } = req.body;

    console.log('📤 Booking request:', { startTime, firstName, lastName, email, phone });

    if (!startTime || !firstName || !lastName || !email) {
      return res.status(400).json({ 
        error: 'Missing required fields: startTime, firstName, lastName, email' 
      });
    }

    if (!acceptTerms) {
      return res.status(400).json({ 
        error: 'You must accept the terms and conditions' 
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

    // Find or create contact in Supabase
    let contactId;
    let isNewContact = false;
    
    const { data: existingContact, error: findError } = await supabase
      .from('contacts')
      .select('id, marketing_opt_in')
      .eq('email', email.toLowerCase())
      .single();

    if (findError && findError.code !== 'PGRST116') {
      console.error('❌ Database error:', findError);
      throw new Error('Database error checking contact');
    }

    if (existingContact) {
      contactId = existingContact.id;
      isNewContact = false;
      console.log(`✅ Found existing contact: ${contactId}`);
      
      await supabase
        .from('contacts')
        .update({
          first_name: firstName,
          last_name: lastName,
          phone: phone || null,
          updated_at: new Date().toISOString(),
          marketing_opt_in: acceptMarketing || existingContact.marketing_opt_in
        })
        .eq('id', contactId);
    } else {
      isNewContact = true;
      console.log('👤 Creating new contact...');
      
      const { data: newContact, error: createError } = await supabase
        .from('contacts')
        .insert({
          first_name: firstName,
          last_name: lastName,
          email: email.toLowerCase(),
          phone: phone || null,
          lead_source: 'free_consultation',
          marketing_opt_in: acceptMarketing || false
        })
        .select()
        .single();

      if (createError) {
        console.error('❌ Failed to create contact:', createError);
        throw new Error('Failed to create contact');
      }

      contactId = newContact.id;
      console.log(`✅ Created new contact: ${contactId}`);
    }

    // Create booking in Cal.com
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
          name: `${firstName} ${lastName}`,
          email: email,
          timeZone: 'Europe/Berlin'
        },
        bookingFieldsResponses: {
          notes: notes || '',
          phone: phone || '',
          marketing_opt_in: acceptMarketing ? 'Yes' : 'No'
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

    // Save booking to database
    console.log('💾 Saving booking to database...');
    await supabase
      .from('bookings')
      .insert({
        contact_id: contactId,
        cal_booking_uid: booking.uid,
        start_time: booking.start,
        end_time: booking.end,
        meeting_url: booking.meetingUrl,
        status: 'confirmed',
        notes: notes || null
      });

    // Send confirmation email
    if (resend) {
      console.log('📧 Sending confirmation email via Resend...');
      try {
        const meetingTime = new Date(booking.start);
        const meetingEnd = new Date(booking.end);
        const cestTime = new Date(meetingTime.getTime() + 2 * 60 * 60 * 1000);
        const cestEnd = new Date(meetingEnd.getTime() + 2 * 60 * 60 * 1000);
        const ukTime = new Date(meetingTime.getTime() + 60 * 60 * 1000);
        
        const marketingSection = acceptMarketing ? `
          <div style="background: #ecfdf5; padding: 16px; border-radius: 8px; margin: 16px 0; border: 1px solid #86efac;">
            <p style="margin: 0; color: #065f46;">✅ You're subscribed to our newsletter!</p>
          </div>
        ` : `
          <div style="background: #fef3c7; padding: 16px; border-radius: 8px; margin: 16px 0; border: 1px solid #f59e0b;">
            <p style="margin: 0; color: #92400e;">👋 <a href="https://turnkii.es/subscribe" style="color: #3b82f6;">Subscribe to our newsletter</a> for exclusive articles and offers.</p>
          </div>
        `;

        await resend.emails.send({
          from: FROM_EMAIL,
          to: [email, NOTIFY_EMAIL],
          subject: `✅ Free Consultation Confirmed: ${cestTime.toLocaleDateString()} at ${cestTime.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',hour12:false})} CEST`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb; border-radius: 12px;">
              <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
                <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 8px;">✅ Free Consultation Confirmed</h1>
                <p style="color: #666; margin-bottom: 24px;">Hi ${firstName}, your free consultation has been scheduled.</p>
                
                <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
                  <p style="margin: 4px 0;"><strong>📅 Date:</strong> ${cestTime.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                  <p style="margin: 4px 0;"><strong>⏰ Time:</strong> ${cestTime.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',hour12:false})} - ${cestEnd.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',hour12:false})} CEST</p>
                  <p style="margin: 4px 0;"><strong>👤 Attendee:</strong> ${firstName} ${lastName}</p>
                  <p style="margin: 4px 0;"><strong>📧 Email:</strong> ${email}</p>
                  ${phone ? `<p style="margin: 4px 0;"><strong>📱 Phone:</strong> ${phone}</p>` : ''}
                </div>

                ${booking.meetingUrl ? `
                  <div style="text-align: center; margin: 24px 0;">
                    <a href="${booking.meetingUrl}" target="_blank" style="display: inline-block; background: #3b82f6; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 500;">
                      🔗 Join Meeting
                    </a>
                  </div>
                ` : ''}

                ${marketingSection}
              </div>
            </div>
          `
        });
        console.log('✅ Email sent');
      } catch (emailError) {
        console.error('❌ Email sending failed:', emailError.message);
      }
    }

    res.json({
      success: true,
      contact: {
        id: contactId,
        isNewContact,
        firstName,
        lastName,
        email,
        marketingOptIn: acceptMarketing || false
      },
      booking: {
        uid: booking.uid,
        start: booking.start,
        end: booking.end,
        meetingUrl: booking.meetingUrl
      }
    });

  } catch (error) {
    console.error('❌ Booking error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to create booking' 
    });
  }
});

// ============ API: Send OTP (sp-contact) ============
app.post('/api/sp-contact', async (req, res) => {
  try {
    const { email, name, phone, action } = req.body;
    
    console.log('📧 OTP request:', { email, name, phone, action });

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!resend) {
      console.error('❌ Resend not configured');
      return res.status(500).json({ error: 'Email service not configured' });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store OTP in Supabase
    try {
      await supabase
        .from('otp_codes')
        .insert({
          email: email.toLowerCase(),
          otp: otp,
          expires_at: new Date(Date.now() + 10 * 60 * 1000)
        });
      console.log('✅ OTP stored in database');
    } catch (dbError) {
      console.warn('⚠️ Could not store OTP:', dbError);
    }

    // Send OTP email
    const emailResult = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `🔐 Your OTP Code for Turnkii`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb; border-radius: 12px;">
          <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
            <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 8px;">🔐 Your OTP Code</h1>
            <p style="color: #666; margin-bottom: 24px;">Use this code to verify your email address.</p>
            <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 24px 0;">
              <div style="font-size: 36px; font-weight: bold; letter-spacing: 12px; color: #1a1a1a;">${otp}</div>
            </div>
            <p style="color: #666; font-size: 14px;">This code expires in <strong>10 minutes</strong>.</p>
          </div>
        </div>
      `,
      text: `Your OTP code is: ${otp}\n\nThis code expires in 10 minutes.`
    });

    console.log('✅ OTP sent:', emailResult);
    res.json({
      success: true,
      message: 'OTP sent successfully'
    });

  } catch (error) {
    console.error('❌ OTP error:', error);
    res.status(500).json({ error: error.message || 'Failed to send OTP' });
  }
});

// ============ API: Verify OTP ============
app.post('/api/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    console.log('🔍 Verifying OTP for:', email);

    const { data: otpRecord, error: otpError } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('otp', otp)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (otpError || !otpRecord) {
      console.log('❌ Invalid or expired OTP');
      return res.status(400).json({ 
        success: false,
        error: 'Invalid or expired OTP' 
      });
    }

    // Delete used OTP
    await supabase
      .from('otp_codes')
      .delete()
      .eq('id', otpRecord.id);

    console.log('✅ OTP verified successfully');

    res.json({
      success: true,
      message: 'OTP verified successfully',
      user: { email }
    });

  } catch (error) {
    console.error('❌ OTP verification error:', error);
    res.status(500).json({ error: error.message || 'Failed to verify OTP' });
  }
});

// ============ API: Get contact by email ============
app.get('/api/contacts', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (contactError || !contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json({ contact });
  } catch (error) {
    console.error('Error fetching contact:', error);
    res.status(500).json({ error: 'Failed to fetch contact' });
  }
});

// ============ API: Webhook handler ============
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

// ============ Serve the booking page ============
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'booking.html'));
});

// ============ Health check ============
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

// ============ Start server ============
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📅 Booking page: http://localhost:${PORT}/`);
    console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);
  });
}

export default app;