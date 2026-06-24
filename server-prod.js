// server-prod.js
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// Cal.EU Configuration
const EVENT_TYPE_ID = parseInt(process.env.EVENT_TYPE_ID || process.env.NEXT_PUBLIC_CAL_EVENT_TYPE_ID || '344929', 10);
const CAL_API_KEY = process.env.CAL_API_KEY || '';

// Resend Configuration
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@turnkii.com';
const NOTIFY_EMAIL = process.env.RESEND_TO_EMAIL || 'gavin911@proton.me';

console.log('📋 Server Configuration:');
console.log(`  Event Type ID: ${EVENT_TYPE_ID}`);
console.log(`  CAL_API_KEY exists: ${CAL_API_KEY ? 'Yes' : 'No'}`);
console.log(`  RESEND_API_KEY exists: ${RESEND_API_KEY ? 'Yes' : 'No'}`);
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

// Availability in UTC (London is UTC+1 during BST)
const AVAILABILITY_SCHEDULE = {
  monday:    { start: 13, end: 16 },
  tuesday:   { start: 13, end: 16 },
  wednesday: { start: 13, end: 16 },
  thursday:  { start: 13, end: 16 },
  friday:    { start: 13, end: 15 },
  saturday:  null,
  sunday:    null
};

// API: Get available slots (FIXED)
app.get('/api/slots', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }

    const slots = getManualSlots(new Date(date));
    console.log(`📅 Slots for ${date}:`, slots.map(s => `${s.display} (${s.start})`));
    res.json({ slots });
  } catch (error) {
    console.error('Error getting slots:', error);
    res.status(500).json({ error: 'Failed to get slots' });
  }
});

// API: Create a booking
app.post('/api/book', async (req, res) => {
  try {
    const { startTime, name, email, notes } = req.body;

    console.log('📤 Booking request:', { startTime, name, email });

    if (!startTime || !name || !email) {
      return res.status(400).json({ 
        error: 'Missing required fields: startTime, name, email' 
      });
    }

    // Parse and validate the time
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

    // Allow 0 or 30 minutes only
    if (minute !== 0 && minute !== 30) {
      return res.status(400).json({ 
        error: 'Bookings must start on the hour or half-hour' 
      });
    }

    if (hour < schedule.start || hour > schedule.end || (hour === schedule.end && minute > 0)) {
      const startLondon = schedule.start + 1;
      const endLondon = schedule.end + 1;
      return res.status(400).json({ 
        error: `Bookings are only available ${startLondon}:00-${endLondon}:00 London time on ${dayOfWeek}` 
      });
    }

    // Ensure UTC format
    let start = startTime;
    if (!start.endsWith('Z')) {
      start = new Date(startTime).toISOString();
    }

    // 1. Create booking in Cal.com
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
          timeZone: 'Europe/London'
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

    // 2. Send confirmation email via Resend
    if (resend) {
      console.log('📧 Sending confirmation email via Resend...');
      try {
        const meetingTime = new Date(booking.start);
        const meetingEnd = new Date(booking.end);
        
        const emailData = {
          from: FROM_EMAIL,
          to: [email, NOTIFY_EMAIL],
          subject: `Meeting Confirmed: ${meetingTime.toLocaleDateString()} at ${meetingTime.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',hour12:false})}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb; border-radius: 12px;">
              <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
                <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 8px;">✅ Meeting Confirmed</h1>
                <p style="color: #666; margin-bottom: 24px;">Your meeting has been scheduled successfully.</p>
                
                <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
                  <p style="margin: 4px 0;"><strong>📅 Date:</strong> ${meetingTime.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                  <p style="margin: 4px 0;"><strong>⏰ Time:</strong> ${meetingTime.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',hour12:false})} - ${meetingEnd.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',hour12:false})} (London time)</p>
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
            Date: ${meetingTime.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            Time: ${meetingTime.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',hour12:false})} - ${meetingEnd.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',hour12:false})} (London time)
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
    } else {
      console.log('⚠️ Resend not configured - skipping email');
    }

    // 3. Return success response
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

// 🔥 FIXED: Generate 30-min slots
function getManualSlots(date) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = days[date.getDay()];
  const schedule = AVAILABILITY_SCHEDULE[dayName];

  if (!schedule) return [];

  const slots = [];
  const dateStr = date.toISOString().split('T')[0];
  
  for (let hour = schedule.start; hour < schedule.end; hour++) {
    // On the hour
    const timeStr1 = `${dateStr}T${String(hour).padStart(2, '0')}:00:00Z`;
    const dateObj1 = new Date(timeStr1);
    const londonTime1 = new Date(dateObj1.getTime() + 60 * 60 * 1000);
    slots.push({
      start: timeStr1,
      display: londonTime1.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    });

    // 30 minutes past the hour (if not at the end)
    const timeStr2 = `${dateStr}T${String(hour).padStart(2, '0')}:30:00Z`;
    const dateObj2 = new Date(timeStr2);
    const londonTime2 = new Date(dateObj2.getTime() + 60 * 60 * 1000);
    slots.push({
      start: timeStr2,
      display: londonTime2.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    });
  }

  return slots;
}

// API: Webhook handler
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

// Serve the booking page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'booking.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    eventTypeId: EVENT_TYPE_ID,
    hasApiKey: !!CAL_API_KEY,
    hasResend: !!RESEND_API_KEY
  });
});

// Start server
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📅 Booking page: http://localhost:${PORT}/`);
    console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);
  });
}

export default app;